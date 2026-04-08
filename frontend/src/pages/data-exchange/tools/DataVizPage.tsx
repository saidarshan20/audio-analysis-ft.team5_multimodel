import { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, BarChart2, Database, Upload, Search, Loader2, FileText, Code2, 
  Sparkles, Image as ImageIcon, FileSpreadsheet, Music, Video, ArrowRight,
  Activity, Clock, Zap, Cpu, Network, Play, Pause, Hash, MapPin
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import { toast } from 'sonner';
import './ToolPage.css';
import {
  analyzeTextFile,
  analyzeCodebase,
  analyzeGithubRepo,
  analyzeImages,
  analyzeImagesZip,
  analyzeAudio,
  TextAnalysisResult,
  CodeAnalysisResult,
  MultiImageAnalysisResponse,
  ImageZipAnalysisResponse,
  AudioAnalysisResult
} from './services';
import MermaidDiagram from '../../../components/MermaidDiagram';

type HistoryItem = {
  id: string;
  type: FileType | 'github' | 'music';
  label: string;
  timestamp: number;
  data: TextAnalysisResult | CodeAnalysisResult | MultiImageAnalysisResponse | AudioAnalysisResult;
};

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
      let shapeStart = '["';
      let shapeEnd = '"]';
      const t = c.type.toLowerCase();
      if (t.includes('database') || t.includes('storage') || t.includes('cache')) {
        shapeStart = '[("'; shapeEnd = '")]';
      } else if (t.includes('api') || t.includes('endpoint') || t.includes('interface')) {
        shapeStart = '{{"'; shapeEnd = '"}}';
      } else if (t.includes('queue') || t.includes('stream') || t.includes('event')) {
        shapeStart = '>("'; shapeEnd = '")';
      } else if (t.includes('function') || t.includes('lambda')) {
        shapeStart = '(("'; shapeEnd = '"))';
      }
      mermaidStr += `    node_${c.id}${shapeStart}${c.name}${shapeEnd}\n`;
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
type FileType = 'csv' | 'text' | 'pdf' | 'images' | 'images-zip' | 'videos' | 'music' | 'code';

const FILE_TYPES: { id: FileType; label: string; desc: string; icon: any }[] = [
  { id: 'csv',    label: 'CSV Data',  desc: 'Tabular data & spreadsheets', icon: FileSpreadsheet },
  { id: 'text',   label: 'Text File', desc: 'Plain text & documents',     icon: FileText },
  { id: 'pdf',    label: 'PDF Doc',   desc: 'PDF reports & exports',      icon: Search }, 
  { id: 'images', label: 'Images',    desc: 'Multi-image analysis',       icon: ImageIcon },
  { id: 'images-zip', label: 'Image Batch (zip)', desc: 'Batch UMAP clustering pipeline', icon: ImageIcon },
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
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [textResult, setTextResult] = useState<TextAnalysisResult | null>(null);
  const [codeResult, setCodeResult] = useState<CodeAnalysisResult | null>(null);
  const [imgResult, setImgResult] = useState<MultiImageAnalysisResponse | null>(null);
  const [imgZipResult, setImgZipResult] = useState<ImageZipAnalysisResponse | null>(null);
  const [audioResult, setAudioResult] = useState<AudioAnalysisResult | null>(null);
  const [selectedClusterPoint, setSelectedClusterPoint] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('kosh_analysis_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse history", e);
        return [];
      }
    }
    return [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveToHistory = (type: HistoryItem['type'], data: any, label: string) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      type,
      label,
      timestamp: Date.now(),
      data
    };
    const updated = [newItem, ...history].slice(0, 10); // Keep last 10
    setHistory(updated);
    localStorage.setItem('kosh_analysis_history', JSON.stringify(updated));
  };

  const loadHistoryItem = (item: HistoryItem) => {
    // Clear current results
    setTextResult(null);
    setCodeResult(null);
    setImgResult(null);

    // Filter type to restorer
    if (item.type === 'code' || item.type === 'github') {
      setCodeResult(item.data as CodeAnalysisResult);
    } else if (item.type === 'images') {
      setImgResult(item.data as MultiImageAnalysisResponse);
    } else if (item.type === 'music') {
      setAudioResult(item.data as AudioAnalysisResult);
    } else {
      setTextResult(item.data as TextAnalysisResult);
    }
    setShowHistory(false);
    toast.success(`Restored analysis: ${item.label}`);
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('kosh_analysis_history', JSON.stringify(updated));
  };

  const handleDownloadResult = () => {
    const activeData = textResult || codeResult || imgResult || audioResult;
    if (!activeData) return;

    const blob = new Blob([JSON.stringify(activeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kosh_analysis_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Analysis results exported as JSON");
  };

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
      ],
      tech_debt: [
        'Auth tokens lack automatic rotation and granular scopes, creating a maintenance burden.',
        'Catalog REST routes are missing pagination, leading to possible memory bloat on large queries.'
      ],
      security_risks: [
        'SQL Injection vulnerability in catalog search query execution.',
        'Hardcoded JWT secret keys scattered within the auth module.'
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
        saveToHistory('images', MOCK_IMG_RESULT, 'Sample: Images');
        toast.success("Loaded Image Sample");
      } else if (fileType === 'code') {
        setCodeResult(MOCK_CODE_RESULT);
        saveToHistory('code', MOCK_CODE_RESULT, 'Sample: Codebase');
        toast.success("Loaded Codebase Sample");
      } else if (['csv', 'text', 'pdf'].includes(fileType)) {
        setTextResult(MOCK_TEXT_RESULT);
        saveToHistory(fileType as any, MOCK_TEXT_RESULT, `Sample: ${fileType.toUpperCase()}`);
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
    setAnalysisStep('init');
    setProgressMsg('Initializing analysis pipeline...');
    setTextResult(null);
    setCodeResult(null);
    setImgResult(null);
    setImgZipResult(null);
    setAudioResult(null);
    setSelectedClusterPoint(null);

    const onProgress = (step: string, msg: string) => {
      setAnalysisStep(step);
      setProgressMsg(msg);
      toast.loading(msg, { id: 'analysis' });
    };

    // 1) Github Fast-Path
    if (usingGithub) {
      try {
        const res = await analyzeGithubRepo(githubUrl, onProgress);
        setCodeResult(res);
        saveToHistory('github', res, `Repo: ${githubUrl.split('/').pop()}`);
        toast.success('GitHub analysis complete!', { id: 'analysis' });
      } catch (err: any) {
        toast.error(err.message || 'GitHub Analysis failed', { id: 'analysis' });
      } finally {
        setLoading(false);
        setAnalysisStep('');
      }
      return;
    }

    // 2) Standard File Processing
    const files = selectedFiles;
    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
    const isDoc = files.length === 1 && (files[0].name.toLowerCase().endsWith('.pdf') || files[0].name.toLowerCase().endsWith('.txt'));
    const isImages = files.every(f => f.type.startsWith('image/'));

    try {
      if (fileType === 'code' && isZip) {
        toast.loading('Analyzing codebase architecture...', { id: 'analysis' });
        const res = await analyzeCodebase(files[0], onProgress);
        setCodeResult(res);
        saveToHistory('code', res, files[0].name);
        toast.success('Code analysis complete!', { id: 'analysis' });
      } else if (isDoc) {
        toast.loading('Extracting insights from document...', { id: 'analysis' });
        const res = await analyzeTextFile(files[0]);
        setTextResult(res);
        saveToHistory(fileType as any, res, files[0].name);
        toast.success('Document analysis complete!', { id: 'analysis' });
      } else if (fileType === 'images-zip' && isZip) {
        toast.loading(`Processing Image ZIP Batch...`, { id: 'analysis' });
        const res = await analyzeImagesZip(files[0]);
        setImgZipResult(res);
        toast.success(`Analysis complete! Processed ${res.processed_count} images.`, { id: 'analysis' });
      } else if (fileType === 'images' && isImages) {
        toast.loading(`Analyzing ${files.length} images...`, { id: 'analysis' });
        const res = await analyzeImages(files);
        setImgResult(res);
        saveToHistory('images', res, `Gallery: ${files.length} images`);
        toast.success('Image analysis complete!', { id: 'analysis' });
      } else if (fileType === 'music' && files.length === 1 && files[0].type.startsWith('audio/')) {
        toast.loading(`Processing Audio Pipeline...`, { id: 'analysis' });
        const res = await analyzeAudio(files[0]);
        setAudioResult(res.result);
        saveToHistory('music', res.result, files[0].name);
        toast.success('Audio analysis complete!', { id: 'analysis' });
      } else {
        toast.error('Unsupported file combo.', { id: 'analysis' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed', { id: 'analysis' });
    } finally {
      setLoading(false);
      setAnalysisStep('');
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
          <div className="view-animate-in" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div />
              {history.length > 0 && !textResult && !codeResult && !imgResult && !imgZipResult && !audioResult && (
                <button 
                  className="xt-tab" 
                  style={{ background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.2)' }}
                  onClick={() => setShowHistory(!showHistory)}
                >
                  {showHistory ? 'Hide History' : `Past Analyses (${history.length})`}
                </button>
              )}
            </div>

            {showHistory && (
              <div className="history-panel glass-card" style={{ marginBottom: '20px', padding: '15px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#fb8c36' }}>Local Analysis History</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {history.map(item => (
                    <div 
                      key={item.id} 
                      className="history-item" 
                      onClick={() => loadHistoryItem(item)}
                      style={{ 
                        background: '#1e293b', 
                        padding: '10px 15px', 
                        borderRadius: '8px', 
                        cursor: 'pointer', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        border: '1px solid #334155'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '13px' }}>{item.label}</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                          {item.type.toUpperCase()} • {new Date(item.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                        style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '5px' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!textResult && !codeResult && !imgResult && !imgZipResult && !audioResult ? (
              <div className="wizard-container" style={{boxShadow: 'none', border: 'none', background: 'transparent', padding: '0px 0'}}>
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
                  <div 
                    className={`action-area glass-card ${loading && selectedFiles.length > 0 ? 'active-loading' : ''}`} 
                    onClick={() => !loading && fileInputRef.current?.click()} 
                    style={{marginBottom: 0, padding: '24px', position: 'relative'}}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={onFilesSelected}
                      style={{ display: 'none' }}
                      multiple
                      accept=".txt,.pdf,.zip,image/*,audio/*"
                    />
                    <div className="action-icon" style={{marginBottom: '12px', color: loading && selectedFiles.length > 0 ? '#fb8c36' : 'inherit'}}>
                      {loading && selectedFiles.length > 0 ? <Loader2 size={32} className="animate-spin" /> : <Upload size={32} />}
                    </div>
                    <div className="action-title" style={{fontSize: '15px', fontWeight: 600}}>
                      {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : 'Upload local files'}
                    </div>
                    <p style={{fontSize: '11px', color: '#94a3b8', marginTop: '4px'}}>Supports .zip, .txt, .pdf, images</p>
                  </div>

                  {fileType === 'code' && (
                    <div 
                      className={`action-area glass-card ${loading && githubUrl.trim().length > 5 ? 'active-loading' : ''}`}
                      style={{marginBottom: 0, padding: '24px', cursor: 'default'}}
                    >
                      <div className="action-icon" style={{marginBottom: '12px', color: loading && githubUrl.trim().length > 5 ? '#fb8c36' : 'inherit'}}>
                        {loading && githubUrl.trim().length > 5 ? <Loader2 size={32} className="animate-spin" /> : <Code2 size={32} />}
                      </div>
                      <div className="action-title" style={{fontSize: '15px', fontWeight: 600, marginBottom: '12px'}}>GitHub Repository</div>
                      <input 
                        type="url"
                        className="xt-search-input"
                        placeholder="https://github.com/..."
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        style={{ width: '100%', background: '#020617', border: '1px solid #334155', height: '36px', fontSize: '12px' }}
                      />
                      <button 
                        onClick={() => setGithubUrl('https://github.com/tiangolo/fastapi')} 
                        style={{marginTop: '10px', fontSize: '11px', color: '#60a5fa', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline'}}
                      >
                        Try: tiangolo/fastapi
                      </button>
                    </div>
                  )}

                  <div className="action-area glass-card" style={{marginBottom: 0, padding: '24px', cursor: 'default', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
                    <div className="action-icon" style={{marginBottom: '12px'}}>
                      <Database size={32} />
                    </div>
                    <div className="action-title" style={{fontSize: '15px', fontWeight: 600, marginBottom: '12px'}}>Quick Demo</div>
                    <button className="sample-file-btn" onClick={handleUseSample} disabled={loading} style={{width: '100%', padding: '10px'}}>
                      Use Sample
                    </button>
                  </div>
                </div>

                {/* Step 3: Footer */}
                <div className="wizard-footer" style={{marginTop: '40px', flexDirection: 'column', alignItems: 'center'}}>
                  {loading && (fileType === 'code') && (
                    <div className="analysis-progress-simple" style={{width: '100%', maxWidth: '550px', marginBottom: '32px'}}>
                       <div className="progress-steps" style={{display: 'flex', justifyContent: 'space-between', marginBottom: '14px', position: 'relative'}}>
                          {['Cloning', 'Graphing', 'Architecture', 'Analysis'].map((step, idx) => {
                             const steps = ['cloning', 'graphing', 'arch', 'details'];
                             const currentIdx = steps.indexOf(analysisStep);
                             const isActive = idx === currentIdx;
                             const isDone = idx < currentIdx;
                             
                             return (
                               <div key={idx} style={{
                                 color: isActive ? '#fb8c36' : isDone ? '#4ade80' : '#64748b',
                                 fontSize: '12px',
                                 fontWeight: isActive ? 600 : 400,
                                 display: 'flex',
                                 flexDirection: 'column',
                                 alignItems: 'center',
                                 gap: '6px',
                                 flex: 1,
                                 transition: 'all 0.3s ease'
                               }}>
                                 <div style={{
                                   width: '20px', 
                                   height: '20px', 
                                   borderRadius: '50%', 
                                   border: `1.5px solid ${isActive ? '#fb8c36' : isDone ? '#4ade80' : '#334155'}`,
                                   display: 'flex',
                                   alignItems: 'center',
                                   justifyContent: 'center',
                                   fontSize: '10px',
                                   background: isActive ? 'rgba(251, 140, 54, 0.05)' : 'transparent',
                                 }}>
                                   {isDone ? '✓' : isActive ? <Loader2 size={10} className="animate-spin" /> : idx + 1}
                                 </div>
                                 <span>{step}</span>
                               </div>
                             )
                          })}
                       </div>
                       <div className="progress-bar-bg" style={{height: '4px', background: '#020617', borderRadius: '2px', overflow: 'hidden', border: '1px solid #1e293b'}}>
                          <div className="progress-bar-fill" style={{
                            height: '100%', 
                            background: '#fb8c36', 
                            width: analysisStep === 'cloning' || analysisStep === 'extracting' ? '15%' : analysisStep === 'graphing' ? '40%' : analysisStep === 'arch' ? '70%' : analysisStep === 'details' ? '90%' : '0%',
                            transition: 'width 0.8s'
                          }}></div>
                       </div>
                       <p style={{fontSize: '11px', color: '#64748b', marginTop: '10px', textAlign: 'center'}}>{progressMsg}</p>
                    </div>
                  )}

                  <button 
                    className="continue-btn" 
                    onClick={handleContinue}
                    disabled={loading || (selectedFiles.length === 0 && !(fileType === 'code' && githubUrl.trim().length > 5))}
                    style={{
                      maxWidth: '220px', 
                      padding: '12px 24px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '10px',
                      background: loading ? '#1e293b' : 'var(--brand-orange)',
                      opacity: loading ? 0.8 : 1,
                      boxShadow: loading ? 'none' : '0 4px 12px rgba(251, 140, 54, 0.2)'
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <span>Run Analysis</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="analysis-results">
                <div className="results-header">
                  <h3>Analysis Results</h3>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button 
                      className="xt-tab" 
                      style={{ background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.2)' }}
                      onClick={handleDownloadResult}
                    >
                      Download JSON
                    </button>
                    <button className="xt-upload-btn" onClick={() => { setTextResult(null); setCodeResult(null); setImgResult(null); setImgZipResult(null); setAudioResult(null); setSelectedFiles([]); setShowHistory(false); }}>
                      Analyze Another File
                    </button>
                  </div>
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
                    
                    {/* Technical Analysis Stats Card */}
                    {codeResult.metadata && (
                      <div className="result-card technical-stats-card" style={{ borderLeft: '4px solid #fb8c36', background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 100%)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#fb8c36' }}>
                            <Activity size={18} /> Technical Analysis Insight
                          </h4>
                          <span style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(251, 140, 54, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(251, 140, 54, 0.2)' }}>
                            Execution Trace
                          </span>
                        </div>
                        
                        <div className="stats-info-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px' }}>
                          <div className="stat-info-item">
                            <div className="label"><Clock size={12} /> Duration</div>
                            <div className="value">{(codeResult.metadata.total_duration_sec || 0).toFixed(1)}s</div>
                          </div>
                          <div className="stat-info-item">
                            <div className="label"><Network size={12} /> Graph Complexity</div>
                            <div className="value">{codeResult.metadata.nodes_count} Nodes / {codeResult.metadata.edges_count} Edges</div>
                          </div>
                          <div className="stat-info-item">
                            <div className="label"><Zap size={12} /> LLM Tokens</div>
                            <div className="value">{codeResult.metadata.total_tokens.toLocaleString()}</div>
                            <div className="sub-value" style={{ fontSize: '9px', opacity: 0.6 }}>
                              {codeResult.metadata.input_tokens.toLocaleString()} in / {codeResult.metadata.output_tokens.toLocaleString()} out
                            </div>
                          </div>
                          <div className="stat-info-item">
                            <div className="label"><Cpu size={12} /> Primary Engine</div>
                            <div className="value" style={{ fontSize: '12px' }}>{codeResult.metadata.arch_model?.replace('llama-3.3-70b-versatile', 'Llama 3.3 (70B)') || 'Groq Llama 3'}</div>
                            <div className="sub-value" style={{ fontSize: '9px', opacity: 0.6 }}>
                              {codeResult.metadata.detail_model ? 'Multi-pass detailing active' : 'Single-pass analysis'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

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

                    {((codeResult.details.tech_debt && codeResult.details.tech_debt.length > 0) || 
                      (codeResult.details.security_risks && codeResult.details.security_risks.length > 0)) && (
                      <div className="viz-row" style={{ marginTop: '0px' }}>
                        {codeResult.details.tech_debt && codeResult.details.tech_debt.length > 0 && (
                          <div className="result-card" style={{ flex: 1, border: '1px solid rgba(244, 114, 182, 0.3)' }}>
                            <h4 style={{ color: '#f472b6', marginTop: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                               Technical Debt
                            </h4>
                            <ul style={{ margin: '15px 0 0', paddingLeft: '20px', color: '#cbd5e1', fontSize: '12px', lineHeight: 1.6 }}>
                              {codeResult.details.tech_debt.map((dt, i) => (
                                <li key={i}>{dt}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {codeResult.details.security_risks && codeResult.details.security_risks.length > 0 && (
                          <div className="result-card" style={{ flex: 1, border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                            <h4 style={{ color: '#f87171', marginTop: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                               Security Risks
                            </h4>
                            <ul style={{ margin: '15px 0 0', paddingLeft: '20px', color: '#cbd5e1', fontSize: '12px', lineHeight: 1.6 }}>
                              {codeResult.details.security_risks.map((sr, i) => (
                                <li key={i}>{sr}</li>
                              ))}
                            </ul>
                          </div>
                        )}
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

                {imgZipResult && (
                  <div className="img-analysis-view">
                    <div className="viz-row">
                      <div className="scatter-box result-card">
                        <h4><BarChart2 size={16} /> Batch UMAP Analysis</h4>
                        <p className="viz-desc">Semantic clustering map generated by the FastAPI backend using Matplotlib.</p>
                        <div style={{ marginTop: '15px', background: '#020617', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b', display: 'flex', justifyContent: 'center' }}>
                          <img 
                            src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/${imgZipResult.result.plot_file_path}`} 
                            alt="Cluster Plot" 
                            style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px', objectFit: 'contain' }} 
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>
                      </div>
                      <div className="clusters-box result-card">
                        <h4>Cluster Summaries</h4>
                        <p className="viz-desc">Aggregated statistics from the processed ZIP batch ({imgZipResult.processed_count} total images).</p>
                        <div className="cluster-list" style={{ marginTop: '15px' }}>
                          {imgZipResult.result.clusters.map((c, idx) => (
                            <div key={idx} className="cluster-item" style={{ background: '#1e293b', padding: '15px', borderRadius: '8px', marginBottom: '10px', alignItems: 'flex-start' }}>
                              <span className="cluster-dot" style={{ background: `var(--cluster-${c.cluster_id % 5})`, display: 'inline-block', marginTop: '4px' }}></span>
                              <div style={{ width: '100%' }}>
                                <strong style={{ color: '#fb8c36', display: 'block', fontSize: '13px' }}>{c.description}</strong>
                                <span style={{ color: '#60a5fa', margin: '6px 0', display: 'block' }}>Detected Contexts:</span>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                  {c.objects.slice(0, 6).map((obj, i) => (
                                      <span key={i} className="chip" style={{ fontSize: '9px', background: 'rgba(51, 65, 85, 0.5)' }}>{obj.label}</span>
                                  ))}
                                  {c.objects.length > 6 && <span className="chip" style={{ fontSize: '9px', opacity: 0.7 }}>+{c.objects.length - 6}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ padding: '30px 0 10px' }}>
                      <h3 style={{ marginBottom: '20px', fontSize: '1.25rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
                        <ImageIcon size={20} color="#60a5fa" /> Annotated Detection Gallery
                      </h3>
                      
                      <style>{`
                        .premium-gallery-card {
                          background: rgba(15, 23, 42, 0.4);
                          border: 1px solid rgba(255, 255, 255, 0.05);
                          border-radius: 12px;
                          overflow: hidden;
                          display: flex;
                          flex-direction: column;
                          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                          position: relative;
                        }
                        .premium-gallery-card:hover {
                          transform: translateY(-5px);
                          box-shadow: 0 15px 30px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(96, 165, 250, 0.4);
                          background: rgba(30, 41, 59, 0.7);
                        }
                        .premium-gallery-img {
                          width: 100%;
                          height: 180px;
                          object-fit: cover;
                          transition: transform 0.5s ease;
                        }
                        .premium-gallery-card:hover .premium-gallery-img {
                          transform: scale(1.08);
                        }
                        .premium-gallery-info {
                          padding: 14px 16px;
                          background: linear-gradient(to top, rgba(15, 23, 42, 1) 0%, rgba(15, 23, 42, 0.85) 100%);
                          border-top: 1px solid rgba(255,255,255,0.05);
                          position: relative;
                          z-index: 2;
                        }
                        .premium-gallery-meta {
                          display: flex;
                          justify-content: space-between;
                          align-items: center;
                          margin-top: 10px;
                        }
                        .premium-cluster-badge {
                          padding: 4px 10px;
                          border-radius: 20px;
                          font-size: 10px;
                          font-weight: 700;
                          letter-spacing: 0.5px;
                          text-transform: uppercase;
                          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        }
                      `}</style>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '24px' }}>
                        {imgZipResult.result.clusters.map((c, i) => (
                          <div key={i} className="premium-gallery-card" onClick={() => setSelectedClusterPoint(c)} style={{ cursor: 'pointer' }}>
                            <div style={{ overflow: 'hidden' }}>
                              {c.annotated_image_path ? (
                                <img 
                                  className="premium-gallery-img"
                                  src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/${c.annotated_image_path}`} 
                                  alt={c.filename}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <div className="premium-gallery-img" style={{ background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '12px' }}>No Tracking Data</div>
                              )}
                            </div>
                            <div className="premium-gallery-info">
                              <span style={{ display: 'block', color: '#e2e8f0', fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {c.filename}
                              </span>
                              <div className="premium-gallery-meta">
                                <span style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Search size={12} /> {c.objects.length} Objects
                                </span>
                                <span className="premium-cluster-badge" style={{ 
                                  color: '#fff', 
                                  background: `var(--cluster-${c.cluster_id % 5})`,
                                  border: `1px solid rgba(255,255,255,0.2)`
                                }}>
                                  Cluster {c.cluster_id}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {audioResult && (
                  <AudioResultView result={audioResult} file={selectedFiles[0]} />
                )}

              </div>
            )}
          </div>
        )}
      </div>

      {selectedClusterPoint && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(2, 6, 23, 0.9)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}
          onClick={() => setSelectedClusterPoint(null)}
        >
          <div 
            style={{ background: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b', width: '100%', maxWidth: '1000px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '20px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '18px' }}>{selectedClusterPoint.filename}</h3>
              <button 
                onClick={() => setSelectedClusterPoint(null)} 
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '28px', padding: 0, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', padding: '20px', overflow: 'auto' }}>
                 {selectedClusterPoint.annotated_image_path ? (
                    <img src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/${selectedClusterPoint.annotated_image_path}`} alt="Full size" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '4px' }} />
                 ) : (
                    <div style={{ color: '#64748b' }}>No Tracking Data</div>
                 )}
              </div>
              <div style={{ width: '350px', display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', overflowY: 'auto', background: '#0f172a', borderLeft: '1px solid #1e293b' }}>
                <div>
                  <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>AI Caption</span>
                  <p style={{ margin: '8px 0 0', color: '#f1f5f9', fontSize: '15px', lineHeight: '1.5', background: 'rgba(30, 41, 59, 0.5)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    {selectedClusterPoint.description || "No caption available."}
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Detected Objects ({selectedClusterPoint.objects.length})</span>
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '15px', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    {selectedClusterPoint.objects.map((obj: any, idx: number) => (
                      <span key={idx} style={{ background: '#334155', color: '#f8fafc', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', border: '1px solid #475569' }}>
                        {obj.label} <span style={{ color: '#60a5fa', marginLeft: '4px', fontWeight: 'bold' }}>{Math.round(obj.confidence * 100)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                   <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Assigned Cluster</span>
                   <div style={{ marginTop: '8px', padding: '12px 15px', background: `var(--cluster-${selectedClusterPoint.cluster_id % 5})`, color: '#fff', borderRadius: '8px', fontWeight: 'bold', display: 'inline-block', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                     Cluster {selectedClusterPoint.cluster_id}
                   </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
        
        .technical-stats-card {
          margin-bottom: 10px;
          border-left: 4px solid #fb8c36 !important;
        }
        .stat-info-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .stat-info-item .label {
          font-size: 10px;
          color: #94a3b8;
          display: flex;
          align-items: center;
          gap: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .stat-info-item .value {
          font-size: 14px;
          font-weight: 600;
          color: #f1f5f9;
        }
      `}</style>
    </div>
  );
};

export default DataVizPage;

const AudioResultView = ({ result, file }: { result: AudioAnalysisResult, file?: File }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);

  const getSpeakerColor = (speaker: string) => {
    const hash = speaker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    return colors[hash % colors.length];
  };

  useEffect(() => {
    if (file && waveformRef.current) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#4f46e5',
        progressColor: '#818cf8',
        cursorColor: '#c7d2fe',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
      });

      const url = URL.createObjectURL(file);
      wavesurfer.current.load(url);

      wavesurfer.current.on('play', () => setIsPlaying(true));
      wavesurfer.current.on('pause', () => setIsPlaying(false));
      wavesurfer.current.on('timeupdate', (time) => setCurrentTime(time));

      return () => {
        wavesurfer.current?.destroy();
      };
    }
  }, [file]);

  const togglePlay = () => wavesurfer.current?.playPause();
  const seekTo = (time: number) => {
    if (wavesurfer.current) {
       wavesurfer.current.setTime(time);
       wavesurfer.current.play();
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>

      {/* ── Metadata chips ───────────────────────────────────────────── */}
      {result.features && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px' }}>
            🎵 {result.features.sample_rate.toLocaleString()} Hz
          </span>
          <span className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px' }}>
            ⏱ {formatTime(result.features.duration)}
          </span>
          <span className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px' }}>
            {result.features.num_channels === 1 ? '🔊 Mono' : '🔊 Stereo'}
          </span>
          <span className="chip" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)', fontSize: '12px', padding: '5px 12px' }}>
            {result.segments.length} segments
          </span>
        </div>
      )}

      {/* ── Main grid: left (player + waveform + energy + transcript) / right (spectrogram + info) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>

        {/* LEFT column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* WaveSurfer player */}
          {file && (
            <div className="result-card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <button
                  onClick={togglePlay}
                  style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#4f46e5', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: '3px' }} />}
                </button>
                <div style={{ flex: 1 }} ref={waveformRef} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(result.features?.duration ?? result.duration)}</span>
              </div>
            </div>
          )}

          {/* Extracted waveform canvas */}
          {result.features?.waveform && (
            <WaveformCanvas waveform={result.features.waveform} currentTime={currentTime} duration={result.features.duration} />
          )}

          {/* RMS Energy chart */}
          {result.features?.energy && (
            <EnergyChart energy={result.features.energy} currentTime={currentTime} />
          )}

          {/* Transcript */}
          <div className="result-card">
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0 }}>
              <FileText size={16} /> Transcript
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {result.segments.map((seg, i) => {
                const isCurrent = currentTime >= seg.start && currentTime <= seg.end;
                return (
                  <div
                    key={i}
                    onClick={() => seekTo(seg.start)}
                    style={{ display: 'flex', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', cursor: 'pointer', background: isCurrent ? 'rgba(99,102,241,0.12)' : 'rgba(30,41,59,0.5)', transition: 'background 0.2s', borderLeft: `3px solid ${getSpeakerColor(seg.speaker)}` }}
                  >
                    <div style={{ flexShrink: 0, width: '40px', fontSize: '11px', color: '#64748b', paddingTop: '2px' }}>
                      {formatTime(seg.start)}
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: getSpeakerColor(seg.speaker), marginBottom: '2px' }}>
                        {seg.speaker}
                      </div>
                      <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
                        {seg.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* STFT Spectrogram heatmap */}
          {result.features?.spectrogram && (
            <SpectrogramCanvas spectrogram={result.features.spectrogram} currentTime={currentTime} duration={result.features.duration} />
          )}

          {/* Speaker legend */}
          {result.segments.length > 0 && (() => {
            const speakers = Array.from(new Set(result.segments.map(s => s.speaker)));
            return (
              <div className="result-card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Speakers</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {speakers.map(sp => (
                    <div key={sp} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, background: getSpeakerColor(sp) }} />
                      <span style={{ color: '#e2e8f0' }}>{sp}</span>
                      <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '11px' }}>
                        {result.segments.filter(s => s.speaker === sp).length} segs
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* NLP Text Analysis */}
          {result.text_analysis && (
            <>
              <div className="result-card" style={{ padding: '1rem' }}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.5px' }}>Executive Summary</h4>
                  <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{result.text_analysis.summary}</p>
                </div>
                <div>
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Sentiment</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '11px', fontWeight: 600, background: result.text_analysis.sentiment.overall_label === 'positive' ? 'rgba(34,197,94,0.15)' : result.text_analysis.sentiment.overall_label === 'negative' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.1)', color: result.text_analysis.sentiment.overall_label === 'positive' ? '#4ade80' : result.text_analysis.sentiment.overall_label === 'negative' ? '#f87171' : '#94a3b8', textTransform: 'capitalize' }}>
                      {result.text_analysis.sentiment.overall_label}
                    </span>
                  </div>
                  <div style={{ height: '8px', width: '100%', display: 'flex', borderRadius: '4px', overflow: 'hidden', background: '#1e293b' }}>
                    <div style={{ width: `${result.text_analysis.sentiment.positive * 100}%`, background: '#22c55e' }} title="Positive" />
                    <div style={{ width: `${result.text_analysis.sentiment.neutral * 100}%`, background: '#475569' }} title="Neutral" />
                    <div style={{ width: `${result.text_analysis.sentiment.negative * 100}%`, background: '#ef4444' }} title="Negative" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#64748b' }}>
                    <span>+{(result.text_analysis.sentiment.positive * 100).toFixed(0)}%</span>
                    <span>{(result.text_analysis.sentiment.neutral * 100).toFixed(0)}%</span>
                    <span>-{(result.text_analysis.sentiment.negative * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {result.text_analysis.entities.length > 0 && (
                <div className="result-card" style={{ padding: '1rem' }}>
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Extracted Entities</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {result.text_analysis.entities.slice(0, 15).map((e: any) => (
                      <span key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '11px', padding: '0.25rem 0.5rem', background: '#1e293b', borderRadius: '6px', border: '1px solid #334155', color: '#cbd5e1' }}>
                        {e.type === 'Person' ? <Hash size={11}/> : e.type === 'Place' ? <MapPin size={11}/> : <Activity size={11}/>}
                        {e.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Waveform Canvas ───────────────────────────────────────────────────────────
const WaveformCanvas = ({ waveform, currentTime, duration }: {
  waveform: import('./services').WaveformData;
  currentTime: number;
  duration: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const n = waveform.amplitudes.length;
    const midY = H / 2;
    const barW = Math.max(1, W / n);
    const progress = duration > 0 ? currentTime / duration : 0;

    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const amp = Math.abs(waveform.amplitudes[i]);
      const barH = amp * midY * 0.9;
      const played = i / n <= progress;
      ctx.fillStyle = played ? '#818cf8' : '#334155';
      ctx.fillRect(x, midY - barH, barW - 0.5, barH * 2);
    }
  }, [waveform, currentTime, duration]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
        Waveform (normalized)
      </h4>
      <canvas ref={canvasRef} width={600} height={80} style={{ width: '100%', height: '80px', borderRadius: '6px', background: '#020617' }} />
    </div>
  );
};

// ── Spectrogram Canvas ────────────────────────────────────────────────────────
const SpectrogramCanvas = ({ spectrogram, currentTime, duration }: {
  spectrogram: import('./services').SpectrogramData;
  currentTime: number;
  duration: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogram) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freqBins = spectrogram.magnitude_db.length;
    const timeBins = spectrogram.time_bins.length;
    const W = canvas.width, H = canvas.height;
    const cellW = W / timeBins;
    const cellH = H / freqBins;

    for (let f = 0; f < freqBins; f++) {
      for (let t = 0; t < timeBins; t++) {
        const db = spectrogram.magnitude_db[f][t]; // range [-80, 0]
        const intensity = (db + 80) / 80;          // normalize to [0, 1]
        // Colour map: near-black → blue → cyan → yellow
        const r = Math.round(Math.min(255, intensity * 2 * 255));
        const g = Math.round(Math.min(255, intensity * 1.5 * 255));
        const b = Math.round(Math.max(0, (1 - intensity * 2) * 255));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        // Flip freq axis: low freq at bottom
        ctx.fillRect(t * cellW, (freqBins - 1 - f) * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    // Playhead line
    if (duration > 0) {
      const x = (currentTime / duration) * W;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }, [spectrogram, currentTime, duration]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
        STFT Spectrogram
      </h4>
      <canvas ref={canvasRef} width={300} height={160} style={{ width: '100%', height: '160px', borderRadius: '6px', imageRendering: 'pixelated' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginTop: '4px' }}>
        <span>0 Hz</span>
        <span>8 kHz (frequency axis)</span>
      </div>
    </div>
  );
};

// ── RMS Energy Chart ──────────────────────────────────────────────────────────
const EnergyChart = ({ energy, currentTime }: {
  energy: import('./services').EnergyData;
  currentTime: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !energy) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const n = energy.rms_values.length;
    const barW = Math.max(1, W / n);

    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const barH = energy.rms_values[i] * H * 0.9;
      const played = energy.timestamps[i] <= currentTime;
      const alpha = 0.4 + energy.rms_values[i] * 0.6;
      ctx.fillStyle = played
        ? `rgba(251,140,54,${alpha})`
        : `rgba(71,85,105,${alpha})`;
      ctx.fillRect(x, H - barH, barW - 0.5, barH);
    }
  }, [energy, currentTime]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
        RMS Energy
      </h4>
      <canvas ref={canvasRef} width={600} height={60} style={{ width: '100%', height: '60px', borderRadius: '6px', background: '#020617' }} />
    </div>
  );
};
