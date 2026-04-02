import { useState, useRef } from 'react';
import { 
  ArrowLeft, BarChart2, Database, Upload, Search, Loader2, FileText, Code2, 
  Sparkles, Image as ImageIcon, FileSpreadsheet, Music, Video, ArrowRight 
} from 'lucide-react';
import { toast } from 'sonner';
import './ToolPage.css';
import {
  analyzeTextFile,
  analyzeCodebase,
  analyzeGithubRepo,
  analyzeImages,
  TextAnalysisResult,
  CodeAnalysisResult,
  MultiImageAnalysisResponse
} from './services';
import MermaidDiagram from '../../../components/MermaidDiagram';

const generateMermaidGraph = (arch: any) => {
  if (!arch || !arch.components || !arch.connections) return '';
  let mermaidStr = 'flowchart TB\n'; // Use TB (Top-Bottom) for layered view
  
  // Group components by layer
  const layers: Record<string, any[]> = {};
  arch.components.forEach((c: any) => {
    const layer = c.layer || 'other';
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(c);
  });

  // Create Subgraphs for Layers
  Object.entries(layers).forEach(([layerName, comps]) => {
    mermaidStr += `  subgraph ${layerName} ["${layerName.toUpperCase()} LAYER"]\n`;
    comps.forEach(c => {
      mermaidStr += `    node_${c.id}["${c.name}"]\n`;
    });
    mermaidStr += `  end\n`;
  });
  
  // Create edges (Connections)
  arch.connections.forEach((conn: any) => {
    const src = `node_${conn.source}`;
    const tgt = `node_${conn.target}`;
    const label = conn.description.replace(/"/g, "'");
    mermaidStr += `  ${src} -->|"${label}"| ${tgt}\n`;
  });

  mermaidStr += `  linkStyle default stroke:#fb8c36,stroke-width:1.5px,color:white
  classDef default fill:#1e293b,stroke:#fb8c36,stroke-width:2px,color:#f8fafc,rx:8px,ry:8px
  style presentation fill:#0f172a,stroke:#60a5fa,stroke-dasharray: 5 5
  style application fill:#0f172a,stroke:#a78bfa,stroke-dasharray: 5 5
  style domain fill:#0f172a,stroke:#4ade80,stroke-dasharray: 5 5
  style infrastructure fill:#0f172a,stroke:#f472b6,stroke-dasharray: 5 5`;

  return mermaidStr;
};

type DatasetTab = 'catalog' | 'upload';
type FileType = 'csv' | 'text' | 'pdf' | 'images' | 'videos' | 'music' | 'code';

const FILE_TYPES: { id: FileType; label: string; desc: string; icon: any }[] = [
  { id: 'csv',    label: 'CSV Data',  desc: 'Tabular data & spreadsheets', icon: FileSpreadsheet },
  { id: 'text',   label: 'Text File', desc: 'Plain text & documents',     icon: FileText },
  { id: 'pdf',    label: 'PDF Doc',   desc: 'PDF reports & exports',      icon: Search }, 
  { id: 'images', label: 'Images',    desc: 'Multi-image analysis',       icon: ImageIcon },
  { id: 'code',   label: 'Codebase',  desc: 'ZIP repo analysis',          icon: Code2 },
  { id: 'videos', label: 'Videos',    desc: 'Video streams & files',      icon: Video },
  { id: 'music',  label: 'Audio',     desc: 'Voice & sound analysis',     icon: Music },
];

const DATASETS = [
  {
    name: 'Details of Beneficiaries under Saakshar Bharat Programme (karkkum Bharatham Thittam) by Districts in Tamil Nadu from 2010-11 to 2017-18',
    desc: 'Details of Beneficiaries under Saakshar Bharat Programme (karkkum Bharatham Thittam) by Districts in Tamil Nadu from 2010-11 to 2017-18',
    category: 'Adult Education',
  },
  {
    name: 'Enrolment in school education from 1950-51 to 2009-10',
    desc: 'No description available',
    category: 'Adult Education',
  },
  {
    name: 'District-wise Number of Recognised Schools in India',
    desc: 'Statistical data on school infrastructure across all districts in India',
    category: 'Education',
  },
  {
    name: 'Customer Purchase Behavior Analytics',
    desc: 'Shopping patterns and purchase history across categories',
    category: 'Commerce',
  },
  {
    name: 'Sales Performance Data Q4 2025',
    desc: 'Regional sales data with trend indicators and forecasts',
    category: 'Business',
  },
  {
    name: 'Product Inventory Records',
    desc: 'Real-time inventory tracking data with stock levels',
    category: 'Operations',
  },
];

const DataVizPage = ({ onBack }: { onBack: () => void }) => {
  const [activeTab, setActiveTab] = useState<DatasetTab>('catalog');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // -- Wizard State --
  const [fileType, setFileType] = useState<FileType>('images');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [githubUrl, setGithubUrl] = useState('');
  
  // -- Analysis State --
  const [loading, setLoading] = useState(false);
  const [textResult, setTextResult] = useState<TextAnalysisResult | null>(null);
  const [codeResult, setCodeResult] = useState<CodeAnalysisResult | null>(null);
  const [imgResult, setImgResult] = useState<MultiImageAnalysisResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -- Mock Data for Samples --
  const MOCK_IMG_RESULT: MultiImageAnalysisResponse = {
    results: [
      { filename: 'scenic_view.jpg', caption: 'A beautiful mountain range with a clear blue lake at sunset.', detections: [{ x1: 0, y1: 0, x2: 10, y2: 10, label: 'Mountain', confidence: 0.98 }] },
      { filename: 'city_street.jpg', caption: 'Busy city intersection with yellow taxis and tall skyscrapers.', detections: [{ x1: 0, y1: 0, x2: 10, y2: 10, label: 'Car', confidence: 0.95 }] },
      { filename: 'tech_office.jpg', caption: 'A modern open-plan office with developers working on multiple monitors.', detections: [{ x1: 0, y1: 0, x2: 10, y2: 10, label: 'Person', confidence: 0.92 }] },
    ],
    projection: [
      { x: -2, y: 3, cluster: 0, filename: 'scenic_view.jpg' },
      { x: 4, y: -1, cluster: 1, filename: 'city_street.jpg' },
      { x: 3.5, y: -2, cluster: 1, filename: 'tech_office.jpg' },
    ],
    clusters: [
      { cluster_id: 0, description: 'Nature & Landscapes', count: 1 },
      { cluster_id: 1, description: 'Urban & Technology', count: 2 },
    ]
  };

  const MOCK_TEXT_RESULT: TextAnalysisResult = {
    summary: "The AI Kosh project aims to build a state-of-the-art multimodal analysis platform. This document outlines the core architecture, including the integration of YOLO for vision and transformer models for text summarization. Key focus areas are real-time processing and modular scalability.",
    sentiment: { positive: 0.8, negative: 0.05, neutral: 0.15, overall_label: 'Positive' },
    entities: [],
    kg_nodes: [],
    kg_edges: [],
    timeline: [
      { date: '2026-01-01', description: 'Project Kickoff' },
      { date: '2026-03-15', description: 'Core Engine V1 Alpha' },
    ],
    locations: []
  };

  const MOCK_CODE_RESULT: CodeAnalysisResult = {
    filename: 'sample_ecommerce.zip',
    file_count: 42,
    architecture: {
      title: 'E-commerce Microservices',
      summary: 'A distributed system architecture using Node.js for services and React for the storefront. The backend exposes REST APIs consumed by the frontend component.',
      detected_patterns: ['Microservices', 'RESTful API', 'JWT Authentication', 'Provider Pattern'],
      components: [
        { id: '1', name: 'Auth Service', type: 'Backend', layer: 'infrastructure', description: 'Handles user authentication and JWT management.', files: ['auth/src/index.js', 'auth/src/jwt.js'] },
        { id: '2', name: 'Catalog Service', type: 'Backend', layer: 'domain', description: 'Manages product listings and inventory.', files: ['catalog/db.js', 'catalog/routes.js'] },
        { id: '3', name: 'Web Storefront', type: 'Frontend', layer: 'presentation', description: 'Responsive React-based user interface.', files: ['store/App.jsx', 'store/Cart.jsx'] },
      ],
      connections: [
        { source: '3', target: '1', type: 'api_call', description: 'Web storefront requests tokens' },
        { source: '3', target: '2', type: 'api_call', description: 'Fetches product data' }
      ]
    },
    details: { 
      key_files: [
        { file_path: 'auth/src/index.js', summary: 'Entry point for auth middleware', key_functions: ['verifyToken: validates JWT', 'login: user auth endpoint'] },
        { file_path: 'catalog/routes.js', summary: 'Defines REST endpoints for querying inventory', key_functions: ['listProducts: returns array of available items'] }
      ],
      flow: [
        { step: 1, description: 'User visits the Web Storefront.' },
        { step: 2, description: 'Web Storefront requests authentication via Auth Service.' },
        { step: 3, description: 'User navigates catalog, triggering API calls to Catalog Service.' }
      ]
    }
  };

  const filtered = DATASETS.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.desc.toLowerCase().includes(search.toLowerCase())
  );

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      toast.success(`${files.length} file(s) selected`);
    }
  };

  const handleUseSample = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (fileType === 'images') {
        setImgResult(MOCK_IMG_RESULT);
        toast.success("Loaded Image Sample");
      } else if (fileType === 'code') {
        setCodeResult(MOCK_CODE_RESULT);
        toast.success("Loaded Codebase Sample");
      } else if (['csv', 'text', 'pdf'].includes(fileType)) {
        setTextResult(MOCK_TEXT_RESULT);
        toast.success(`Loaded ${fileType.toUpperCase()} Sample`);
      } else {
        toast.info(`Sample for ${fileType} coming soon!`);
      }
    }, 800);
  };

  const handleContinue = async () => {
    const usingGithub = fileType === 'code' && githubUrl.trim().length > 5;
    
    if (selectedFiles.length === 0 && !usingGithub) {
       toast.error("Please select a file or provide a valid GitHub URL");
       return;
    }

    setLoading(true);
    setTextResult(null);
    setCodeResult(null);
    setImgResult(null);

    // 1) Github Fast-Path
    if (usingGithub) {
      try {
        toast.loading(`Cloning and analyzing ${githubUrl}...`, { id: 'analysis' });
        const res = await analyzeGithubRepo(githubUrl);
        setCodeResult(res);
        toast.success('GitHub analysis complete!', { id: 'analysis' });
      } catch (err: any) {
        toast.error(err.message || 'GitHub Analysis failed', { id: 'analysis' });
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2) Standard File Processing
    const files = selectedFiles;
    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
    const isDoc = files.length === 1 && (files[0].name.toLowerCase().endsWith('.pdf') || files[0].name.toLowerCase().endsWith('.txt'));
    const isImages = files.every(f => f.type.startsWith('image/'));

    try {
      if (isZip) {
        toast.loading('Analyzing codebase architecture...', { id: 'analysis' });
        const res = await analyzeCodebase(files[0]);
        setCodeResult(res);
        toast.success('Code analysis complete!', { id: 'analysis' });
      } else if (isDoc) {
        toast.loading('Extracting insights from document...', { id: 'analysis' });
        const res = await analyzeTextFile(files[0]);
        setTextResult(res);
        toast.success('Document analysis complete!', { id: 'analysis' });
      } else if (isImages) {
        toast.loading(`Analyzing ${files.length} images...`, { id: 'analysis' });
        const res = await analyzeImages(files);
        setImgResult(res);
        toast.success('Image analysis complete!', { id: 'analysis' });
      } else {
        toast.error('Unsupported file combo.', { id: 'analysis' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed', { id: 'analysis' });
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      {/* Header */}
      <div className="xt-header">
        <div className="xt-header-icon">
          <BarChart2 size={26} />
        </div>
        <div>
          <h1 className="xt-header-title">Data Visualization & Analysis</h1>
          <p className="xt-header-subtitle">Analyze Documents or Codebases with Multi-modal AI</p>
        </div>
      </div>

      {/* Dataset selection panel */}
      <div className="xt-panel">
        <div className="xt-tabs">
          <button
            className={`xt-tab${activeTab === 'catalog' ? ' active' : ''}`}
            onClick={() => setActiveTab('catalog')}
          >
            <Database size={15} /> Data Catalog
          </button>
          <button
            className={`xt-tab${activeTab === 'upload' ? ' active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <Upload size={15} /> AI Analysis (Upload)
          </button>
        </div>

        {activeTab === 'catalog' && (
          <div className="view-animate-in">
            <h2 className="xt-panel-title">Explore Dataset Catalog</h2>
            <div className="xt-search-wrap">
              <Search size={15} className="xt-search-icon" />
              <input
                className="xt-search-input"
                placeholder="Search datasets by name, description, or tags..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <p className="xt-count">Found {filtered.length > 3 ? '1913' : filtered.length} datasets</p>
            <div className="xt-dataset-list">
              {filtered.map(d => (
                <div
                  key={d.name}
                  className={`xt-dataset-row${selected === d.name ? ' selected' : ''}`}
                  onClick={() => setSelected(d.name)}
                >
                  <div className="xt-dataset-info">
                    <span className="xt-dataset-name">{d.name}</span>
                    <span className="xt-dataset-desc">{d.desc}</span>
                  </div>
                  <span className="xt-dataset-badge">{d.category}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="view-animate-in">
            {!textResult && !codeResult && !imgResult ? (
              <div className="wizard-container" style={{boxShadow: 'none', border: 'none', background: 'transparent', padding: '20px 0'}}>
                {/* Step 1: Type Selection */}
                <div className="wizard-header" style={{textAlign: 'left', marginBottom: '20px'}}>
                  <h2 style={{fontSize: '18px'}}>1. Select Analysis Type</h2>
                  <p>Choose the format of the data you want to analyze with AI.</p>
                </div>
                <div className="type-grid" style={{gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px'}}>
                  {FILE_TYPES.map(type => (
                    <div 
                      key={type.id} 
                      className={`type-card${fileType === type.id ? ' active' : ''}`}
                      onClick={() => setFileType(type.id)}
                      style={{padding: '15px'}}
                    >
                      <div className="icon-box" style={{width: '32px', height: '32px', marginBottom: '8px'}}>
                        <type.icon size={18} />
                      </div>
                      <span style={{fontSize: '11px', fontWeight: 'bold'}}>{type.label}</span>
                      <span style={{fontSize: '9px', opacity: 0.7, marginTop: '2px'}}>{type.desc}</span>
                    </div>
                  ))}
                </div>

                {/* Step 2: Action Area */}
                <div className="wizard-header" style={{textAlign: 'left', marginBottom: '20px', marginTop: '30px'}}>
                  <h2 style={{fontSize: '18px'}}>2. Provide Dataset</h2>
                  <p>Upload your own files or use a curated sample for demonstration.</p>
                </div>
                
                <div style={{display: 'grid', gridTemplateColumns: fileType === 'code' ? '1fr 1fr 200px' : '1fr 200px', gap: '20px'}}>
                  <div className="action-area" onClick={() => !loading && fileInputRef.current?.click()} style={{marginBottom: 0, padding: '20px'}}>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={onFilesSelected}
                      style={{ display: 'none' }}
                      multiple
                      accept=".txt,.pdf,.zip,image/*"
                    />
                    <div className="action-icon" style={{marginBottom: '8px'}}>
                      {loading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                    </div>
                    <div className="action-title" style={{fontSize: '14px'}}>
                      {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : 'Upload File'}
                    </div>
                  </div>

                  {fileType === 'code' && (
                    <div className="action-area" style={{marginBottom: 0, padding: '20px', cursor: 'default'}}>
                      <div className="action-icon" style={{marginBottom: '8px'}}>
                        <Code2 size={24} />
                      </div>
                      <div className="action-title" style={{fontSize: '14px', marginBottom: '10px'}}>GitHub Repository</div>
                      <input 
                        type="url"
                        className="xt-search-input"
                        placeholder="https://github.com/..."
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        style={{ width: '100%', background: '#0f172a', border: '1px solid #334155' }}
                      />
                      <button 
                        onClick={() => setGithubUrl('https://github.com/tiangolo/fastapi')} 
                        style={{marginTop: '10px', fontSize: '11px', color: '#60a5fa', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline'}}
                      >
                        Try Sample: https://github.com/tiangolo/fastapi
                      </button>
                    </div>
                  )}

                  <div className="action-area" style={{marginBottom: 0, padding: '20px', cursor: 'default', borderStyle: 'solid'}}>
                    <div className="action-icon" style={{marginBottom: '8px'}}>
                      <Database size={24} />
                    </div>
                    <div className="action-title" style={{fontSize: '14px'}}>Demo Run</div>
                    <button className="sample-file-btn" onClick={handleUseSample} disabled={loading} style={{width: '100%'}}>
                      Use Sample
                    </button>
                  </div>
                </div>

                {/* Step 3: Footer */}
                <div className="wizard-footer" style={{marginTop: '30px', justifyContent: 'flex-end'}}>
                  <button 
                    className="continue-btn" 
                    onClick={handleContinue}
                    disabled={loading || (selectedFiles.length === 0 && !(fileType === 'code' && githubUrl.trim().length > 5))}
                    style={{maxWidth: '200px', padding: '12px'}}
                  >
                    {loading ? 'Analyzing...' : 'Run Analysis'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="analysis-results">
                <div className="results-header">
                  <h3>Analysis Results</h3>
                  <button className="xt-upload-btn" onClick={() => { setTextResult(null); setCodeResult(null); setImgResult(null); setSelectedFiles([]); }}>
                    Analyze Another File
                  </button>
                </div>

                {textResult && (
                  <div className="result-card">
                    <div className="summary-section">
                      <h4><Sparkles size={16} /> Summary</h4>
                      <p>{textResult.summary}</p>
                    </div>
                    <div className="stats-grid">
                      <div className="stat-pill positive">Positive: {(textResult.sentiment.positive * 100).toFixed(0)}%</div>
                      <div className="stat-pill negative">Negative: {(textResult.sentiment.negative * 100).toFixed(0)}%</div>
                      <div className="stat-pill neutral">Neutral: {(textResult.sentiment.neutral * 100).toFixed(0)}%</div>
                    </div>
                    {textResult.timeline.length > 0 && (
                      <div className="timeline-section">
                        <h4>Timeline</h4>
                        <div className="timeline-list">
                          {textResult.timeline.map((ev, i) => (
                            <div key={i} className="timeline-item">
                              <span className="date">{ev.date}</span>
                              <span className="desc">{ev.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {codeResult && (
                  <div className="code-analysis-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div className="viz-row">
                        <div className="result-card" style={{ flex: 1 }}>
                          <div className="summary-section">
                            <h4><Code2 size={16} /> {codeResult.architecture.title}</h4>
                            <p>{codeResult.architecture.summary}</p>
                          </div>

                          {codeResult.architecture.detected_patterns.length > 0 && (
                            <div style={{ marginTop: '15px' }}>
                              <h4 style={{ color: '#fb8c36', fontSize: '13px', marginBottom: '8px' }}>Detected Design Patterns</h4>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {codeResult.architecture.detected_patterns.map((p, i) => (
                                  <span key={i} className="chip" style={{ background: 'rgba(251, 140, 54, 0.1)', color: '#fb8c36', borderColor: 'rgba(251, 140, 54, 0.3)' }}>
                                    <Sparkles size={10} /> {p}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          <h4 style={{ color: '#fb8c36', marginTop: '15px', marginBottom: '10px' }}>Architecture Components</h4>
                          <div className="components-grid" style={{ marginTop: 0 }}>
                            {codeResult.architecture.components.map(c => (
                              <div key={c.id} className="comp-item">
                                <strong>{c.name}</strong>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>{c.type}</span>
                                  <span style={{ color: '#60a5fa' }}>{c.layer}</span>
                                </div>
                                <p>{c.description}</p>
                                {c.files.length > 0 && (
                                  <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {c.files.slice(0, 8).map((f: any, i: number) => <span key={i} className="chip">{f}</span>)}
                                    {c.files.length > 8 && <span className="chip" style={{ background: '#334155', color: '#cbd5e1' }}>+{c.files.length - 8} more</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {codeResult.architecture.connections.length > 0 && (
                            <>
                              <h4 style={{ color: '#fb8c36', marginTop: '20px', marginBottom: '10px' }}>Architecture Diagram</h4>
                              <div style={{ background: '#020617', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b', marginTop: '10px' }}>
                                <MermaidDiagram chart={generateMermaidGraph(codeResult.architecture)} />
                              </div>

                              <h4 style={{ color: '#fb8c36', marginTop: '20px', marginBottom: '10px' }}>Dependencies</h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {codeResult.architecture.connections.map((conn, idx) => {
                                  const src = codeResult.architecture.components.find(c => c.id === conn.source)?.name || conn.source;
                                  const tgt = codeResult.architecture.components.find(c => c.id === conn.target)?.name || conn.target;
                                  return (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', background: '#1e293b', padding: '10px', borderRadius: '8px' }}>
                                      <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{src}</span>
                                      <ArrowRight size={14} color="#94a3b8" />
                                      <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{tgt}</span>
                                      <span style={{ color: '#94a3b8', fontStyle: 'italic', marginLeft: 'auto' }}>{conn.description}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </div>

                        <div className="result-card" style={{ width: '280px' }}>
                          <h4 style={{ color: '#fb8c36', marginTop: 0 }}>System Flow</h4>
                          <div className="timeline-list" style={{ marginTop: '15px' }}>
                            {codeResult.details.flow.map(f => (
                              <div key={f.step} className="timeline-item">
                                <span className="date">Step {f.step}</span>
                                <span className="desc" style={{ display: 'block', marginTop: '4px', lineHeight: 1.4 }}>{f.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                    </div>
                    
                    {codeResult.details.key_files.length > 0 && (
                      <div className="result-card">
                        <h4 style={{ color: '#fb8c36', marginTop: 0 }}>Deep Analysis: Core Files</h4>
                        <div className="key-files-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px', marginTop: '15px' }}>
                          {codeResult.details.key_files.map((kf, i) => (
                            <div key={i} style={{ background: '#1e293b', padding: '15px', borderRadius: '8px' }}>
                              <div style={{ fontWeight: 'bold', color: '#f1f5f9', marginBottom: '5px' }}>{kf.file_path}</div>
                              <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '10px', lineHeight: 1.4 }}>{kf.summary}</p>
                              {kf.key_functions.length > 0 && (
                                <div style={{ background: '#0f172a', padding: '10px', borderRadius: '6px' }}>
                                  <div style={{ fontSize: '10px', color: '#fb8c36', textTransform: 'uppercase', marginBottom: '5px', letterSpacing: '1px' }}>Key Functions</div>
                                  <ul style={{ margin: 0, paddingLeft: '15px', color: '#cbd5e1', fontSize: '11px', lineHeight: 1.5 }}>
                                    {kf.key_functions.map((func, j) => <li key={j}>{func}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {imgResult && (
                  <div className="img-analysis-view">
                    <div className="viz-row">
                      <div className="scatter-box result-card">
                        <h4><BarChart2 size={16} /> UMAP Projection</h4>
                        <p className="viz-desc">Semantic clustering of uploaded images based on CLIP embeddings.</p>
                        <div className="scatter-plot">
                          <svg viewBox="0 0 100 100" className="umap-svg">
                            {imgResult.projection.map((p, i) => (
                              <circle
                                key={i}
                                cx={50 + p.x * 10}
                                cy={50 + p.y * 10}
                                r="1.5"
                                fill={`var(--cluster-${p.cluster % 5})`}
                                className="dot"
                              >
                                <title>{p.filename} (Cluster {p.cluster})</title>
                              </circle>
                            ))}
                          </svg>
                        </div>
                      </div>
                      <div className="clusters-box result-card">
                        <h4>Clusters</h4>
                        <div className="cluster-list">
                          {imgResult.clusters.map(c => (
                            <div key={c.cluster_id} className="cluster-item">
                              <span className="cluster-dot" style={{ background: `var(--cluster-${c.cluster_id % 5})` }}></span>
                              <div>
                                <strong>{c.description}</strong>
                                <span>{c.count} images</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="image-grid">
                      {imgResult.results.map((res, i) => (
                        <div key={i} className="img-card result-card">
                          <div className="img-thumbnail">
                            <ImageIcon size={24} color="#334155" />
                            <span className="filename-small">{res.filename}</span>
                          </div>
                          <div className="img-details">
                            <p className="caption">"{res.caption}"</p>
                            <div className="detections">
                              {res.detections.slice(0, 3).map((d, j) => (
                                <span key={j} className="det-tag">{d.label} {Math.round(d.confidence * 100)}%</span>
                              ))}
                              {res.detections.length > 3 && <span className="det-tag">+{res.detections.length - 3} more</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .xt-file-chips { display: flex; gap: 10px; margin-top: 15px; }
        .chip { background: #1e293b; padding: 4px 10px; border-radius: 20px; font-size: 11px; display: flex; align-items: center; gap: 5px; color: #94a3b8; border: 1px solid #334155; }
        .analysis-results { padding: 20px; color: #f1f5f9; }
        .results-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .result-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
        .summary-section h4 { display: flex; align-items: center; gap: 8px; color: #fb8c36; margin-top: 0; }
        .stats-grid { display: flex; gap: 10px; margin: 15px 0; }
        .stat-pill { padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; }
        .stat-pill.positive { background: rgba(34, 197, 94, 0.1); color: #4ade80; }
        .stat-pill.negative { background: rgba(239, 68, 68, 0.1); color: #f87171; }
        .stat-pill.neutral { background: rgba(148, 163, 184, 0.1); color: #94a3b8; }
        .timeline-section h4 { color: #fb8c36; margin-bottom: 10px; }
        .timeline-list { display: flex; flex-direction: column; gap: 8px; border-left: 1px solid #334155; padding-left: 15px; }
        .timeline-item { font-size: 13px; }
        .timeline-item .date { color: #fb8c36; font-weight: bold; margin-right: 10px; }
        .components-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .comp-item { background: #1e293b; padding: 12px; border-radius: 8px; font-size: 12px; }
         .comp-item strong { color: #fb8c36; display: block; margin-bottom: 4px; }
        .comp-item span { color: #94a3b8; font-size: 10px; text-transform: uppercase; }
        .comp-item p { margin: 8px 0 0; line-height: 1.4; color: #cbd5e1; }

        /* Image Analysis Styles */
        :root {
          --cluster-0: #fb8c36;
          --cluster-1: #4ade80;
          --cluster-2: #60a5fa;
          --cluster-3: #a78bfa;
          --cluster-4: #f472b6;
        }
        .img-analysis-view { display: flex; flex-direction: column; gap: 20px; }
        .viz-row { display: grid; grid-template-columns: 1fr 250px; gap: 20px; }
        .umap-svg { width: 100%; height: 300px; background: #020617; border-radius: 8px; border: 1px solid #1e293b; }
        .dot { transition: transform 0.2s; cursor: crosshair; }
        .dot:hover { transform: scale(3); stroke: white; stroke-width: 0.5px; }
        .cluster-list { display: flex; flex-direction: column; gap: 12px; margin-top: 15px; }
        .cluster-item { display: flex; align-items: center; gap: 10px; font-size: 12px; }
        .cluster-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .cluster-item span { color: #94a3b8; font-size: 10px; display: block; }
        .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }
        .img-card { padding: 12px !important; display: flex; gap: 12px; }
        .img-thumbnail { width: 60px; height: 60px; background: #1e293b; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
        .filename-small { font-size: 8px; color: #94a3b8; margin-top: 4px; text-align: center; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
        .img-details { flex: 1; }
        .caption { font-size: 12px; color: #f1f5f9; font-style: italic; margin-bottom: 8px; line-height: 1.4; }
        .detections { display: flex; flex-wrap: wrap; gap: 4px; }
        .det-tag { background: #334155; color: #cbd5e1; font-size: 9px; padding: 2px 6px; border-radius: 4px; }
        .viz-desc { font-size: 12px; color: #94a3b8; margin-bottom: 10px; }
      `}</style>
    </div>
  );
};

export default DataVizPage;
