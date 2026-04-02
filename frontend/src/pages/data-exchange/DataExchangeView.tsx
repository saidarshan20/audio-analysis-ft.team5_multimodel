import { useState } from 'react';
import {
  FileText, Sparkles, ScanLine, BarChart2, Lock, ArrowRight,
  TrendingUp, Activity, Star, Users, ChevronRight, Database, Download,
} from 'lucide-react';
import './DataExchangeView.css';
import OcrPage               from './tools/OcrPage';
import DataVizPage           from './tools/DataVizPage';
import FeatureEngineeringPage from './tools/FeatureEngineeringPage';
import DataAnonymizationPage  from './tools/DataAnonymizationPage';

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

// ─── DataExchangeView ────────────────────────────────────────────────────────
const DataExchangeView = () => {
  const [activeTool, setActiveTool] = useState<ToolId>(null);

  if (activeTool === 'ocr')  return <OcrPage               onBack={() => setActiveTool(null)} />;
  if (activeTool === 'viz')  return <DataVizPage            onBack={() => setActiveTool(null)} />;
  if (activeTool === 'feat') return <FeatureEngineeringPage onBack={() => setActiveTool(null)} />;
  if (activeTool === 'anon') return <DataAnonymizationPage  onBack={() => setActiveTool(null)} />;

  return (
    <div className="view-animate-in data-exchange-container">
      <div className="data-hero">
        <div className="hero-badge">
          <FileText size={14} className="hero-badge-icon" />
          <span>Data Processing Tools</span>
        </div>
        <h1 className="hero-title">Data Exchange</h1>
        <p className="hero-subtitle">
          Powerful tools for data processing, transformation, and analysis. Transform your raw<br />
          data into actionable insights.
        </p>
        <button className="data-start-btn">
          <Sparkles size={16} />
          <span>Start New Project</span>
          <ArrowRight size={16} />
        </button>
      </div>

      <div className="data-tools-grid">
        {dataTools.map(tool => (
          <div key={tool.id} className="tool-card">
            <div className="tool-card-content">
              <div className={`tool-icon-box ${tool.iconBoxType}`}>{tool.icon}</div>
              <h3 className="tool-title">{tool.title}</h3>
              <p className="tool-description">{tool.description}</p>
            </div>
            <button className="tool-open-btn" onClick={() => setActiveTool(tool.id as ToolId)}>
              <span>Open Tool</span>
              <ArrowRight size={16} />
            </button>
          </div>
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

        {/* Right col – Stats + Golden Datasets */}
        <div className="data-right-col">
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
