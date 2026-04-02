import { useState } from 'react';
import {
  ArrowLeft, Sparkles, Database, BarChart2, Droplets,
  TrendingUp, Download, Upload, Search,
} from 'lucide-react';
import './ToolPage.css';

type FeStep = 'dataset' | 'profile' | 'quality' | 'generation' | 'preview' | 'export';
type DatasetTab = 'catalog' | 'upload';

const FE_STEPS: { id: FeStep; label: string; Icon: React.ElementType }[] = [
  { id: 'dataset',    label: 'Select Dataset',    Icon: Database   },
  { id: 'profile',    label: 'Data Profile',       Icon: BarChart2  },
  { id: 'quality',    label: 'Data Quality',       Icon: Droplets   },
  { id: 'generation', label: 'Feature Generation', Icon: Sparkles   },
  { id: 'preview',    label: 'Data Preview',       Icon: TrendingUp },
  { id: 'export',     label: 'Export',             Icon: Download   },
];

const DATASETS = [
  {
    name: 'Details of Beneficiaries under Saakshar Bharat Programme (karkkum Bharatham Thittam) by Districts in Tamil Nadu from 2010-11 to 2017',
    desc: 'Details of Beneficiaries under Saakshar Bharat Programme (karkkum Bharatham Thittam) by Districts in Tamil Nadu',
    category: 'Adult Education',
  },
  {
    name: 'Enrolment in school education from 1950-51 to 2009-10',
    desc: 'No description available',
    category: 'Adult Education',
  },
  {
    name: 'Customer Churn Dataset',
    desc: '10,234 rows · 24 cols',
    category: 'Commerce',
  },
  {
    name: 'Sales Forecast Q4 2025',
    desc: '45,112 rows · 18 cols',
    category: 'Business',
  },
  {
    name: 'Product Recommendation Data',
    desc: '128,400 rows · 32 cols',
    category: 'Retail',
  },
  {
    name: 'Financial Transactions Log',
    desc: '2.1M rows · 15 cols',
    category: 'Finance',
  },
];

const FeatureEngineeringPage = ({ onBack }: { onBack: () => void }) => {
  const [activeStep, setActiveStep] = useState<FeStep>('dataset');
  const [activeTab,  setActiveTab]  = useState<DatasetTab>('catalog');
  const [search,     setSearch]     = useState('');
  const [selected,   setSelected]   = useState<string | null>(null);

  const activeIdx = FE_STEPS.findIndex(s => s.id === activeStep);
  const filtered  = DATASETS.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.desc.toLowerCase().includes(search.toLowerCase())
  );

  // Build stepper as flat array – avoids Fragment key issue
  const stepperNodes: React.ReactNode[] = [];
  FE_STEPS.forEach((step, idx) => {
    const isActive = step.id === activeStep;
    const isDone   = activeIdx > idx;
    if (idx > 0) {
      stepperNodes.push(
        <div key={`conn-${idx}`} className={`xt-connector${isDone ? ' done' : ''}`} />
      );
    }
    stepperNodes.push(
      <div key={step.id} className="xt-step" onClick={() => setActiveStep(step.id)}>
        <div className={`xt-step-circle${isActive ? ' active' : isDone ? ' done' : ''}`}>
          <step.Icon size={16} />
        </div>
        <span className={`xt-step-label${isActive ? ' active' : ''}`}>{step.label}</span>
      </div>
    );
  });

  // Placeholder for non-dataset steps
  const PlaceholderIcon = FE_STEPS.find(s => s.id === activeStep)!.Icon;
  const placeholderLabel = FE_STEPS.find(s => s.id === activeStep)!.label;

  return (
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      {/* Header */}
      <div className="xt-header">
        <div className="xt-header-icon">
          <Sparkles size={26} />
        </div>
        <div>
          <h1 className="xt-header-title">AI Feature Engineering</h1>
          <p className="xt-header-subtitle">Automated feature generation powered by LLMs</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="xt-stepper-card">
        <div className="xt-stepper">{stepperNodes}</div>
      </div>

      {/* Content panel */}
      {activeStep === 'dataset' ? (
        <div className="xt-panel">
          <h2 className="xt-panel-title">Select Your Dataset</h2>
          <p className="xt-panel-subtitle">
            Choose from catalog or{' '}
            <span className="xt-link">upload your own CSV file</span>
          </p>

          <div className="xt-tabs">
            <button
              className={`xt-tab${activeTab === 'catalog' ? ' active' : ''}`}
              onClick={() => setActiveTab('catalog')}
            >
              <Database size={15} /> Catalog
            </button>
            <button
              className={`xt-tab${activeTab === 'upload' ? ' active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <Upload size={15} /> Upload Dataset
            </button>
          </div>

          {activeTab === 'catalog' && (
            <>
              <div className="xt-search-wrap">
                <Search size={15} className="xt-search-icon" />
                <input
                  className="xt-search-input"
                  placeholder="Search datasets by name, description, or tags..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <p className="xt-count">Found {filtered.length > 4 ? '1913' : filtered.length} datasets</p>
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
            </>
          )}

          {activeTab === 'upload' && (
            <div className="xt-upload-zone">
              <Upload size={36} color="#fb8c36" />
              <p>Drag &amp; drop a CSV file here, or click to browse</p>
              <p style={{ fontSize: 12, color: '#cbd5e1' }}>Supports CSV — up to 100 MB</p>
              <button className="xt-upload-btn">
                <Upload size={14} /> Browse File
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="xt-panel" style={{ textAlign: 'center', padding: '60px 40px' }}>
          <PlaceholderIcon size={48} color="#94a3b8" />
          <p style={{ marginTop: 16, color: '#64748b', fontSize: 15 }}>
            <strong>{placeholderLabel}</strong> — select a dataset first to continue.
          </p>
        </div>
      )}
    </div>
  );
};

export default FeatureEngineeringPage;
