import { useEffect, useState } from 'react';
import {
  FileText, Sparkles, ScanLine, BarChart2, Lock, ArrowRight,
  TrendingUp, Activity, Star, Users, ChevronRight, Database, Download, ChevronDown,
} from 'lucide-react';
import './DataExchangeView.css';
import watermarkLogo from '../../assets/looplogo.png';
import OcrPage               from './tools/ocr/OcrPage';
import DataVizPage           from './tools/data-viz/DataVizPage';
import FeatureEngineeringPage from './tools/feature-engineering/FeatureEngineeringPage';
import DataAnonymizationPage  from './tools/data-anonymization/DataAnonymizationPage';

// ─── Dashboard Data ─────────────────────────────────────────────────────────
const ACTIVITY_DATA = [
  { id: 1, type: 'Data Visualization',  desc: 'Generated sales dashboard with 5 charts',           user: 'John Doe',     time: '2025-12-17 10:30 AM', status: 'completed' },
  { id: 2, type: 'OCR Conversion',      desc: 'Processed 15 PDF documents',                        user: 'Sarah Smith',  time: '2025-12-17 09:45 AM', status: 'completed' },
  { id: 3, type: 'Data Anonymization',  desc: 'Anonymized customer dataset (1,500 records)',        user: 'Mike Johnson', time: '2025-12-17 09:15 AM', status: 'completed' },
  { id: 4, type: 'Feature Engineering', desc: 'Applied 8 transformations on product data',          user: 'Emily Chen',   time: '2025-12-17 08:30 AM', status: 'completed' },
  { id: 5, type: 'OCR Conversion',      desc: 'Extracted text from 23 images',                      user: 'David Lee',    time: '2025-12-16 05:20 PM', status: 'completed' },
];

const STATS_DATA = [
  { value: '1,247', label: 'Total Operations',     change: '+12.5%', positive: true  },
  { value: '8,432', label: 'Documents Processed',  change: '+8.2%',  positive: true  },
  { value: '156',   label: 'Active Users',          change: '+5.1%',  positive: true  },
  { value: '2.4s',  label: 'Avg. Processing Time', change: '-13.3%', positive: false },
];

const GOLDEN_DATASETS = [
  {
    id: 1, name: 'Customer Analytics Dataset', cat: 'Analytics', catClass: 'analytics',
    desc: 'Comprehensive customer behavior and purchase pattern data for advanced analytics.',
    tags: [{ label: 'Most Downloaded', cls: 'downloaded' }, { label: 'Popular', cls: 'popular' }],
    downloads: '12.5K', size: '45 MB',
  },
  {
    id: 2, name: 'Sales Performance Data', cat: 'Business', catClass: 'business',
    desc: 'Historical sales data across regions and product categories for trend analysis.',
    tags: [{ label: 'Popular', cls: 'popular' }, { label: 'Trending', cls: 'trending' }],
    downloads: '8.3K', size: '32 MB',
  },
  {
    id: 3, name: 'Product Inventory Records', cat: 'Operations', catClass: 'ops',
    desc: 'Real-time inventory tracking data with stock levels and reorder points.',
    tags: [{ label: 'Trending', cls: 'trending' }],
    downloads: '6.7K', size: '28 MB',
  },
];

// ─── Types ───────────────────────────────────────────────────────────────────
type ToolId = 'ocr' | 'viz' | 'feat' | 'anon' | null;

