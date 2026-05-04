import { Database, Brain, Sparkles, ArrowRight, ChevronDown, Trash2, X, Layers, Zap, CheckCircle2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import {
  createProject, getProjects, deleteProject, completeProject, getProjectDetail,
  registerUnloadHandler, formatDuration, TOOL_LABELS, TOOL_ICONS, TOOL_COLORS,
  type Project,
} from '../projectService';
import './HomeView.css';
import watermarkLogo from '../../assets/looplogo.png';

interface HomeViewProps {
  onNavigate: (viewId: string) => void;
}

// ── Feature data ──────────────────────────────────────────────────────────────
const featureData = [
  {
    id: 'data',
    icon: <Database size={22} />,
    label: 'Data Exchange',
    tag: '04 tools',
    description:
      'OCR, visualization, feature engineering, and anonymization—every data prep capability you need on one surface.',
    accent: '#38bdf8',
    accentRgb: '56,189,248',
  },
  {
    id: 'model',
    icon: <Brain size={22} />,
    label: 'Model Exchange',
    tag: 'AutoML',
    description:
      'Train, evaluate and deploy ML models through a guided AutoML pipeline. Experiment at scale without the boilerplate.',
    accent: '#fb8c36',
    accentRgb: '251,140,54',
  },
  {
    id: 'datasets',
    icon: <Database size={22} />,
    label: 'Datasets',
    tag: 'Public Data',
    description:
      'Explore, search, and download public datasets to fuel your machine learning and AI experiments.',
    accent: '#a78bfa',
    accentRgb: '167,139,250',
  },
];

// ── Card component ────────────────────────────────────────────────────────────
interface CardProps {
  feature: (typeof featureData)[0];
  onNavigate: (id: string) => void;
  index: number;
}
const FeatureCard = ({ feature, onNavigate, index }: CardProps) => {
  const [hovered, setHovered] = useState(false);
  return (
    <article
      className="fc fc--icon-only"
      data-index={index}
      style={{ '--accent': feature.accent, '--accent-rgb': feature.accentRgb } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="fc-corner" />
      <div className="fc-body">
        <div className="fc-icon">{feature.icon}</div>
        <span className="fc-tag">{feature.tag}</span>
        <h3 className="fc-title">{feature.label}</h3>
        <p className="fc-desc">{feature.description}</p>
      </div>
      <button
        className={`fc-bubble${hovered ? ' fc-bubble--open' : ''}`}
        onClick={() => onNavigate(feature.id)}
        aria-label={`Explore ${feature.label}`}
      >
        <span className="fc-bubble-icon"><ArrowRight size={16} /></span>
        <span className="fc-bubble-text">Explore</span>
      </button>
    </article>
  );
};

// ── Project Flow Pills ───────────────────────────────────────────────────────
function ProjectFlowPills({ steps }: { steps: Project['steps'] }) {
  // Deduplicate tools in order of first appearance
  const seen = new Set<string>();
  const uniqueTools: string[] = [];
  for (const s of steps) {
    if (!seen.has(s.tool_key)) {
      seen.add(s.tool_key);
      uniqueTools.push(s.tool_key);
    }
  }

  return (
    <div className="pj-flow">
      {uniqueTools.map((tool, i) => (
        <span key={tool} className="pj-flow-group">
          <span className="pj-flow-pill" style={{ borderColor: TOOL_COLORS[tool] || '#666' }}>
            <span className="pj-flow-pill-icon">{TOOL_ICONS[tool] || '🔧'}</span>
            <span className="pj-flow-pill-label">{TOOL_LABELS[tool] || tool}</span>
          </span>
          {i < uniqueTools.length - 1 && <span className="pj-flow-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}

// ── Details Modal ────────────────────────────────────────────────────────────
function DetailsModal({ project, onClose }: { project: Project; onClose: () => void }) {
  // Aggregate per-tool durations
  const toolDurations: Record<string, number> = {};
  for (const s of project.steps) {
    if (s.started_at && s.ended_at) {
      const dur = (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000;
      toolDurations[s.tool_key] = (toolDurations[s.tool_key] || 0) + dur;
    }
  }

  return (
    <div className="pj-modal-backdrop" onClick={onClose}>
      <div className="pj-modal" onClick={e => e.stopPropagation()}>
        <button className="pj-modal-close" onClick={onClose}><X size={18} /></button>
        <h3 className="pj-modal-title">{project.name} — Details</h3>
        <p className="pj-modal-sub">Complete overview of your project progress</p>

        <div className="pj-modal-stats">
          <div className="pj-modal-stat">
            <span className="pj-modal-stat-label">Total Features Visited</span>
            <span className="pj-modal-stat-value">{project.module_count}</span>
          </div>
          <div className="pj-modal-stat">
            <span className="pj-modal-stat-label">Total Duration</span>
            <span className="pj-modal-stat-value">{formatDuration(project.total_duration_seconds)}</span>
          </div>
        </div>

        <h4 className="pj-modal-breakdown-title">Feature Breakdown</h4>
        <div className="pj-modal-breakdown">
          {Object.entries(toolDurations).map(([tool, dur]) => (
            <div key={tool} className="pj-modal-feature">
              <div className="pj-modal-feature-header">
                <span className="pj-modal-feature-icon">{TOOL_ICONS[tool] || '🔧'}</span>
                <span className="pj-modal-feature-name">{TOOL_LABELS[tool] || tool}</span>
              </div>
              <div className="pj-modal-feature-meta">
                <span>Duration</span>
                <strong>{formatDuration(Math.round(dur))}</strong>
              </div>
            </div>
          ))}
          {Object.keys(toolDurations).length === 0 && (
            <div className="pj-modal-empty">No completed tool sessions yet.</div>
          )}
        </div>

        <div className="pj-modal-actions">
          <button className="pj-modal-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── HomeView ──────────────────────────────────────────────────────────────────
const HomeView = ({ onNavigate }: HomeViewProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [startFeature, setStartFeature] = useState('');
  const [isFeatureOpen, setIsFeatureOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  const startOptions = [
    { value: 'ocr', label: 'OCR Conversion' },
    { value: 'viz', label: 'Data Visualization' },
    { value: 'feat', label: 'Feature Engineering' },
    { value: 'anon', label: 'Data Anonymization' },
    { value: 'automl', label: 'AutoML' },
  ];

  const loadProjects = useCallback(async () => {
    try {
      const all = await getProjects();
      setProjects(all);
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    registerUnloadHandler();
  }, [loadProjects]);

  const activeProjects = projects.filter(p => p.status === 'active');
  const completedProjects = projects.filter(p => p.status === 'completed');

  const handleStartProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!projectName.trim() || !startFeature) return;
    setLoading(true);
    try {
      const proj = await createProject(projectName, startFeature);
      // Store active project id in sessionStorage so DataExchangeView can track steps
      sessionStorage.setItem('active-project-id', String(proj.id));
      sessionStorage.setItem('active-step-id', String(proj.steps?.[0]?.id || ''));

      setShowProjectModal(false);
      setIsFeatureOpen(false);
      setProjectName('');
      setStartFeature('');

      if (startFeature === 'automl') {
        onNavigate('model');
      } else {
        sessionStorage.setItem('home-start-tool', startFeature);
        onNavigate('data');
      }
    } catch (e) {
      console.error('Failed to create project:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (id: number) => {
    try {
      await deleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      console.error('Failed to delete project:', e);
    }
  };

  const handleCompleteProject = async (id: number) => {
    try {
      await completeProject(id);
      loadProjects();
    } catch (e) {
      console.error('Failed to complete project:', e);
    }
  };

  const handleResumeProject = (p: Project) => {
    sessionStorage.setItem('active-project-id', String(p.id));
    // Find the last tool used
    const lastTool = p.steps.length > 0 ? p.steps[p.steps.length - 1].tool_key : p.starting_tool;
    if (lastTool === 'automl') {
      onNavigate('model');
    } else {
      sessionStorage.setItem('home-start-tool', lastTool);
      onNavigate('data');
    }
  };

  const handleShowDetails = async (p: Project) => {
    try {
      const detail = await getProjectDetail(p.id);
      setDetailProject(detail);
    } catch {
      setDetailProject(p);
    }
  };

  return (
    <div className="view-animate-in hv-shell">
      {/* centered watermark */}
      <div className="hv-watermark" aria-hidden="true">
        <div className="hv-watermark-halo" />
        <img src={watermarkLogo} alt="" className="hv-watermark-img" />
      </div>

      <div className="hv-top">
        {/* hero */}
        <header className="hv-hero">
          <h1 className="hv-hero-title">Welcome to&nbsp;<em>Data2Insight&nbsp;AI</em></h1>
          <div className="hv-hero-badge">
            <Sparkles size={13} />
            <span>AI Innovation Hub</span>
          </div>
          <p className="hv-hero-sub">
            Exchange Data, Models, and Use Cases—everything you need<br />
            to build AI solutions in one unified platform.
          </p>
          <div className="hv-hero-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button className="hv-hero-cta" onClick={() => setShowProjectModal(true)}>
              <span>Start New Project</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </header>
      </div>

      {/* cards */}
      <section className="hv-cards">
        {featureData.map((f, i) => (
          <FeatureCard key={f.id} feature={f} onNavigate={onNavigate} index={i} />
        ))}
      </section>

      {/* ── Active Projects ── */}
      {activeProjects.length > 0 && (
        <section className="pj-section">
          <h2 className="pj-section-title">
            <Zap size={20} className="pj-section-icon pj-section-icon--active" />
            Your Active Projects
          </h2>
          <div className="pj-grid">
            {activeProjects.map(p => (
              <div key={p.id} className="pj-card pj-card--active">
                <div className="pj-card-header">
                  <div>
                    <h3 className="pj-card-name">{p.name}</h3>
                    <span className="pj-card-subtitle">Started with {TOOL_LABELS[p.starting_tool] || p.starting_tool}</span>
                  </div>
                  <div className="pj-card-badges">
                    <span className="pj-status-badge pj-status-badge--active">
                      <span className="pj-status-dot" /> Active
                    </span>
                    <button className="pj-delete-btn" onClick={() => handleDeleteProject(p.id)} title="Delete project">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="pj-card-flow-label">Project Flow</div>
                <ProjectFlowPills steps={p.steps} />

                <div className="pj-card-stats">
                  <div className="pj-card-stat">
                    <span className="pj-card-stat-label">Modules</span>
                    <span className="pj-card-stat-value">{p.module_count}</span>
                  </div>
                  <div className="pj-card-stat">
                    <span className="pj-card-stat-label">Duration</span>
                    <span className="pj-card-stat-value">{formatDuration(p.total_duration_seconds)}</span>
                  </div>
                </div>

                <div className="pj-card-actions">
                  <button className="pj-btn pj-btn--resume" onClick={() => handleResumeProject(p)}>
                    <ArrowRight size={14} /> Resume
                  </button>
                  <button className="pj-btn pj-btn--details" onClick={() => handleShowDetails(p)}>
                    <Layers size={14} /> More Details
                  </button>
                  <button className="pj-btn pj-btn--complete" onClick={() => handleCompleteProject(p.id)} title="Mark as completed">
                    <CheckCircle2 size={14} /> Complete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Completed Projects ── */}
      {completedProjects.length > 0 && (
        <section className="pj-section">
          <h2 className="pj-section-title">
            <CheckCircle2 size={20} className="pj-section-icon" />
            Completed Projects
          </h2>
          <div className="pj-grid pj-grid--compact">
            {completedProjects.map(p => (
              <div key={p.id} className="pj-card pj-card--completed">
                <div className="pj-card-header">
                  <div>
                    <h3 className="pj-card-name">{p.name}</h3>
                    <span className="pj-card-subtitle">Started with {TOOL_LABELS[p.starting_tool] || p.starting_tool}</span>
                  </div>
                  <div className="pj-card-badges">
                    <span className="pj-status-badge pj-status-badge--completed">Completed</span>
                    <button className="pj-delete-btn" onClick={() => handleDeleteProject(p.id)} title="Delete project">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="pj-card-flow-label">Project Flow</div>
                <ProjectFlowPills steps={p.steps} />

                <div className="pj-card-actions">
                  <button className="pj-btn pj-btn--details" onClick={() => handleShowDetails(p)}>
                    <Layers size={14} /> More Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Start Project Modal ── */}
      {showProjectModal && (
        <div className="hv-modal-backdrop" onClick={() => { setShowProjectModal(false); setIsFeatureOpen(false); }}>
          <div className="hv-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="hv-modal-close"
              type="button"
              onClick={() => { setShowProjectModal(false); setIsFeatureOpen(false); }}
              aria-label="Close"
            >
              x
            </button>

            <h3 className="hv-modal-title">Start New Project</h3>
            <p className="hv-modal-sub">Create a new data processing project and select features to include.</p>

            <form className="hv-modal-form" onSubmit={handleStartProject}>
              <label className="hv-modal-label" htmlFor="project-name">Project Name</label>
              <input
                id="project-name"
                className="hv-modal-input"
                placeholder="Enter project name..."
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />

              <label className="hv-modal-label" htmlFor="start-feature">Where to Start</label>
              <div className="hv-select" id="start-feature">
                <button
                  type="button"
                  className={`hv-select-trigger${isFeatureOpen ? ' is-open' : ''}`}
                  onClick={() => setIsFeatureOpen((v) => !v)}
                >
                  <span className={!startFeature ? 'is-placeholder' : ''}>
                    {startOptions.find((o) => o.value === startFeature)?.label ?? 'Select starting feature...'}
                  </span>
                  <ChevronDown size={16} />
                </button>

                {isFeatureOpen && (
                  <div className="hv-select-menu">
                    {startOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`hv-select-option${startFeature === opt.value ? ' is-active' : ''}`}
                        onClick={() => {
                          setStartFeature(opt.value);
                          setIsFeatureOpen(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hv-modal-actions">
                <button type="button" className="hv-modal-btn hv-modal-btn--ghost" onClick={() => { setShowProjectModal(false); setIsFeatureOpen(false); }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="hv-modal-btn hv-modal-btn--primary"
                  disabled={!projectName.trim() || !startFeature || loading}
                >
                  {loading ? 'Creating...' : 'Start Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Details Modal ── */}
      {detailProject && (
        <DetailsModal project={detailProject} onClose={() => setDetailProject(null)} />
      )}
    </div>
  );
};

export default HomeView;
