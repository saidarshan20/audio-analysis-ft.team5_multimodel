import { useEffect, useState } from 'react';
import {
  ArrowLeft, Upload, Database, SlidersHorizontal,
  Play, BarChart2, Search, ChevronRight,
} from 'lucide-react';
import './AutoMLWizard.css';

// ─── Types ───────────────────────────────────────────────────────────────────
type WizardStep = 'dataset' | 'configure' | 'configuration' | 'training' | 'results';
type DatasetTab = 'catalog' | 'upload';

const AUTOML_API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:9080').replace(/\/$/, '');
const AUTOML_BACKEND_ENABLED = false;

// ─── Step definitions ─────────────────────────────────────────────────────────
const WIZARD_STEPS: { id: WizardStep; label: string; Icon: React.ElementType }[] = [
  { id: 'dataset',       label: 'Select Dataset',  Icon: Upload             },
  { id: 'configure',     label: 'Configure Data',  Icon: Database           },
  { id: 'configuration', label: 'Configuration',   Icon: SlidersHorizontal  },
  { id: 'training',      label: 'Training',         Icon: Play               },
  { id: 'results',       label: 'Results',          Icon: BarChart2          },
];

// ─── Sample catalog datasets ──────────────────────────────────────────────────
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
    name: 'Customer Churn Prediction Dataset',
    desc: 'Historical customer behaviour and churn labels — 10,234 rows · 24 cols',
    category: 'Commerce',
  },
  {
    name: 'Sales Forecast Q4 2025',
    desc: 'Regional sales data with trend indicators and forecasts — 45,112 rows',
    category: 'Business',
  },
  {
    name: 'Product Recommendation Data',
    desc: 'User-product interaction matrix for collaborative filtering — 128K rows',
    category: 'Retail',
  },
  {
    name: 'Financial Transactions Log',
    desc: 'Flagged transaction records for fraud detection — 2.1M rows · 15 cols',
    category: 'Finance',
  },
  {
    name: 'Healthcare Patient Outcomes',
    desc: 'Clinical trial data with treatment and outcome labels — 56K rows',
    category: 'Health',
  },
];

// ─── Workflow sidebar text ─────────────────────────────────────────────────────
const WORKFLOW = [
  'Search catalog for datasets',
  'Preview and configure data columns',
  'Select ML task and models',
  'Configure training settings',
  'Train and compare models',
  'View results and export',
];

