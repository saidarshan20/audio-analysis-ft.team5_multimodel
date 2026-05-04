import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Sparkles, ScanLine, BarChart2, Lock, ArrowRight,
  Activity, Star, Download, ChevronDown, Trash2, Eye, Loader2, Zap, CheckCircle2, Layers, X, Clock
} from 'lucide-react';
import {
  createProject, getProjects, deleteProject as deleteProjectApi, completeProject, getProjectDetail,
  startStep, endStep, getRecentActivity, registerUnloadHandler,
  formatDuration, formatRelativeTime, TOOL_LABELS, TOOL_ICONS, TOOL_COLORS,
  type Project, type ActivityItem,
} from '../projectService';
import './DataExchangeView.css';
import watermarkLogo from '../../assets/looplogo.png';
import OcrPage               from './tools/ocr/OcrPage';
import DataVizPage           from './tools/data-viz/DataVizPage';
import FeatureEngineeringPage from './tools/feature-engineering/FeatureEngineeringPage';
import DataAnonymizationPage  from './tools/data-anonymization/DataAnonymizationPage';
import { getPreviewTeam4, CSVAnalysisResult } from './tools/data-viz/services';

// ─── Types ───────────────────────────────────────────────────────────────────
type ToolId = 'ocr' | 'viz' | 'feat' | 'anon' | 'automl' | null;

interface TeamOutput {
  id: string;
  filename: string;
  full_path: string;
  folder: string;
  size: string;
  last_modified: string;
}


// ─── Tool card data ──────────────────────────────────────────────────────────
const dataTools =[
  { id: 'ocr',  icon: <ScanLine size={32} />,  title: 'OCR Conversion',      iconBoxType: 'orange', description: 'Transform images and scanned documents into editable text. Extract data from PDFs, images, and handwritten documents with advanced optical character recognition.' },
  { id: 'viz',  icon: <BarChart2 size={32} />, title: 'Data Visualization',  iconBoxType: 'dark',   description: 'Create insightful charts, graphs, and interactive dashboards. Explore your data visually with powerful visualization tools and statistical analysis.' },
  { id: 'feat', icon: <Sparkles size={32} />,  title: 'Feature Engineering', iconBoxType: 'dark',   description: 'Transform and optimize your dataset features. Apply advanced techniques to create meaningful features that improve model performance and accuracy.' },
  { id: 'anon', icon: <Lock size={32} />,      title: 'Data Anonymization',  iconBoxType: 'dark',   description: 'Protect sensitive information with robust anonymization techniques. Ensure data privacy and compliance while maintaining data utility for analysis.' },
];

interface DataToolCardProps {
  tool: (typeof dataTools)[number];
  onOpen: (id: ToolId) => void;
}

