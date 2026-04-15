import { useState, useRef } from 'react';
import {
  ArrowLeft, BarChart2, Database, Upload, Search, Loader2, FileText, Code2,
  ImageIcon, FileSpreadsheet, Music, Video, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import '../ToolPage.css';

import {
  analyzeTextFile,
  analyzeCodebase,
  analyzeGithubRepo,
  analyzeImagesBatch,
  analyzeAudio,
  analyzeVideo,
  fetchVideoDemoMetadata,
  TextAnalysisResult,
  CodeAnalysisResult,
  MultiImageAnalysisResponse,
  ImageZipAnalysisResponse,
  AudioAnalysisResponse,
  AudioAnalysisResult,
  VideoAnalysisResult,
} from './services';

import TextAnalysisView  from './components/TextAnalysisView';
import CodeAnalysisView  from './components/CodeAnalysisView';
import ImageAnalysisView from './components/ImageAnalysisView';
import AudioAnalysisView from './components/AudioAnalysisView';
import VideoAnalysisView from './components/VideoAnalysisView';
import CatalogView       from './components/CatalogView';

// ── Types ─────────────────────────────────────────────────────────────────────

type DatasetTab = 'catalog' | 'upload';
type FileType = 'csv' | 'text' | 'pdf' | 'images' | 'images-zip' | 'videos' | 'music' | 'code';

type HistoryItem = {
  id: string;
  type: FileType | 'github';
  label: string;
  timestamp: number;
  data: TextAnalysisResult | CodeAnalysisResult | MultiImageAnalysisResponse | AudioAnalysisResult | VideoAnalysisResult;
};

const FILE_TYPES: { id: FileType; label: string; desc: string; icon: any }[] = [
  { id: 'csv',        label: 'CSV Data',           desc: 'Tabular data & spreadsheets',     icon: FileSpreadsheet },
  { id: 'text',       label: 'Text File',           desc: 'Plain text & documents',          icon: FileText },
  { id: 'pdf',        label: 'PDF Doc',             desc: 'PDF reports & exports',           icon: Search },
  { id: 'images-zip', label: 'Visual Intelligence', desc: 'Single image, Batch, or ZIP',     icon: ImageIcon },
  { id: 'code',       label: 'Codebase',            desc: 'ZIP repo analysis',               icon: Code2 },
  { id: 'videos',     label: 'Videos',              desc: 'Video streams & files',           icon: Video },
  { id: 'music',      label: 'Audio',               desc: 'Voice & sound analysis',          icon: Music },
];

// ── Sample data ───────────────────────────────────────────────────────────────

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
  locations: [],
};