// ─── AutoMLWizard ─────────────────────────────────────────────────────────────
const AutoMLWizard = ({ onBack }: { onBack: () => void }) => {
  const [activeStep, setActiveStep] = useState<WizardStep>('dataset');
  const [activeTab,  setActiveTab]  = useState<DatasetTab>('catalog');
  const [search,     setSearch]     = useState('');
  const [selected,   setSelected]   = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const postAutoMlPlaceholder = async (path: string, payload: Record<string, unknown>) => {
    if (!AUTOML_BACKEND_ENABLED) return;
    try {
      await fetch(`${AUTOML_API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Placeholder intentionally ignores network failures until backend is connected.
    }
  };

  const handleStepChange = (step: WizardStep) => {
    setActiveStep(step);
    void postAutoMlPlaceholder('/automl/step', { step });
  };

  const handleTabChange = (tab: DatasetTab) => {
    setActiveTab(tab);
    void postAutoMlPlaceholder('/automl/tab', { tab });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    void postAutoMlPlaceholder('/automl/search', { query: value });
  };

  const handleDatasetSelect = (datasetName: string) => {
    setSelected(datasetName);
    void postAutoMlPlaceholder('/automl/dataset/select', { datasetName });
  };

  const activeIdx = WIZARD_STEPS.findIndex(s => s.id === activeStep);
  const filtered  = DATASETS.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.desc.toLowerCase().includes(search.toLowerCase())
  );

  // Placeholder for non-dataset steps
  const PlaceholderIcon  = WIZARD_STEPS.find(s => s.id === activeStep)!.Icon;
  const placeholderLabel = WIZARD_STEPS.find(s => s.id === activeStep)!.label;

  return (
    <div className="aw-page">
      <button className="aw-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Home
      </button>

      {/* Page title (plain, no card) */}
      <h1 className="aw-title">AutoML Wizard</h1>
      <p className="aw-subtitle">
        Train and optimize machine learning models automatically with our guided wizard
      </p>

      {/* ── Stepper card ── */}
      <div className="aw-stepper-card">
        {WIZARD_STEPS.map((step, idx) => {
          const isActive = step.id === activeStep;
          const isDone   = activeIdx > idx;
          return (
            <div key={step.id} className="aw-step-group">
              {/* Chevron arrow between steps */}
              {idx > 0 && (
                <ChevronRight
                  size={22}
                  strokeWidth={3}
                  className={`aw-chevron${isDone ? ' done' : ''}`}
                />
              )}
              <div
                className="aw-step"
                onClick={() => handleStepChange(step.id)}
              >
                <div
                  className={`aw-step-circle${isActive ? ' active' : isDone ? ' done' : ''}`}
                >
                  <step.Icon size={20} />
                </div>
                <span className={`aw-step-label${isActive ? ' active' : ''}`}>
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Content area ── */}
      {activeStep === 'dataset' ? (
        <div className="aw-content-layout">

          {/* Left — dataset selector */}
          <div className="aw-main-panel">
            {/* Tabs */}
            <div className="aw-tabs">
              <button
                className={`aw-tab${activeTab === 'catalog' ? ' active' : ''}`}
                onClick={() => handleTabChange('catalog')}
              >
                <Database size={15} /> Catalog
              </button>
              <button
                className={`aw-tab${activeTab === 'upload' ? ' active' : ''}`}
                onClick={() => handleTabChange('upload')}
              >
                <Upload size={15} /> Upload Dataset
              </button>
            </div>

            {activeTab === 'catalog' && (
              <>
                {/* Search */}
                <div className="aw-search-wrap">
                  <Search size={15} className="aw-search-icon" />
                  <input
                    className="aw-search-input"
                    placeholder="Search datasets..."
                    value={search}
                    onChange={e => handleSearchChange(e.target.value)}
                  />
                </div>
                <p className="aw-count">
                  Showing <strong>1913</strong> datasets
                </p>

                {/* Dataset list */}
                <div className="aw-dataset-list">
                  {filtered.map(d => (
                    <div
                      key={d.name}
                      className={`aw-dataset-row${selected === d.name ? ' selected' : ''}`}
                      onClick={() => handleDatasetSelect(d.name)}
                    >
                      <div className="aw-dataset-info">
                        <span className="aw-dataset-name">{d.name}</span>
                        <span className="aw-dataset-desc">{d.desc}</span>
                      </div>
                      <span className="aw-dataset-badge">{d.category}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'upload' && (
              <div className="aw-upload-zone">
                <Upload size={36} color="#fb8c36" />
                <p>Drag &amp; drop a file here, or click to browse</p>
                <p className="aw-upload-hint">Supports CSV, Excel, JSON — up to 100 MB</p>
                <button className="aw-upload-btn">
                  <Upload size={14} /> Browse File
                </button>
              </div>
            )}
          </div>

          {/* Right — workflow sidebar */}
          <div className="aw-sidebar">
            <p className="aw-sidebar-title">AutoML Workflow:</p>
            <ul className="aw-sidebar-list">
              {WORKFLOW.map(item => (
                <li key={item} className="aw-sidebar-item">
                  <span className="aw-sidebar-dot">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

        </div>
      ) : (
        /* Placeholder for other steps */
        <div className="aw-placeholder-panel">
          <PlaceholderIcon size={48} color="#94a3b8" />
          <p>
            <strong>{placeholderLabel}</strong> — select a dataset first to continue.
          </p>
        </div>
      )}
    </div>
  );
};

export default AutoMLWizard;