const DataToolCard = ({ tool, onOpen }: DataToolCardProps) => {
  const [hovered, setHovered] = useState(false);

  return (
    <article
      className={`tool-card tool-card--expand${hovered ? ' is-open' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tool-card-content">
        <div className={`tool-icon-box ${tool.iconBoxType}`}>{tool.icon}</div>
        <h3 className="tool-title">{tool.title}</h3>
        <p className="tool-description">{tool.description}</p>
      </div>
      <button
        className={`tool-open-btn${hovered ? ' tool-open-btn--open' : ''}`}
        onClick={() => onOpen(tool.id as ToolId)}
        aria-label={`Open ${tool.title}`}
      >
        <span className="tool-open-btn-icon"><ArrowRight size={16} /></span>
        <span className="tool-open-btn-text">Open Tool</span>
      </button>
    </article>
  );
};

// ─── DataExchangeView ────────────────────────────────────────────────────────
const DataExchangeView = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activeTool, setActiveTool] = useState<ToolId>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [startFeature, setStartFeature] = useState<ToolId>(null);
  const [isFeatureOpen, setIsFeatureOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const activeStepRef = useRef<{ projectId: number; stepId: number } | null>(null);

  // Dynamic Blob Storage State
  const [teamOutputs, setTeamOutputs] = useState<TeamOutput[]>([]);
  const [fileFilter, setFileFilter] = useState<'all' | 'anonymization' | 'feature eng'>('all');

  // View Dataset → Data Viz flow
  const [vizCsvResult, setVizCsvResult] = useState<CSVAnalysisResult | null>(null);
  const [viewingDatasetId, setViewingDatasetId] = useState<string | null>(null);

  // Fetch logic for Azure Blob Storage
  const fetchTeamOutputs = async () => {
    try {
      // NOTE: Ensure your FastAPI is running and adjust the port/URL if needed
      const response = await fetch('http://localhost:8766/api/blobs/outputs'); 
      if (response.ok) {
        const data = await response.json();
        setTeamOutputs(data.datasets);
      }
    } catch (error) {
      console.error("Error fetching team outputs from backend:", error);
    }
  };

  const loadProjects = useCallback(async () => {
    try {
      const all = await getProjects();
      setProjects(all);
    } catch (e) { console.error('Failed to load projects:', e); }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const items = await getRecentActivity(10);
      setActivities(items);
    } catch (e) { console.error('Failed to load activity:', e); }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTool]);

  useEffect(() => {
    const pendingTool = sessionStorage.getItem('home-start-tool');
    if (pendingTool === 'ocr' || pendingTool === 'viz' || pendingTool === 'feat' || pendingTool === 'anon') {
      // Track step if there's an active project
      const pid = sessionStorage.getItem('active-project-id');
      if (pid) {
        startStep(Number(pid), pendingTool).then(s => {
          activeStepRef.current = { projectId: Number(pid), stepId: s.id };
        }).catch(() => {});
      }
      setActiveTool(pendingTool);
    }
    if (pendingTool) sessionStorage.removeItem('home-start-tool');

    fetchTeamOutputs();
    loadProjects();
    loadActivity();
    registerUnloadHandler();
  }, [loadProjects, loadActivity]);

  // Track tool open/close
  const handleOpenTool = async (toolId: ToolId) => {
    // End previous step if any
    if (activeStepRef.current) {
      try { await endStep(activeStepRef.current.projectId, activeStepRef.current.stepId); } catch {}
      activeStepRef.current = null;
    }
    // Start new step if there's an active project
    const pid = sessionStorage.getItem('active-project-id');
    if (pid && toolId) {
      try {
        const s = await startStep(Number(pid), toolId);
        activeStepRef.current = { projectId: Number(pid), stepId: s.id };
      } catch {}
    }
    setActiveTool(toolId);
    if (!toolId) {
      loadProjects();
      loadActivity();
    }
  };

  const startOptions: { value: Exclude<ToolId, null>; label: string }[] =[
    { value: 'ocr', label: 'OCR Conversion' },
    { value: 'viz', label: 'Data Visualization' },
    { value: 'feat', label: 'Feature Engineering' },
    { value: 'anon', label: 'Data Anonymization' },
    { value: 'automl', label: 'AutoML Wizard' },
  ];

  const handleStartProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!projectName.trim() || !startFeature) return;
    try {
      const proj = await createProject(projectName, startFeature);
      sessionStorage.setItem('active-project-id', String(proj.id));
      sessionStorage.setItem('active-step-id', String(proj.steps?.[0]?.id || ''));
      if (proj.steps?.[0]) {
        activeStepRef.current = { projectId: proj.id, stepId: proj.steps[0].id };
      }
      setShowStartModal(false);
      setIsFeatureOpen(false);
      setProjectName('');
      setStartFeature(null);
      if (startFeature === 'automl') {
        navigate('/Data2Insightai/model');
      } else {
        setActiveTool(startFeature);
      }
    } catch (e) { console.error('Failed to create project:', e); }
  };

  const handleDeleteProject = async (id: number) => {
    try { await deleteProjectApi(id); setProjects(prev => prev.filter(p => p.id !== id)); } catch {}
  };

  const handleCompleteProject = async (id: number) => {
    try { await completeProject(id); loadProjects(); } catch {}
  };

  const handleShowDetails = async (p: Project) => {
    try { const d = await getProjectDetail(p.id); setDetailProject(d); } catch { setDetailProject(p); }
  };

  const activeProjects = projects.filter(p => p.status === 'active');
  const completedProjects = projects.filter(p => p.status === 'completed');

  // Triggers the download endpoint
  const handleDownloadDataset = (fullPath: string) => {
    const url = `http://localhost:8766/api/blobs/download?blob_path=${encodeURIComponent(fullPath)}`;
    window.open(url, '_blank');
  };

  // View Dataset: download blob to viz dir, get preview, navigate to DataVizPage
  const handleViewDataset = async (ds: TeamOutput) => {
    setViewingDatasetId(ds.id);
    try {
      // 1. Download blob file to the backend's viz raw uploads folder
      const dlResp = await fetch(`http://localhost:8766/api/blobs/download-to-viz?blob_path=${encodeURIComponent(ds.full_path)}`);
      if (!dlResp.ok) throw new Error('Failed to download file for visualization');
      const dlData = await dlResp.json();

      // 2. Get preview/statistics from the Team 4 viz endpoint
      const preview = await getPreviewTeam4(dlData.filename);

      // 3. Set the result and navigate to DataVizPage
      setVizCsvResult(preview);
      setActiveTool('viz');
    } catch (err) {
      console.error('View Dataset Error:', err);
      alert('Failed to load dataset for visualization. Make sure the viz backend is running.');
    } finally {
      setViewingDatasetId(null);
    }
  };

  // Helper: is this a CSV/Excel file?
  const isTabularFile = (filename: string) => {
    const lower = filename.toLowerCase();
    return lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls');
  };

  // Apply the active filter + only show CSV/XLSX/XLS
  const filteredOutputs = teamOutputs
    .filter((item) => isTabularFile(item.filename))
    .filter((item) => {
      if (fileFilter === 'all') return true;
      return item.folder === fileFilter;
    });

  if (activeTool === 'ocr')  return <OcrPage               onBack={() => handleOpenTool(null)} onNavigateFeature={(feature) => handleOpenTool(feature)} />;
  if (activeTool === 'viz')  return <DataVizPage            onBack={() => { handleOpenTool(null); setVizCsvResult(null); }} initialCsvResult={vizCsvResult} onNavigateFeature={(feature) => handleOpenTool(feature)} />;
  if (activeTool === 'feat') return <FeatureEngineeringPage onBack={() => handleOpenTool(null)} onNavigateFeature={(feature) => handleOpenTool(feature)} />;
  if (activeTool === 'anon') return <DataAnonymizationPage  onBack={() => handleOpenTool(null)} onNavigateFeature={(feature) => handleOpenTool(feature)} />;

  return (
    <div className="view-animate-in data-exchange-container">
      <div className="data-hero">
        <div className="data-watermark" aria-hidden="true">
          <div className="data-watermark-halo" />
          <img src={watermarkLogo} alt="" className="data-watermark-img" />
        </div>

        <h1 className="hero-title">Data Exchange</h1>
        <div className="hero-badge">
          <FileText size={14} className="hero-badge-icon" />
          <span>Data Processing Tools</span>
        </div>
        <p className="hero-subtitle">
          Powerful tools for data processing, transformation, and analysis. Transform your raw<br />
          data into actionable insights.
        </p>
        <button
          className="data-start-btn"
          onClick={() => {
            setShowStartModal(true);
            setIsFeatureOpen(false);
          }}
        >
          <Sparkles size={16} />
          <span>Start New Project</span>
          <ArrowRight size={16} />
        </button>
      </div>

      {showStartModal && (
        <div
          className="data-modal-backdrop"
          onClick={() => {
            setShowStartModal(false);
            setIsFeatureOpen(false);
          }}
        >
           <div className="data-modal" onClick={(e) => e.stopPropagation()}>
            <button className="data-modal-close" type="button" onClick={() => { setShowStartModal(false); setIsFeatureOpen(false); }} aria-label="Close">x</button>
            <h3 className="data-modal-title">Start New Project</h3>
            <p className="data-modal-sub">Create a new data processing project and select features to include.</p>

            <form className="data-modal-form" onSubmit={handleStartProject}>
              <label className="data-modal-label" htmlFor="data-project-name">Project Name</label>
              <input id="data-project-name" className="data-modal-input" placeholder="Enter project name..." value={projectName} onChange={(e) => setProjectName(e.target.value)} />

              <label className="data-modal-label" htmlFor="data-start-feature">Where to Start</label>
              <div className="data-select" id="data-start-feature">
                <button type="button" className={`data-select-trigger${isFeatureOpen ? ' is-open' : ''}`} onClick={() => setIsFeatureOpen((v) => !v)}>
                  <span className={!startFeature ? 'is-placeholder' : ''}>
                    {startOptions.find((o) => o.value === startFeature)?.label ?? 'Select starting feature...'}
                  </span>
                  <ChevronDown size={16} />
                </button>
                {isFeatureOpen && (
                  <div className="data-select-menu">
                    {startOptions.map((opt) => (
                      <button key={opt.value} type="button" className={`data-select-option${startFeature === opt.value ? ' is-active' : ''}`} onClick={() => { setStartFeature(opt.value); setIsFeatureOpen(false); }}>{opt.label}</button>
                    ))}
                  </div>
                )}
              </div>

              <div className="data-modal-actions">
                <button type="button" className="data-modal-btn data-modal-btn--ghost" onClick={() => { setShowStartModal(false); setIsFeatureOpen(false); }}>Cancel</button>
                <button type="submit" className="data-modal-btn data-modal-btn--primary" disabled={!projectName.trim() || !startFeature}>Start Project</button>
              </div>
            </form>
          </div>
        </div>
      )}


      <div className="data-tools-grid">
        {dataTools.map(tool => (
          <DataToolCard key={tool.id} tool={tool} onOpen={handleOpenTool} />
        ))}
      </div>

      {/* ── Active Projects ── */}
      {activeProjects.length > 0 && (
        <div className="pj-section" style={{ maxWidth: '1400px', margin: '40px auto 0', width: '100%' }}>
          <h2 className="pj-section-title"><Zap size={20} className="pj-section-icon pj-section-icon--active" /> Your Active Projects</h2>
          <div className="pj-grid">
            {activeProjects.map(p => (
              <div key={p.id} className="pj-card pj-card--active">
                <div className="pj-card-header">
                  <div><h3 className="pj-card-name">{p.name}</h3><span className="pj-card-subtitle">Started with {TOOL_LABELS[p.starting_tool] || p.starting_tool}</span></div>
                  <div className="pj-card-badges">
                    <span className="pj-status-badge pj-status-badge--active"><span className="pj-status-dot" /> Active</span>
                    <button className="pj-delete-btn" onClick={() => handleDeleteProject(p.id)} title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="pj-card-flow-label">Project Flow</div>
                <div className="pj-flow">{(() => { const seen = new Set<string>(); const tools: string[] = []; p.steps.forEach(s => { if (!seen.has(s.tool_key)) { seen.add(s.tool_key); tools.push(s.tool_key); } }); return tools.map((t, i) => (<span key={t} className="pj-flow-group"><span className="pj-flow-pill"><span className="pj-flow-pill-icon">{TOOL_ICONS[t]||'🔧'}</span><span className="pj-flow-pill-label">{TOOL_LABELS[t]||t}</span></span>{i<tools.length-1&&<span className="pj-flow-arrow">→</span>}</span>)); })()}</div>
                <div className="pj-card-stats"><div className="pj-card-stat"><span className="pj-card-stat-label">Modules</span><span className="pj-card-stat-value">{p.module_count}</span></div><div className="pj-card-stat"><span className="pj-card-stat-label">Duration</span><span className="pj-card-stat-value">{formatDuration(p.total_duration_seconds)}</span></div></div>
                <div className="pj-card-actions">
                  <button className="pj-btn pj-btn--resume" onClick={() => { sessionStorage.setItem('active-project-id', String(p.id)); const lt = p.steps.length > 0 ? p.steps[p.steps.length - 1].tool_key : p.starting_tool; if (lt === 'automl') navigate('/Data2Insightai/model'); else handleOpenTool(lt as ToolId); }}><ArrowRight size={14} /> Resume</button>
                  <button className="pj-btn pj-btn--details" onClick={() => handleShowDetails(p)}><Layers size={14} /> More Details</button>
                  <button className="pj-btn pj-btn--complete" onClick={() => handleCompleteProject(p.id)}><CheckCircle2 size={14} /> Complete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedProjects.length > 0 && (
        <div className="pj-section" style={{ maxWidth: '1400px', margin: '24px auto 0', width: '100%' }}>
          <h2 className="pj-section-title"><CheckCircle2 size={20} className="pj-section-icon" /> Completed Projects</h2>
          <div className="pj-grid pj-grid--compact">
            {completedProjects.slice(0, 6).map(p => (
              <div key={p.id} className="pj-card pj-card--completed">
                <div className="pj-card-header">
                  <div><h3 className="pj-card-name">{p.name}</h3><span className="pj-card-subtitle">Started with {TOOL_LABELS[p.starting_tool] || p.starting_tool}</span></div>
                  <div className="pj-card-badges">
                    <span className="pj-status-badge pj-status-badge--completed">Completed</span>
                    <button className="pj-delete-btn" onClick={() => handleDeleteProject(p.id)} title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="pj-card-flow-label">Project Flow</div>
                <div className="pj-flow">{(() => { const seen = new Set<string>(); const tools: string[] = []; p.steps.forEach(s => { if (!seen.has(s.tool_key)) { seen.add(s.tool_key); tools.push(s.tool_key); } }); return tools.map((t, i) => (<span key={t} className="pj-flow-group"><span className="pj-flow-pill"><span className="pj-flow-pill-icon">{TOOL_ICONS[t]||'🔧'}</span><span className="pj-flow-pill-label">{TOOL_LABELS[t]||t}</span></span>{i<tools.length-1&&<span className="pj-flow-arrow">→</span>}</span>)); })()}</div>
                <div className="pj-card-actions"><button className="pj-btn pj-btn--details" onClick={() => handleShowDetails(p)}><Layers size={14} /> More Details</button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Dashboard ── */}
      <div className="data-dashboard" style={{ marginTop: '40px' }}>

        {/* Left – Recent Activity (Real Data) */}
        <div className="data-activity-card">
          <div className="data-activity-header">
            <div className="data-activity-icon"><Activity size={18} /></div>
            <div>
              <h3>Recent Activity</h3>
              <p>Latest operations and data processing activities</p>
            </div>
          </div>
          <div className="data-activity-list">
            {activities.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--t-muted)' }}>No recent activity yet. Start a project to see events here.</div>
            )}
            {activities.map(item => (
              <div key={item.id} className="data-activity-item">
                <div className="data-activity-dot" />
                <div className="data-activity-info">
                  <span className="data-activity-type">{item.tool_key ? (TOOL_LABELS[item.tool_key] || item.tool_key) : item.action}</span>
                  <span className="data-activity-desc">{item.description}</span>
                  <span className="data-activity-meta">
                    <Clock size={11} />{formatRelativeTime(item.timestamp)}{item.project_name && <>&nbsp;·&nbsp;{item.project_name}</>}
                  </span>
                </div>
                <span className="data-activity-status">{item.action.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right col – Golden Datasets (Now connected to Azure) */}
        {/* Right col – Golden Datasets (Now connected to Azure) */}
        <div className="data-right-col">
          <div className="data-golden-card">
            
            <div className="data-golden-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="data-golden-icon"><Star size={18} /></div>
                <div>
                  <h3>Golden Datasets</h3>
                  <p>High-quality, curated datasets for your projects</p>
                </div>
              </div>
            </div>

            {/* REFINED FILTER BUTTONS (Using CSS Classes) */}
            <div className="data-filter-bar">
              {[
                { label: 'All', value: 'all' },
                { label: 'Anonymization', value: 'anonymization' },
                { label: 'Feature Engineering', value: 'feature eng' } // Full name, but keeps backend value
              ].map(tab => (
                <button 
                  key={tab.value}
                  onClick={() => setFileFilter(tab.value as any)}
                  className={`data-filter-btn ${fileFilter === tab.value ? 'active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="data-golden-list">
              {filteredOutputs.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--t-muted)' }}>
                  No files found. Try another filter or check Azure Storage.
                </div>
              ) : (
                filteredOutputs.map(ds => {
                  
                  // 1. Helper to format the tag text nicely
                  const getFolderLabel = (folder: string) => {
                    if (folder === 'feature eng') return 'Feature Engineering';
                    if (folder === 'anonymization') return 'Anonymization';
                    return folder; // Fallback
                  };

                  // 2. Helper to assign your existing CSS colors (Blue for Anon, Orange for Feature Eng)
                  const getFolderTagStyle = (folder: string) => {
                    if (folder === 'feature eng') return 'trending';     // Orange tag
                    if (folder === 'anonymization') return 'downloaded'; // Blue tag
                    return 'gray'; 
                  };

                  return (
                    <div key={ds.id} className="data-golden-item">
                      
                      <div className="data-golden-info">
                        
                        {/* LEFT SIDE: Name and Tag stacked vertically */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <span className="data-golden-name">{ds.filename}</span>
                          <div className="data-golden-tags">
                            <span className={`data-golden-tag ${getFolderTagStyle(ds.folder)}`}>
                              {getFolderLabel(ds.folder)}
                            </span>
                          </div>
                        </div>

                        {/* RIGHT SIDE: Size */}
                        <span className="data-golden-size">{ds.size}</span>

                      </div>

                      {/* ACTION BUTTONS */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button 
                          className="data-golden-view-btn"
                          onClick={() => handleViewDataset(ds)}
                          title={`View ${ds.filename} in Data Visualization`}
                          disabled={viewingDatasetId === ds.id}
                        >
                          {viewingDatasetId === ds.id ? <Loader2 size={14} className="spin-icon" /> : <Eye size={14} />}
                          <span>{viewingDatasetId === ds.id ? 'Loading...' : 'View'}</span>
                        </button>
                        <button 
                          className="data-golden-arrow" 
                          onClick={() => handleDownloadDataset(ds.full_path)}
                          title={`Download ${ds.filename}`}
                        >
                          <Download size={16} /> 
                        </button>
                      </div>
                      
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {detailProject && (
        <div className="pj-modal-backdrop" onClick={() => setDetailProject(null)}>
          <div className="pj-modal" onClick={e => e.stopPropagation()}>
            <button className="pj-modal-close" onClick={() => setDetailProject(null)}><X size={18} /></button>
            <h3 className="pj-modal-title">{detailProject.name} — Details</h3>
            <p className="pj-modal-sub">Complete overview of your project progress</p>
            <div className="pj-modal-stats">
              <div className="pj-modal-stat"><span className="pj-modal-stat-label">Total Features Visited</span><span className="pj-modal-stat-value">{detailProject.module_count}</span></div>
              <div className="pj-modal-stat"><span className="pj-modal-stat-label">Total Duration</span><span className="pj-modal-stat-value">{formatDuration(detailProject.total_duration_seconds)}</span></div>
            </div>
            <h4 className="pj-modal-breakdown-title">Feature Breakdown</h4>
            <div className="pj-modal-breakdown">
              {(() => { const td: Record<string, number> = {}; detailProject.steps.forEach(s => { if (s.started_at && s.ended_at) { const d = (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000; td[s.tool_key] = (td[s.tool_key] || 0) + d; } }); return Object.entries(td).map(([t, d]) => (<div key={t} className="pj-modal-feature"><div className="pj-modal-feature-header"><span className="pj-modal-feature-icon">{TOOL_ICONS[t]||'🔧'}</span><span className="pj-modal-feature-name">{TOOL_LABELS[t]||t}</span></div><div className="pj-modal-feature-meta"><span>Duration</span><strong>{formatDuration(Math.round(d))}</strong></div></div>)); })()}
            </div>
            <div className="pj-modal-actions"><button className="pj-modal-btn" onClick={() => setDetailProject(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataExchangeView;