// ─── Tool card data ──────────────────────────────────────────────────────────
const dataTools = [
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
  const [activeTool, setActiveTool] = useState<ToolId>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [startFeature, setStartFeature] = useState<ToolId>(null);
  const [isFeatureOpen, setIsFeatureOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTool]);

  const startOptions: { value: Exclude<ToolId, null>; label: string }[] = [
    { value: 'ocr', label: 'OCR Conversion' },
    { value: 'viz', label: 'Data Visualization' },
    { value: 'feat', label: 'Feature Engineering' },
    { value: 'anon', label: 'Data Anonymization' },
  ];

  useEffect(() => {
    const pendingTool = sessionStorage.getItem('home-start-tool');
    if (pendingTool === 'ocr' || pendingTool === 'viz' || pendingTool === 'feat' || pendingTool === 'anon') {
      setActiveTool(pendingTool);
    }
    if (pendingTool) sessionStorage.removeItem('home-start-tool');
  }, []);

  const handleStartProject = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!projectName.trim() || !startFeature) return;
    setShowStartModal(false);
    setIsFeatureOpen(false);
    setActiveTool(startFeature);
  };

  if (activeTool === 'ocr')  return <OcrPage               onBack={() => setActiveTool(null)} />;
  if (activeTool === 'viz')  return <DataVizPage            onBack={() => setActiveTool(null)} />;
  if (activeTool === 'feat') return <FeatureEngineeringPage onBack={() => setActiveTool(null)} />;
  if (activeTool === 'anon') return <DataAnonymizationPage  onBack={() => setActiveTool(null)} />;

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
            <button
              className="data-modal-close"
              type="button"
              onClick={() => {
                setShowStartModal(false);
                setIsFeatureOpen(false);
              }}
              aria-label="Close"
            >
              x
            </button>

            <h3 className="data-modal-title">Start New Project</h3>
            <p className="data-modal-sub">Create a new data processing project and select features to include.</p>

            <form className="data-modal-form" onSubmit={handleStartProject}>
              <label className="data-modal-label" htmlFor="data-project-name">Project Name</label>
              <input
                id="data-project-name"
                className="data-modal-input"
                placeholder="Enter project name..."
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />

              <label className="data-modal-label" htmlFor="data-start-feature">Where to Start</label>
              <div className="data-select" id="data-start-feature">
                <button
                  type="button"
                  className={`data-select-trigger${isFeatureOpen ? ' is-open' : ''}`}
                  onClick={() => setIsFeatureOpen((v) => !v)}
                >
                  <span className={!startFeature ? 'is-placeholder' : ''}>
                    {startOptions.find((o) => o.value === startFeature)?.label ?? 'Select starting feature...'}
                  </span>
                  <ChevronDown size={16} />
                </button>

                {isFeatureOpen && (
                  <div className="data-select-menu">
                    {startOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`data-select-option${startFeature === opt.value ? ' is-active' : ''}`}
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

              <div className="data-modal-actions">
                <button
                  type="button"
                  className="data-modal-btn data-modal-btn--ghost"
                  onClick={() => {
                    setShowStartModal(false);
                    setIsFeatureOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="data-modal-btn data-modal-btn--primary"
                  disabled={!projectName.trim() || !startFeature}
                >
                  Start Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="data-stats-row">
        {STATS_DATA.map((s, i) => (
          <div key={i} className="data-stat-card">
            <div className="data-stat-top">
              <div className="data-stat-icon"><TrendingUp size={16} /></div>
              <span className={`data-stat-badge ${s.positive ? 'positive' : 'negative'}`}>{s.change}</span>
            </div>
            <div className="data-stat-value">{s.value}</div>
            <div className="data-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="data-tools-grid">
        {dataTools.map(tool => (
          <DataToolCard key={tool.id} tool={tool} onOpen={setActiveTool} />
        ))}
      </div>

      {/* ── Dashboard ── */}
      <div className="data-dashboard">

        {/* Left – Recent Activity */}
        <div className="data-activity-card">
          <div className="data-activity-header">
            <div className="data-activity-icon"><Activity size={18} /></div>
            <div>
              <h3>Recent Activity</h3>
              <p>Latest operations and data processing activities</p>
            </div>
          </div>
          <div className="data-activity-list">
            {ACTIVITY_DATA.map(item => (
              <div key={item.id} className="data-activity-item">
                <div className="data-activity-dot" />
                <div className="data-activity-info">
                  <span className="data-activity-type">{item.type}</span>
                  <span className="data-activity-desc">{item.desc}</span>
                  <span className="data-activity-meta">
                    <Users size={11} />{item.user}&nbsp;&nbsp;<span>{item.time}</span>
                  </span>
                </div>
                <span className="data-activity-status">{item.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right col – Golden Datasets */}
        <div className="data-right-col">
          <div className="data-golden-card">
            <div className="data-golden-header">
              <div className="data-golden-icon"><Star size={18} /></div>
              <div>
                <h3>Golden Datasets</h3>
                <p>High-quality, curated datasets ready for immediate use</p>
              </div>
            </div>
            <div className="data-golden-list">
              {GOLDEN_DATASETS.map(ds => (
                <div key={ds.id} className="data-golden-item">
                  <div className="data-golden-info">
                    <div className="data-golden-title-row">
                      <span className="data-golden-name">{ds.name}</span>
                      <span className={`data-golden-cat ${ds.catClass}`}>{ds.cat}</span>
                    </div>
                    <p className="data-golden-desc">{ds.desc}</p>
                    <div className="data-golden-tags">
                      {ds.tags.map(t => (
                        <span key={t.cls} className={`data-golden-tag ${t.cls}`}>{t.label}</span>
                      ))}
                    </div>
                    <div className="data-golden-meta">
                      <Download size={11} />{ds.downloads}&nbsp;&nbsp;
                      <Database size={11} />{ds.size}
                    </div>
                  </div>
                  <button className="data-golden-arrow"><ChevronRight size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default DataExchangeView;