const MOCK_CODE_RESULT: CodeAnalysisResult = {
  filename: 'sample_ecommerce.zip',
  file_count: 42,
  architecture: {
    title: 'E-commerce Microservices Platform',
    summary: 'A distributed system built with Node.js microservices and a React storefront. Services communicate via REST APIs with JWT-based authentication. Uses PostgreSQL for persistence and Redis for session caching.',
    tech_stack: ['Node.js', 'React', 'PostgreSQL', 'Redis', 'Docker'],
    detected_patterns: ['Microservices', 'RESTful API', 'JWT Authentication', 'Repository Pattern'],
    groups: [
      { id: 'frontend', label: 'Frontend' },
      { id: 'api',      label: 'API Services' },
      { id: 'data',     label: 'Data Layer' },
    ],
    nodes: [
      { id: 'storefront',  label: 'Web Storefront',  type: 'React SPA',            description: 'Responsive React-based user interface with cart and checkout.', group_id: 'frontend', path: 'store/App.jsx',       shape: 'box' },
      { id: 'auth-svc',    label: 'Auth Service',    type: 'Node.js service',       description: 'Handles user login, JWT issuance and verification.',            group_id: 'api',      path: 'auth/src/index.js',  shape: 'box' },
      { id: 'catalog-svc', label: 'Catalog Service', type: 'Node.js service',       description: 'Manages product listings and inventory via REST.',               group_id: 'api',      path: 'catalog/routes.js',  shape: 'box' },
      { id: 'order-svc',   label: 'Order Service',   type: 'Node.js service',       description: 'Processes orders and triggers payment flow.',                    group_id: 'api',                                  shape: 'box' },
      { id: 'postgres',    label: 'PostgreSQL',      type: 'Relational DB',         description: 'Primary persistent store for users, products, orders.',          group_id: 'data',                                 shape: 'database' },
      { id: 'redis',       label: 'Redis Cache',     type: 'In-memory store',       description: 'Session cache and rate limiting.',                               group_id: 'data',                                 shape: 'database' },
      { id: 'stripe-api',  label: 'Stripe API',      type: 'External payment API',  description: 'Processes card payments and refunds.',                           group_id: '',                                     shape: 'hexagon' },
    ],
    edges: [
      { source: 'storefront',  target: 'auth-svc',    label: 'login / token',   style: 'solid' },
      { source: 'storefront',  target: 'catalog-svc', label: 'browse products', style: 'solid' },
      { source: 'storefront',  target: 'order-svc',   label: 'place order',     style: 'solid' },
      { source: 'auth-svc',    target: 'redis',       label: 'session cache',   style: 'solid' },
      { source: 'auth-svc',    target: 'postgres',    label: 'user lookup',     style: 'solid' },
      { source: 'catalog-svc', target: 'postgres',    label: 'SQL query',       style: 'solid' },
      { source: 'order-svc',   target: 'postgres',    label: 'write order',     style: 'solid' },
      { source: 'order-svc',   target: 'stripe-api',  label: 'charge card',     style: 'dashed' },
    ],
  },
  details: {
    key_files: [
      { file_path: 'auth/src/index.js',  component: 'Auth Service',    summary: 'Entry point for JWT auth middleware. Exposes /login and /verify routes.',               key_functions: ['verifyToken: validates JWT signature and expiry', 'login: validates credentials and issues signed JWT'] },
      { file_path: 'catalog/routes.js',  component: 'Catalog Service', summary: 'Defines REST endpoints for product queries and inventory management.',                   key_functions: ['listProducts: paginated product listing with filters', 'getProduct: single product fetch with inventory check'] },
    ],
    flow: [
      { step: 1, description: 'Browser loads Web Storefront (React SPA via CDN).' },
      { step: 2, description: 'User submits credentials → POST /login → Auth Service → validates against PostgreSQL → returns signed JWT.' },
      { step: 3, description: 'Storefront stores JWT in memory, attaches as Authorization header on subsequent API calls.' },
      { step: 4, description: 'Browse products → GET /products → Catalog Service → SQL query PostgreSQL → paginated JSON response.' },
      { step: 5, description: 'Checkout → POST /orders → Order Service → writes order to PostgreSQL → calls Stripe API async → returns order ID.' },
    ],
    tech_debt: [
      'auth/src/jwt.js: JWT secret loaded from process.env without validation — app silently uses empty string if unset.',
      'catalog/routes.js: listProducts lacks pagination — full table scan on large datasets.',
      'No inter-service authentication — any internal service can call any other without credentials.',
    ],
    security_risks: [
      'catalog/routes.js: search query built with string interpolation — SQL injection vector.',
      'auth/src/index.js: JWT tokens never blacklisted on logout — stolen tokens remain valid until expiry.',
    ],
    recommendations: [
      'Add input validation with Joi or Zod on all API routes before business logic.',
      'Implement token blacklist (Redis set) on logout to invalidate stolen tokens.',
      'Add inter-service mTLS or shared secret headers to prevent unauthorized internal calls.',
    ],
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const DataVizPage = ({ onBack }: { onBack: () => void }) => {
  const [activeTab, setActiveTab] = useState<DatasetTab>('catalog');

  // Wizard state
  const [fileType, setFileType]       = useState<FileType>('images-zip');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [githubUrl, setGithubUrl]     = useState('');

  // Analysis state
  const [loading, setLoading]         = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [progressMsg, setProgressMsg] = useState<string>('');

  // Result state
  const [textResult,    setTextResult]    = useState<TextAnalysisResult    | null>(null);
  const [codeResult,    setCodeResult]    = useState<CodeAnalysisResult    | null>(null);
  const [imgResult,     setImgResult]     = useState<MultiImageAnalysisResponse | null>(null);
  const [imgZipResult,  setImgZipResult]  = useState<ImageZipAnalysisResponse   | null>(null);
  const [imgTokens,     setImgTokens]     = useState({ input: 0, output: 0, total: 0 });
  const [imgDuration,   setImgDuration]   = useState(0);
  const [imgModel,      setImgModel]      = useState('');
  const [audioResult,   setAudioResult]   = useState<AudioAnalysisResponse | null>(null);
  const [videoResult,   setVideoResult]   = useState<VideoAnalysisResult   | null>(null);

  // History
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('kosh_analysis_history');
    if (saved) {
      try { return JSON.parse(saved); } catch { return []; }
    }
    return [];
  });
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const resetResults = () => {
    setTextResult(null);
    setCodeResult(null);
    setImgResult(null);
    setImgZipResult(null);
    setImgTokens({ input: 0, output: 0, total: 0 });
    setImgDuration(0);
    setImgModel('');
    setAudioResult(null);
    setVideoResult(null);
    setSelectedFiles([]);
    setShowHistory(false);
  };

  const saveToHistory = (type: HistoryItem['type'], data: any, label: string) => {
    const newItem: HistoryItem = { id: crypto.randomUUID(), type, label, timestamp: Date.now(), data };
    const updated = [newItem, ...history].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('kosh_analysis_history', JSON.stringify(updated));
  };

  const loadHistoryItem = (item: HistoryItem) => {
    resetResults();
    if (item.type === 'code' || item.type === 'github') {
      setCodeResult(item.data as CodeAnalysisResult);
    } else if (item.type === 'images') {
      setImgResult(item.data as MultiImageAnalysisResponse);
    } else if (item.type === 'music') {
      setAudioResult({ status: 'success', filename: item.label, content_type: 'audio/wav', result: item.data as AudioAnalysisResult });
    } else if (item.type === 'videos') {
      setVideoResult(item.data as VideoAnalysisResult);
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
    const activeData = textResult || codeResult || imgResult || (audioResult?.result) || imgZipResult;
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
    toast.success('Analysis results exported as JSON');
  };

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      toast.success(`${files.length} file(s) selected`);
    }
  };

  const handleUseSample = async (typeOverride?: FileType) => {
    const targetType = typeOverride || fileType;
    setLoading(true);
    try {
      if (targetType === 'code') {
        setCodeResult(MOCK_CODE_RESULT);
        saveToHistory('code', MOCK_CODE_RESULT, 'Sample: Codebase');
        toast.success('Loaded Codebase Sample');
      } else if (['csv', 'text', 'pdf'].includes(targetType)) {
        setTextResult(MOCK_TEXT_RESULT);
        saveToHistory(targetType as any, MOCK_TEXT_RESULT, `Sample: ${targetType.toUpperCase()}`);
        toast.success(`Loaded ${targetType.toUpperCase()} Sample`);
      } else if (targetType === 'videos') {
        toast.loading('Loading demo video analysis...', { id: 'analysis' });
        try {
          const vidData = await fetchVideoDemoMetadata();
          setVideoResult(vidData);
          saveToHistory('videos', vidData, 'Sample: Demo Video');
          toast.success('Loaded demo video analysis!', { id: 'analysis' });
        } catch (e) {
          console.warn('Could not fetch demo metadata', e);
          toast.error('Failed to load demo video metadata');
        }
      } else {
        toast.info(`Sample for ${targetType} coming soon!`);
      }
    } catch {
      toast.error('Failed to load sample');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    const usingGithub = fileType === 'code' && githubUrl.trim().length > 5;
    if (selectedFiles.length === 0 && !usingGithub) {
      toast.error('Please select a file or provide a valid GitHub URL');
      return;
    }

    setLoading(true);
    setAnalysisStep('init');
    setProgressMsg('Initializing analysis pipeline...');
    resetResults();

    const onProgress = (step: string, msg: string) => {
      setAnalysisStep(step);
      setProgressMsg(msg);
      toast.loading(msg, { id: 'analysis' });
    };

    // 1) GitHub fast-path
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

    // 2) Standard file processing
    const files = selectedFiles;
    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
    const isDoc = files.length === 1 && (files[0].name.toLowerCase().endsWith('.pdf') || files[0].name.toLowerCase().endsWith('.txt'));

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
      } else if (fileType === 'images-zip' && (isZip || files.every(f => f.type.startsWith('image/')))) {
        toast.loading('Processing Visual Intel Batch...', { id: 'analysis' });
        const res = await analyzeImagesBatch(files);
        setImgZipResult(res);
        if (res.result?.metadata) {
          setImgDuration(res.result.metadata.total_duration_sec);
          setImgTokens({ input: res.result.metadata.input_tokens, output: res.result.metadata.output_tokens, total: res.result.metadata.total_tokens });
          setImgModel(res.result.metadata.model);
        }
        toast.success(`Analysis complete! Processed ${res.processed_count} images.`, { id: 'analysis' });
      } else if (fileType === 'music' && files.length === 1) {
        toast.loading('Processing audio pipeline...', { id: 'analysis' });
        const res = await analyzeAudio(files[0]);
        setAudioResult(res);
        saveToHistory('music', res.result, files[0].name);
        toast.success('Audio analysis complete!', { id: 'analysis' });
      } else if (fileType === 'videos') {
        toast.loading('Running video analysis (YOLO + BLIP + CLIP)...', { id: 'analysis' });
        const res = await analyzeVideo(files[0]);
        setVideoResult(res);
        saveToHistory('videos', res, files[0].name);
        toast.success('Video analysis complete!', { id: 'analysis' });
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

  const handleAnalyzeCatalogDataset = async (dataset: any, records: any[]) => {
    if (records.length === 0) {
      toast.error('No records available to analyze');
      return;
    }

    setLoading(true);
    setAnalysisStep('init');
    setProgressMsg('Preparing dataset for AI analysis...');
    resetResults();

    try {
      // 1. Convert JSON records to CSV blob for the analysis engine
      const keys = Object.keys(records[0]);
      const csvContent = [
        keys.join(','),
        ...records.map(row => keys.map(k => {
          const val = row[k] === null || row[k] === undefined ? '' : String(row[k]);
          return `"${val.replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\n');

      const file = new File([csvContent], `${dataset.name.slice(0, 30)}.csv`, { type: 'text/csv' });
      
      // 2. Setup state to match a manual CSV upload
      setFileType('csv');
      setSelectedFiles([file]);
      setActiveTab('upload');

      // 3. Trigger analysis exactly like handleContinue
      toast.loading('Analyzing dataset structure & patterns...', { id: 'analysis' });
      const res = await analyzeTextFile(file);
      setTextResult(res);
      saveToHistory('csv', res, `Catalog: ${dataset.name}`);
      toast.success('Dataset analysis complete!', { id: 'analysis' });
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed', { id: 'analysis' });
    } finally {
      setLoading(false);
      setAnalysisStep('');
    }
  };

  const hasResult = !!(textResult || codeResult || imgResult || imgZipResult || audioResult || videoResult);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      {/* Header */}
      <div className="xt-dataviz-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', position: 'relative', zIndex: 1 }}>
          <div className="xt-header-icon" style={{ width: '64px', height: '64px', borderRadius: '18px' }}>
            <BarChart2 size={32} />
          </div>
          <div>
            <h1 className="xt-header-title" style={{ fontSize: '32px' }}>Data Visualization &amp; Analysis</h1>
            <p className="xt-header-subtitle" style={{ fontSize: '16px' }}>Analyze Documents or Codebases with Multi-modal AI</p>
          </div>
        </div>
      </div>

      {/* Dataset selection panel */}
      <div className="xt-panel">
        <div className="xt-tabs">
          <button className={`xt-tab${activeTab === 'catalog' ? ' active' : ''}`} onClick={() => setActiveTab('catalog')}>
            <Database size={15} /> Data Catalog
          </button>
          <button className={`xt-tab${activeTab === 'upload' ? ' active' : ''}`} onClick={() => setActiveTab('upload')}>
            <Upload size={15} /> AI Analysis (Upload)
          </button>
        </div>

        {/* ── Catalog Tab ── */}
        {activeTab === 'catalog' && (
          <CatalogView onAnalyzeDataset={handleAnalyzeCatalogDataset} />
        )}

        {/* ── Upload Tab ── */}
        {activeTab === 'upload' && (
          <div className="view-animate-in" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div />
              {history.length > 0 && !hasResult && (
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
                      style={{ background: '#1e293b', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #334155' }}
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

            {!hasResult ? (
              <div className="wizard-container" style={{ boxShadow: 'none', border: 'none', background: 'transparent', padding: '0px 0' }}>
                {/* Step 1: Type Selection */}
                <div className="wizard-header" style={{ textAlign: 'left', marginBottom: '24px' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>1. Select Analysis Type</h2>
                  <p style={{ color: '#94a3b8' }}>Choose the format of the data you want to analyze with AI.</p>
                </div>
                <div className="type-grid">
                  {FILE_TYPES.map(type => (
                    <div
                      key={type.id}
                      className={`type-card${fileType === type.id ? ' active' : ''}`}
                      onClick={() => setFileType(type.id)}
                    >
                      <div className="icon-box"><type.icon size={24} /></div>
                      <span className="type-label">{type.label}</span>
                      <span className="type-desc">{type.desc}</span>
                    </div>
                  ))}
                </div>

                {/* Step 2: Action Area */}
                <div className="wizard-header" style={{ textAlign: 'left', marginBottom: '24px', marginTop: '40px' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>2. Provide Dataset</h2>
                  <p style={{ color: '#94a3b8' }}>Upload your own files or use a curated sample for demonstration.</p>
                </div>

                <div className="action-grid" style={{ gridTemplateColumns: fileType === 'code' ? '1fr 1fr 200px' : '1fr 200px' }}>
                  <div
                    className={`action-area ${loading && selectedFiles.length > 0 ? 'active-loading' : ''}`}
                    onClick={() => !loading && fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={onFilesSelected}
                      style={{ display: 'none' }}
                      multiple={fileType !== 'music' && fileType !== 'videos'}
                      accept={
                        fileType === 'music'   ? '.mp3,.wav,.m4a,.ogg,.flac,audio/*' :
                        fileType === 'videos'  ? '.mp4,.mov,.avi,.mkv,.webm,video/*' :
                        '.txt,.pdf,.zip,image/*'
                      }
                    />
                    <div className="action-icon">
                      {loading && selectedFiles.length > 0 ? <Loader2 size={32} className="animate-spin" /> : <Upload size={32} />}
                    </div>
                    <div className="action-title">
                      {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : 'Upload local files'}
                    </div>
                    <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                      {fileType === 'music'  ? 'Supports .mp3, .wav, .m4a, .ogg, .flac' :
                       fileType === 'videos' ? 'Supports .mp4, .mov, .avi, .mkv' :
                       'Supports .zip, .txt, .pdf, images'}
                    </p>
                  </div>

                  {fileType === 'code' && (
                    <div className={`action-area ${loading && githubUrl.trim().length > 5 ? 'active-loading' : ''}`} style={{ cursor: 'default' }}>
                      <div className="action-icon">
                        {loading && githubUrl.trim().length > 5 ? <Loader2 size={32} className="animate-spin" /> : <Code2 size={32} />}
                      </div>
                      <div className="action-title">GitHub Repository</div>
                      <input
                        type="url"
                        className="xt-search-input"
                        placeholder="https://github.com/..."
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        style={{ width: '100%', height: '42px', fontSize: '13px' }}
                      />
                      <button
                        onClick={() => setGithubUrl('https://github.com/tiangolo/fastapi')}
                        style={{ marginTop: '12px', fontSize: '12px', color: '#fb8c36', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        Try: tiangolo/fastapi
                      </button>
                    </div>
                  )}

                  <div className="action-area" style={{ cursor: 'default', justifyContent: 'center' }}>
                    <div className="action-icon"><Database size={32} /></div>
                    <div className="action-title">Quick Demo</div>
                    <button className="sample-file-btn" onClick={() => handleUseSample()} disabled={loading} style={{ width: '100%', padding: '12px', marginTop: '8px' }}>
                      Use Sample
                    </button>
                  </div>
                </div>

                {/* Step 3: Footer */}
                <div className="wizard-footer" style={{ marginTop: '40px', flexDirection: 'column', alignItems: 'center' }}>
                  {loading && fileType === 'code' && (
                    <div className="analysis-progress-simple" style={{ width: '100%', maxWidth: '550px', marginBottom: '32px' }}>
                      <div className="progress-steps" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', position: 'relative' }}>
                        {['Cloning', 'Graphing', 'Architecture', 'Analysis'].map((step, idx) => {
                          const steps = ['cloning', 'graphing', 'arch', 'details'];
                          const currentIdx = steps.indexOf(analysisStep);
                          const isActive = idx === currentIdx;
                          const isDone   = idx < currentIdx;
                          return (
                            <div key={idx} style={{ color: isActive ? '#fb8c36' : isDone ? '#4ade80' : '#64748b', fontSize: '12px', fontWeight: isActive ? 600 : 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1, transition: 'all 0.3s ease' }}>
                              <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: `1.5px solid ${isActive ? '#fb8c36' : isDone ? '#4ade80' : '#334155'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', background: isActive ? 'rgba(251, 140, 54, 0.05)' : 'transparent' }}>
                                {isDone ? '✓' : isActive ? <Loader2 size={10} className="animate-spin" /> : idx + 1}
                              </div>
                              <span>{step}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="progress-bar-bg" style={{ height: '4px', background: '#020617', borderRadius: '2px', overflow: 'hidden', border: '1px solid #1e293b' }}>
                        <div className="progress-bar-fill" style={{ height: '100%', background: '#fb8c36', width: analysisStep === 'cloning' || analysisStep === 'extracting' ? '15%' : analysisStep === 'graphing' ? '40%' : analysisStep === 'arch' ? '70%' : analysisStep === 'details' ? '90%' : '0%', transition: 'width 0.8s' }} />
                      </div>
                      <p style={{ fontSize: '11px', color: '#64748b', marginTop: '10px', textAlign: 'center' }}>{progressMsg}</p>
                    </div>
                  )}

                  <button
                    className="continue-btn"
                    onClick={handleContinue}
                    disabled={loading || (selectedFiles.length === 0 && !(fileType === 'code' && githubUrl.trim().length > 5))}
                    style={{ maxWidth: '220px', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: loading ? '#1e293b' : 'var(--brand-orange)', opacity: loading ? 0.8 : 1, boxShadow: loading ? 'none' : '0 4px 12px rgba(251, 140, 54, 0.2)' }}
                  >
                    {loading ? (
                      <><Loader2 size={16} className="animate-spin" /><span>Analyzing...</span></>
                    ) : (
                      <><span>Run Analysis</span><ArrowRight size={16} /></>
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
                    <button className="xt-upload-btn" onClick={resetResults}>
                      Analyze Another File
                    </button>
                  </div>
                </div>

                {textResult   && <TextAnalysisView  result={textResult} />}
                {codeResult   && <CodeAnalysisView  result={codeResult} />}
                {(imgResult || imgZipResult) && (
                  <ImageAnalysisView
                    imgResult={imgResult}
                    imgZipResult={imgZipResult}
                    imgTokens={imgTokens}
                    imgDuration={imgDuration}
                    imgModel={imgModel}
                  />
                )}
                {audioResult  && <AudioAnalysisView result={audioResult.result} file={selectedFiles[0]} />}
                {videoResult  && <VideoAnalysisView result={videoResult} />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DataVizPage;
