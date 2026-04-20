import { useState, useRef } from 'react';
import {
  ArrowLeft, Sparkles, Database, BarChart2, Droplets,
  TrendingUp, Download, Upload, Search, CheckCircle2,
  AlertTriangle, ChevronRight, ChevronLeft, FileDown, Eye, FileCheck,
  CheckSquare, Square, Edit2, Play, Layout, Cpu, Minimize2, MoveHorizontal, Code, Info, Send, Wand2,
  FileText, Lock, ArrowRight,
} from 'lucide-react';
import '../ToolPage.css';
import './FeatureEngineering.css';

type FeStep = 'dataset' | 'profile' | 'quality' | 'generation' | 'preview' | 'export';
type DatasetTab = 'catalog' | 'upload';
type ProfileTab = 'overview' | 'quality' | 'distributions' | 'missing' | 'columns';
type GenStageId = 'creation' | 'transformation' | 'extraction' | 'scaling' | 'selection';
type GenItem = { id: string; name: string; desc: string; reasoning: string; selected: boolean };
type GenStageData = { title: string; desc: string; items: GenItem[] };

type ProfileColumnDetail = {
  column: string; dtype: string; unique: number; missing: number;
  mean?: number; median?: number; std?: number; min?: number; max?: number;
  skew?: number; outlier_percent?: number;
};
type ProfileApiResponse = {
  overview: { rows: number; columns: number; missing_percent: number; memory_mb: number };
  types: { numeric: number; categorical: number; datetime: number };
  quality: { completeness: number; feature_richness: number };
  column_details: ProfileColumnDetail[];
  correlation: Record<string, Record<string, number>>;
  distributions: Record<string, { type: string; mean?: number; median?: number }>;
};

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:9080').replace(/\/$/, '');

const FE_STEPS: { id: FeStep; label: string; Icon: React.ElementType }[] = [
  { id: 'dataset',    label: 'Select Dataset',    Icon: Database   },
  { id: 'profile',    label: 'Data Profile',       Icon: BarChart2  },
  { id: 'quality',    label: 'Data Quality',       Icon: Droplets   },
  { id: 'generation', label: 'Feature Generation', Icon: Sparkles   },
  { id: 'preview',    label: 'Data Preview',       Icon: TrendingUp },
  { id: 'export',     label: 'Export',             Icon: Download   },
];

const DATASETS = [
  { name: 'Details of Beneficiaries under Saakshar Bharat Programme (karkkum Bharatham Thittam) by Districts in Tamil Nadu from 2010-11 to 2017', desc: 'Details of Beneficiaries under Saakshar Bharat Programme', category: 'Adult Education' },
  { name: 'Enrolment in school education from 1950-51 to 2009-10', desc: 'No description available', category: 'Adult Education' },
  { name: 'Customer Churn Dataset', desc: '10,234 rows · 24 cols', category: 'Commerce' },
  { name: 'Sales Forecast Q4 2025', desc: '45,112 rows · 18 cols', category: 'Business' },
  { name: 'Product Recommendation Data', desc: '128,400 rows · 32 cols', category: 'Retail' },
  { name: 'Financial Transactions Log', desc: '2.1M rows · 15 cols', category: 'Finance' },
];

// ── Profile mock data (unused — profile now uses inline static data) ───────
// const PROFILE_COLS = [
//   { name: 'customer_id',    type: 'Integer', missing: '0%',   unique: '10,234', mean: '-',      std: '-' },
//   { name: 'age',            type: 'Integer', missing: '1.2%', unique: '72',     mean: '38.4',   std: '12.1' },
//   { name: 'tenure_months',  type: 'Integer', missing: '0%',   unique: '120',    mean: '29.6',   std: '18.3' },
//   { name: 'monthly_charge', type: 'Float',   missing: '0.4%', unique: '1,832',  mean: '64.8',   std: '30.1' },
//   { name: 'total_charges',  type: 'Float',   missing: '0.4%', unique: '6,543',  mean: '2,280',  std: '2,267' },
//   { name: 'churn',          type: 'Boolean', missing: '0%',   unique: '2',      mean: '-',      std: '-' },
// ];

// ── Quality checks ─────────────────────────────────────────────────────────
type QualityIssueType = 'missing' | 'outlier';
type QualityRow = { id: string; column: string; type: QualityIssueType; fix: string; reasoning: string; };

const QUALITY_ROWS: QualityRow[] = [
  { id: 'q1',  column: 'beneficiaries_in_2010__11', type: 'missing', fix: 'impute (median)', reasoning: 'Target: grand_total | Median chosen due to high skewness (2.19) and to avoid introducing outliers, preserving correlation with grand_total.' },
  { id: 'q2',  column: 'beneficiaries_in_2011__12', type: 'missing', fix: 'impute (median)', reasoning: 'Target: grand_total | Median chosen due to high skewness (2.49) and strong correlation (0.997) with grand_total, ensuring prediction integrity.' },
  { id: 'q3',  column: 'beneficiaries_in_2012__13', type: 'missing', fix: 'impute (median)', reasoning: 'Target: grand_total | Median imputation preserves the skewed distribution of this column while maintaining its high correlation (0.994) with grand_total.' },
  { id: 'q4',  column: 'beneficiaries_in_2013__14', type: 'missing', fix: 'impute (median)', reasoning: 'Target: grand_total | High skewness (2.31) makes median the safest imputation strategy to preserve correlation (0.989) with the target.' },
  { id: 'q5',  column: 'beneficiaries_in_2010__11', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | IQR capping retains the data point while reducing its leverage effect on regression models.' },
  { id: 'q6',  column: 'beneficiaries_in_2011__12', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | Outlier identified at 3.2σ above mean. IQR capping chosen to minimise information loss.' },
  { id: 'q7',  column: 'beneficiaries_in_2012__13', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | Capping at 99th percentile preserves distribution shape while eliminating extreme leverage.' },
  { id: 'q8',  column: 'beneficiaries_in_2013__14', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | Identified as high-leverage outlier; IQR capping reduces its disproportionate influence.' },
  { id: 'q9',  column: 'beneficiaries_in_2014__15', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | Outlier at 2.8σ. Capping preferred over removal to preserve row count.' },
  { id: 'q10', column: 'beneficiaries_in_2015__16', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | Extreme value detected; IQR-based cap aligns with distribution tail without distorting mean.' },
  { id: 'q11', column: 'beneficiaries_in_2016__17', type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | High-leverage point reduced via capping to improve model stability.' },
  { id: 'q12', column: 'grand_total',               type: 'outlier', fix: 'cap (IQR)',       reasoning: 'Target: grand_total | Outlier in target column; capping prevents overfitting to extreme labels.' },
];

// ── Feature generation sub-stages ────────────────────────────────────────
const GEN_STAGES: { id: GenStageId; title: string; Icon: React.ElementType }[] = [
  { id: 'creation',       title: 'Feature Creation',   Icon: Layout         },
  { id: 'transformation', title: 'Transformation',      Icon: MoveHorizontal },
  { id: 'extraction',     title: 'Feature Extraction',  Icon: Minimize2      },
  { id: 'scaling',        title: 'Scaling',             Icon: Cpu            },
  { id: 'selection',      title: 'Feature Selection',   Icon: CheckSquare    },
];

const INITIAL_STAGE_DATA: Record<GenStageId, GenStageData> = {
  creation: {
    title: 'Feature Creation',
    desc: 'Generate new features from existing columns',
    items: [
      { id: 'fc1', name: 'price_per_sqft',           desc: 'Price per square foot of the property.',                             reasoning: "Target: price | 'area' is strongly correlated with 'price' (Pearson: 0.536). Price per sq ft normalises the size-price relationship.",                                                                               selected: true },
      { id: 'fc2', name: 'rooms_to_area_ratio',      desc: 'Ratio of total rooms (bedrooms + bathrooms) to property area.',     reasoning: "Target: price | Both 'bedrooms' (Pearson: 0.366) and 'bathrooms' (0.518) correlate with price. This ratio captures room density.",                                                                                selected: true },
      { id: 'fc3', name: 'stories_parking_product',  desc: 'Product of number of stories and parking spaces.',                  reasoning: "Target: price | 'stories' (0.421) and 'parking' (0.384) are moderately correlated with price. Their product captures combined impact.",                                                                             selected: true },
    ],
  },
  transformation: {
    title: 'Transformation',
    desc: 'Apply mathematical transformations',
    items: [
      { id: 'tx1', name: 'price_log',       desc: "Log-transformed 'price' to correct skewness.",                    reasoning: "Target: price | 'price' has skewness 1.212. Log transformation normalises distribution and improves model performance.",       selected: true },
      { id: 'tx2', name: 'area_sqrt',       desc: "Square root of 'area' to reduce skewness.",                       reasoning: "Target: price | 'area' has skewness 1.321. Square root reduces skew and improves relationship with price.",                   selected: true },
      { id: 'tx3', name: 'stories_binned',  desc: "Binned 'stories' into categorical groups.",                       reasoning: "Target: price | 'stories' has only 4 unique values. Binning captures its relationship with price more effectively.",          selected: true },
    ],
  },
  extraction: {
    title: 'Feature Extraction',
    desc: 'Extract latent features via dimensionality reduction',
    items: [
      { id: 'ex1', name: 'area_pca_1',                       desc: "First PCA component from numeric features correlated with 'price'.",        reasoning: "Target: price | PCA reduces dimensionality while preserving variance in features highly correlated with price.",                                          selected: true },
      { id: 'ex2', name: 'furnishingstatus_len',             desc: "Length of the furnishing status string.",                                   reasoning: "Target: price | String length may indirectly capture property quality differences that influence price.",                                                  selected: true },
      { id: 'ex3', name: 'mainroad_guestroom_interaction',  desc: "Interaction of 'mainroad' and 'guestroom' categorical features.",           reasoning: "Target: price | Properties on main road with a guestroom may have higher desirability, influencing price.",                                             selected: true },
    ],
  },
  scaling: {
    title: 'Scaling',
    desc: 'Normalise features to similar ranges',
    items: [
      { id: 'sc1', name: 'area_standardized',   desc: "StandardScaler applied to 'area'.",            reasoning: "Target: price | 'area' has strong correlation (0.536). StandardScaler suits its near-normal distribution.",          selected: true },
      { id: 'sc2', name: 'bathrooms_robust',    desc: "RobustScaler applied to 'bathrooms'.",          reasoning: "Target: price | 'bathrooms' (0.518) has high skewness (1.589). RobustScaler handles outliers well.",              selected: true },
      { id: 'sc3', name: 'stories_normalized',  desc: "MinMaxScaler applied to 'stories' (0–1).",      reasoning: "Target: price | 'stories' is bounded 1–4. MinMaxScaler provides clean normalisation.",                             selected: true },
    ],
  },
  selection: {
    title: 'Feature Selection',
    desc: 'Remove redundant or low-value features',
    items: [],
  },
};

// Columns in the static preview table that should be highlighted as "new"
const NEW_PREVIEW_COLS = new Set(['charge_per_month_ratio', 'age_tenure_interaction', 'above_avg_spender']);

// ── Data Preview table ────────────────────────────────────────────────────
const DPREVIEW_HEADERS = ['sl_no_', 'name_of_the_district', 'beneficiaries_in_2010__11', 'beneficiaries_in_2011__12', 'beneficiaries_in_2012__13', 'beneficiaries_in_2013__14'];
const DPREVIEW_ROWS = [
  ['1', 'Ariyalur',       '1024.0',    '55459.0',    '24368.0',  '6863.0'  ],
  ['2', 'Dharmapuri',    '45260.0',   '207363.0',   '7103.0',   '4661.0'  ],
  ['3', 'Chennai',       '21456.0',   '130595.0',   '23991.0',  '3114.0'  ],
  ['4', 'Coimbatore',    '14897.0',   '89341.0',    '19872.0',  '5177.0'  ],
  ['5', 'Cuddalore',     '31024.0',   '162408.0',   '28453.0',  '7820.0'  ],
  ['6', 'Dharmapuri',    '9843.0',    '48270.0',    '11249.0',  '2994.0'  ],
  ['7', 'Aravanakulam',  '24150.0',   '235914.0',   '23914.0',  '5117.0'  ],
  ['8', 'Tiruppur',      'null',      'null',        'null',     'null'    ],
  ['9', 'Krishnagiri',   'null',      'null',        'null',     'null'    ],
  ['Total', 'Grand Total', '267555.0', '1245052.0',  '213481.0', '67305.0' ],
];

// ── Preview table (legacy — superseded by DPREVIEW_* below) ───────────────
// const PREVIEW_HEADERS = ['customer_id', ...];
// const PREVIEW_ROWS    = [...];

// ── Component ─────────────────────────────────────────────────────────────
const FeatureEngineeringPage = ({ onBack }: { onBack: () => void }) => {
  const [activeStep,    setActiveStep]    = useState<FeStep>('dataset');
  const [completed,     setCompleted]     = useState<Set<FeStep>>(new Set());
  const [activeTab,     setActiveTab]     = useState<DatasetTab>('catalog');
  const [profileTab,    setProfileTab]    = useState<ProfileTab>('overview');
  const [search,        setSearch]        = useState('');
  const [selected,      setSelected]      = useState<string | null>(null);
  const [stageIndex,    setStageIndex]    = useState(0);
  const [stageData,     setStageData]     = useState<Record<GenStageId, GenStageData>>(INITIAL_STAGE_DATA);
  const [stageLoading,  setStageLoading]  = useState(false);
  const [genStarted,    setGenStarted]    = useState(false);
  const [,  setSelectedFeat]  = useState<Set<string>>(new Set());
  const [dqSelected,    setDqSelected]    = useState<Set<string>>(new Set(QUALITY_ROWS.map(r => r.id)));
  const [customTransform, setCustomTransform] = useState('');
  const [uploadedFile,  setUploadedFile]  = useState<File | null>(null);
  const [dragOver,      setDragOver]      = useState(false);
  const [sessionId,     setSessionId]     = useState<string | null>(null);
  void sessionId; // used for API calls; stored for downstream steps
  const [profileData,   setProfileData]   = useState<ProfileApiResponse | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadToBackend = async () => {
    if (!uploadedFile) return;
    setUploadLoading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      const uploadRes = await fetch(`${API_BASE}/team2_feature_eng/upload`, { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`);
      const uploadJson = await uploadRes.json();
      const sid: string = uploadJson.session_id;
      setSessionId(sid);
      const profileRes = await fetch(`${API_BASE}/team2_feature_eng/profile/${sid}`);
      if (!profileRes.ok) throw new Error(`Profile fetch failed: ${profileRes.statusText}`);
      const profile: ProfileApiResponse = await profileRes.json();
      setProfileData(profile);
      complete('dataset');
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Is the backend running?');
    } finally {
      setUploadLoading(false);
    }
  };

  const ACCEPTED_TYPES = ['.csv', '.xlsx', '.xls'];
  const ACCEPTED_MIME  = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

  const validateAndSet = (file: File | null) => {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (ACCEPTED_TYPES.includes(ext) || ACCEPTED_MIME.includes(file.type)) {
      setUploadedFile(file);
      setSelected(file.name);
    } else {
      alert('Only CSV and Excel (.xlsx, .xls) files are supported.');
    }
  };

  const filtered = DATASETS.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.desc.toLowerCase().includes(search.toLowerCase())
  );

  const goTo = (step: FeStep) => {
    const idx = FE_STEPS.findIndex(s => s.id === step);
    const canGo = idx === 0 || completed.has(FE_STEPS[idx - 1].id) || completed.has(step);
    if (canGo) setActiveStep(step);
  };

  const complete = (current: FeStep) => {
    const next = FE_STEPS[FE_STEPS.findIndex(s => s.id === current) + 1];
    setCompleted(prev => new Set([...prev, current]));
    if (next) setActiveStep(next.id);
  };

  // ── Generation sub-stage helpers ──
  const currentStageId             = GEN_STAGES[stageIndex].id;
  const currentStageItems          = stageData[currentStageId].items;
  const currentStageSelectedCount  = currentStageItems.filter(i => i.selected).length;

  const toggleItem = (id: string) => {
    setStageData(prev => {
      const updated = prev[currentStageId].items.map(i => i.id === id ? { ...i, selected: !i.selected } : i);
      return { ...prev, [currentStageId]: { ...prev[currentStageId], items: updated } };
    });
  };

  const toggleAll = () => {
    const allSel = currentStageItems.every(i => i.selected);
    setStageData(prev => {
      const updated = prev[currentStageId].items.map(i => ({ ...i, selected: !allSel }));
      return { ...prev, [currentStageId]: { ...prev[currentStageId], items: updated } };
    });
  };

  const applyAndNext = () => {
    if (stageIndex < GEN_STAGES.length - 1) {
      setStageLoading(true);
      setTimeout(() => { setStageLoading(false); setStageIndex(stageIndex + 1); }, 1000);
    } else {
      const allSelected = new Set<string>(
        (Object.values(stageData) as GenStageData[]).flatMap(s => s.items.filter(i => i.selected).map(i => i.name))
      );
      setSelectedFeat(allSelected);
      complete('generation');
    }
  };

  // ── Stepper ──
  const stepperNodes: React.ReactNode[] = [];
  FE_STEPS.forEach((step, idx) => {
    const isActive = step.id === activeStep;
    const isDone   = completed.has(step.id);
    const isLocked = idx > 0 && !completed.has(FE_STEPS[idx - 1].id) && !completed.has(step.id);
    if (idx > 0) stepperNodes.push(
      <div key={`conn-${idx}`} className={`xt-connector${isDone ? ' done' : ''}`} />
    );
    stepperNodes.push(
      <div key={step.id} className={`xt-step${isLocked ? ' locked' : ''}`} onClick={() => goTo(step.id)}>
        <div className={`xt-step-circle${isActive ? ' active' : isDone ? ' done' : ''}`}>
          {isDone && !isActive ? <CheckCircle2 size={16} /> : <step.Icon size={16} />}
        </div>
        <span className={`xt-step-label${isActive ? ' active' : isDone ? ' done' : ''}`}>{step.label}</span>
      </div>
    );
  });

  return (
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      {/* Header */}
      <div className="xt-header">
        <div className="xt-header-icon"><Sparkles size={26} /></div>
        <div>
          <h1 className="xt-header-title">AI Feature Engineering</h1>
          <p className="xt-header-subtitle">Automated feature generation powered by LLMs</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="xt-stepper-card">
        <div className="xt-stepper">{stepperNodes}</div>
      </div>

      {/* ── Step 1: Select Dataset ── */}
      {activeStep === 'dataset' && (
        <div className="xt-panel">
          <h2 className="xt-panel-title">Select Your Dataset</h2>
          <p className="xt-panel-subtitle">Choose from catalog or upload your own CSV / Excel file</p>
          <div className="xt-tabs">
            <button className={`xt-tab${activeTab === 'catalog' ? ' active' : ''}`} onClick={() => setActiveTab('catalog')}>
              <Database size={15} /> Catalog
            </button>
            <button className={`xt-tab${activeTab === 'upload' ? ' active' : ''}`} onClick={() => setActiveTab('upload')}>
              <Upload size={15} /> Upload Dataset
            </button>
          </div>
          {activeTab === 'catalog' && (
            <>
              <div className="xt-search-wrap">
                <Search size={15} className="xt-search-icon" />
                <input className="xt-search-input" placeholder="Search datasets by name, description, or tags..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <p className="xt-count">Found {filtered.length > 4 ? '1913' : filtered.length} datasets</p>
              <div className="xt-dataset-list">
                {filtered.map(d => (
                  <div key={d.name} className={`xt-dataset-row${selected === d.name ? ' selected' : ''}`} onClick={() => setSelected(d.name)}>
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
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={e => validateAndSet(e.target.files?.[0] ?? null)}
              />
              {uploadedFile ? (
                <div className="fe-upload-success">
                  <FileCheck size={32} color="#16a34a" />
                  <div className="fe-upload-file-info">
                    <span className="fe-upload-file-name">{uploadedFile.name}</span>
                    <span className="fe-upload-file-size">{(uploadedFile.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button className="fe-upload-change-btn" onClick={() => { setUploadedFile(null); setSelected(null); }}>
                    Change File
                  </button>
                </div>
              ) : (
                <div
                  className={`xt-upload-zone${dragOver ? ' drag-over' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); validateAndSet(e.dataTransfer.files[0] ?? null); }}
                >
                  <Upload size={36} color="#fb8c36" />
                  <p>Drag &amp; drop a CSV or Excel file here, or click to browse</p>
                  <p style={{ fontSize: 12, color: '#cbd5e1' }}>Supports .csv, .xlsx, .xls — up to 100 MB</p>
                  <button className="xt-upload-btn" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                    <Upload size={14} /> Browse File
                  </button>
                </div>
              )}
            </>
          )}
          <div className="fe-step-footer">
            {uploadError && (
              <span style={{ color: '#dc2626', fontSize: 13, marginRight: 'auto' }}>
                {uploadError}
              </span>
            )}
            <button
              className="fe-next-btn"
              disabled={
                uploadLoading ||
                (activeTab === 'upload' ? !uploadedFile : !selected)
              }
              onClick={activeTab === 'upload' && uploadedFile ? uploadToBackend : () => complete('dataset')}
            >
              {uploadLoading ? 'Uploading…' : <>Continue to Data Profile <ChevronRight size={16} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Data Profile ── */}
      {activeStep === 'profile' && (
        <div className="xt-panel fe-profile-panel">
          {/* Title */}
          <h2 className="xt-panel-title">Dataset Profile</h2>
          <p className="xt-panel-subtitle">Comprehensive analysis of your dataset structure and quality</p>

          {/* Top stat cards */}
          <div className="fe-profile-stat-row">
            <div className="fe-profile-stat-card">
              <span className="fe-profile-stat-label">Total Rows</span>
              <span className="fe-profile-stat-value">{profileData?.overview.rows ?? 545}</span>
            </div>
            <div className="fe-profile-stat-card">
              <span className="fe-profile-stat-label">Total Columns</span>
              <span className="fe-profile-stat-value">{profileData?.overview.columns ?? 13}</span>
            </div>
            <div className="fe-profile-stat-card">
              <span className="fe-profile-stat-label">Missing Data</span>
              <span className="fe-profile-stat-value">{profileData ? `${profileData.overview.missing_percent.toFixed(1)}%` : '0.0%'}</span>
            </div>
          </div>

          {/* Sub-tab bar */}
          <div className="fe-profile-tabs">
            {(['overview','quality','distributions','missing','columns'] as ProfileTab[]).map(t => (
              <button key={t} className={`fe-profile-tab${profileTab === t ? ' active' : ''}`} onClick={() => setProfileTab(t)}>
                {t === 'overview' ? 'Overview' : t === 'quality' ? 'Data Quality' : t === 'distributions' ? 'Distributions' : t === 'missing' ? 'Missing Values' : 'Column Details'}
              </button>
            ))}
          </div>

          {/* ── Overview tab ── */}
          {profileTab === 'overview' && (
            <div className="fe-profile-content">
              <div className="fe-overview-row">
                {/* Column Type Distribution */}
                <div className="fe-overview-card">
                  <h3 className="fe-overview-card-title">Column Type Distribution</h3>
                  <p className="fe-overview-card-sub">Breakdown of column data types in your dataset</p>
                  <div className="fe-donut-wrap">
                    <div className="fe-donut" />
                    <div className="fe-donut-legend">
                      <span className="fe-donut-dot" style={{ background: '#7c3aed' }} /> Numeric: {profileData?.types.numeric ?? 6} &nbsp;&nbsp;
                      <span className="fe-donut-dot" style={{ background: '#3b82f6' }} /> Categorical: {profileData?.types.categorical ?? 7}
                    </div>
                  </div>
                </div>
                {/* Data Health Score */}
                <div className="fe-overview-card">
                  <h3 className="fe-overview-card-title">Data Health Score</h3>
                  <p className="fe-overview-card-sub">Overall dataset quality metrics</p>
                  <div className="fe-health-row">
                    <span className="fe-health-label">Data Completeness</span>
                    <span className="fe-health-pct">{profileData ? `${profileData.quality.completeness.toFixed(1)}%` : '100.0%'}</span>
                  </div>
                  <div className="fe-health-bar-wrap"><div className="fe-health-bar" style={{ width: `${profileData?.quality.completeness ?? 100}%` }} /></div>
                  <div className="fe-health-items">
                    <div className="fe-health-item"><span>Numeric Columns</span><strong>{profileData?.types.numeric ?? 6}</strong></div>
                    <div className="fe-health-item"><span>Categorical Columns</span><strong>{profileData?.types.categorical ?? 7}</strong></div>
                    <div className="fe-health-item"><span>Datetime Columns</span><strong>{profileData?.types.datetime ?? 0}</strong></div>
                    <div className="fe-health-item"><span>Text Columns</span><strong>0</strong></div>
                  </div>
                </div>
              </div>
              {/* Dataset Memory Footprint */}
              <div className="fe-overview-card fe-footprint-card">
                <h3 className="fe-overview-card-title">Dataset Memory Footprint</h3>
                <p className="fe-overview-card-sub">Estimated memory consumption by data types</p>
                <div className="fe-footprint-grid">
                  <div className="fe-footprint-item">
                    <Database size={28} color="#fb8c36" />
                    <strong>{profileData ? `${profileData.overview.memory_mb.toFixed(2)} MB` : '0.05 MB'}</strong>
                    <span>Estimated Size</span>
                  </div>
                  <div className="fe-footprint-item">
                    <TrendingUp size={28} color="#16a34a" />
                    <strong>{profileData?.types.numeric ?? 6}</strong>
                    <span>Numeric Features</span>
                  </div>
                  <div className="fe-footprint-item">
                    <BarChart2 size={28} color="#2563eb" />
                    <strong>{profileData?.types.categorical ?? 7}</strong>
                    <span>Categorical Features</span>
                  </div>
                  <div className="fe-footprint-item">
                    <AlertTriangle size={28} color="#d97706" />
                    <strong>{profileData ? profileData.column_details.filter(c => c.missing > 0).length : 0}</strong>
                    <span>Columns w/ Missing</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Data Quality tab ── */}
          {profileTab === 'quality' && (
            <div className="fe-profile-content">
              <div className="fe-overview-card" style={{ marginBottom: 16 }}>
                <h3 className="fe-overview-card-title">Data Completeness Overview</h3>
                <p className="fe-overview-card-sub">Visual representation of missing data and outliers</p>
                <div className="fe-bar-chart">
                  <div className="fe-bar-y-axis">
                    {[100,75,50,25,0].map(v => <span key={v}>{v}</span>)}
                  </div>
                  <div className="fe-bar-chart-area">
                    <div className="fe-bar-gridlines">
                      {[0,1,2,3,4].map(i => <div key={i} className="fe-bar-gridline" />)}
                    </div>
                    <div className="fe-bars">
                      <div className="fe-bar-group">
                        <div className="fe-bar-fill" style={{ height: '100%', background: '#10b981' }} />
                        <span className="fe-bar-xlabel">Complete Data</span>
                      </div>
                      <div className="fe-bar-group">
                        <div className="fe-bar-fill" style={{ height: '0%', background: '#10b981' }} />
                        <span className="fe-bar-xlabel">Missing Data</span>
                      </div>
                    </div>
                    <div className="fe-bar-legend"><span className="fe-donut-dot" style={{ background: '#7c3aed' }} /> value</div>
                  </div>
                </div>
              </div>
              <div className="fe-overview-card">
                <h3 className="fe-overview-card-title">Quality Score Breakdown</h3>
                <p className="fe-overview-card-sub">Individual quality metrics for your dataset</p>
                <div className="fe-qscore-item">
                  <div className="fe-qscore-header">
                    <span><CheckCircle2 size={14} color="#16a34a" style={{ verticalAlign: 'middle', marginRight: 6 }} />Completeness Score</span>
                    <strong>{profileData ? `${profileData.quality.completeness.toFixed(1)}%` : '100.0%'}</strong>
                  </div>
                  <div className="fe-health-bar-wrap"><div className="fe-health-bar" style={{ width: `${profileData?.quality.completeness ?? 100}%` }} /></div>
                  <p className="fe-qscore-hint">Higher is better. Indicates percentage of non-missing values in dataset.</p>
                </div>
                <div className="fe-qscore-item" style={{ marginTop: 20 }}>
                  <div className="fe-qscore-header">
                    <span><TrendingUp size={14} color="#fb8c36" style={{ verticalAlign: 'middle', marginRight: 6 }} />Feature Richness</span>
                    <strong>{profileData ? `${(profileData.quality.feature_richness * 100).toFixed(1)}%` : '46.2%'}</strong>
                  </div>
                  <div className="fe-health-bar-wrap"><div className="fe-health-bar" style={{ width: `${(profileData?.quality.feature_richness ?? 0.462) * 100}%` }} /></div>
                  <p className="fe-qscore-hint">Ratio of numeric columns to total columns. Important for ML modeling.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Distributions tab ── */}
          {profileTab === 'distributions' && (
            <div className="fe-profile-content">
              <div className="fe-overview-card" style={{ marginBottom: 16 }}>
                <h3 className="fe-overview-card-title">Numeric Column Statistics</h3>
                <p className="fe-overview-card-sub">Statistical distribution summary of numeric features</p>
                <div className="fe-bar-chart fe-bar-chart--tall">
                  <div className="fe-bar-y-axis">
                    {['5M','3.75M','2.5M','1.25M','0'].map(v => <span key={v}>{v}</span>)}
                  </div>
                  <div className="fe-bar-chart-area">
                    <div className="fe-bar-gridlines">
                      {[0,1,2,3,4].map(i => <div key={i} className="fe-bar-gridline" />)}
                    </div>
                    <div className="fe-bars fe-bars--multi">
                      {[
                        { label: 'price',     mean: 92, median: 0  },
                        { label: 'area',      mean: 0,  median: 0  },
                        { label: 'bedrooms',  mean: 82, median: 5  },
                        { label: 'bathrooms', mean: 0,  median: 0  },
                        { label: 'stories',   mean: 0,  median: 0  },
                        { label: 'parking',   mean: 0,  median: 0  },
                      ].map(col => (
                        <div key={col.label} className="fe-bar-group">
                          <div className="fe-bars-pair">
                            <div className="fe-bar-fill" style={{ height: `${col.mean}%`, background: '#7c3aed' }} title={`Mean`} />
                            <div className="fe-bar-fill" style={{ height: `${col.median}%`, background: '#3b82f6' }} title={`Median`} />
                          </div>
                          <span className="fe-bar-xlabel fe-bar-xlabel--angled">{col.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="fe-bar-legend">
                      <span className="fe-donut-dot" style={{ background: '#7c3aed' }} /> Mean &nbsp;&nbsp;
                      <span className="fe-donut-dot" style={{ background: '#3b82f6' }} /> Median
                    </div>
                  </div>
                </div>
              </div>
              <div className="fe-overview-card">
                <h3 className="fe-overview-card-title">Distribution Shape Analysis</h3>
                <p className="fe-overview-card-sub">Skewness indicates asymmetry; values near 0 suggest normal distribution</p>
                <div className="fe-bar-chart fe-bar-chart--tall">
                  <div className="fe-bar-y-axis">
                    {['1.6','1.2','0.8','0.4','0'].map(v => <span key={v}>{v}</span>)}
                  </div>
                  <div className="fe-bar-chart-area">
                    <div className="fe-bar-gridlines">
                      {[0,1,2,3,4].map(i => <div key={i} className="fe-bar-gridline" />)}
                    </div>
                    <div className="fe-bars">
                      {[
                        { label: 'price',     pct: 75 },
                        { label: 'area',      pct: 80 },
                        { label: 'bedrooms',  pct: 30 },
                        { label: 'bathrooms', pct: 99 },
                        { label: 'stories',   pct: 67 },
                        { label: 'parking',   pct: 52 },
                      ].map(col => (
                        <div key={col.label} className="fe-bar-group">
                          <div className="fe-bar-fill" style={{ height: `${col.pct}%`, background: '#f59e0b' }} />
                          <span className="fe-bar-xlabel fe-bar-xlabel--angled">{col.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="fe-bar-legend"><span className="fe-donut-dot" style={{ background: '#f59e0b' }} /> Skewness</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Missing Values tab ── */}
          {profileTab === 'missing' && (
            <div className="fe-profile-content">
              <div className="fe-overview-card fe-missing-empty">
                <CheckCircle2 size={48} color="#16a34a" />
                <h3>No Missing Values</h3>
                <p>Your dataset is complete with no missing data!</p>
              </div>
            </div>
          )}

          {/* ── Column Details tab ── */}
          {profileTab === 'columns' && (
            <div className="fe-profile-content">
              {profileData ? (
                <>
                  {/* Numeric */}
                  <div className="fe-overview-card" style={{ marginBottom: 16 }}>
                    <h3 className="fe-col-details-heading"><TrendingUp size={18} /> Numeric Columns ({profileData.types.numeric})</h3>
                    {profileData.column_details.filter(c => c.mean !== undefined).map(col => (
                      <div key={col.column} className="fe-col-detail-row">
                        <div className="fe-col-detail-name">
                          {col.column}
                          {col.outlier_percent !== undefined && col.outlier_percent > 0 && (
                            <span className="fe-outlier-badge">{col.outlier_percent.toFixed(1)}% outliers</span>
                          )}
                        </div>
                        <div className="fe-col-detail-stats">
                          <span><em>Range:</em> [{col.min?.toFixed(2)}, {col.max?.toFixed(2)}]</span>
                          <span><em>Mean:</em> {col.mean?.toFixed(2)}</span>
                          <span><em>Skew:</em> {col.skew?.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Categorical */}
                  <div className="fe-overview-card">
                    <h3 className="fe-col-details-heading"><Database size={18} /> Categorical Columns ({profileData.types.categorical})</h3>
                    {profileData.column_details.filter(c => c.mean === undefined).map(col => (
                      <div key={col.column} className="fe-col-detail-row">
                        <div className="fe-col-detail-name">{col.column}</div>
                        <div className="fe-col-detail-stats">
                          <span>{col.unique} unique</span>
                          {col.missing > 0 && <span><em>Missing:</em> {col.missing}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {/* Numeric */}
                  <div className="fe-overview-card" style={{ marginBottom: 16 }}>
                    <h3 className="fe-col-details-heading"><TrendingUp size={18} /> Numeric Columns (6)</h3>
                    {[
                      { name: 'price',     range: '[490000, 13300000]', mean: '4766729',  skew: '1.21' },
                      { name: 'area',      range: '[1650, 16200]',      mean: '5150.58',  skew: '1.32' },
                      { name: 'bedrooms',  range: '[1.00, 6.00]',       mean: '2.97',     skew: '0.50', outliers: '2.2%' },
                      { name: 'bathrooms', range: '[1.00, 4.00]',       mean: '1.29',     skew: '1.59', outliers: '0.2%' },
                      { name: 'stories',   range: '[1.00, 4.00]',       mean: '1.81',     skew: '1.08', outliers: '7.5%' },
                      { name: 'parking',   range: '[0.00, 3.00]',       mean: '0.69',     skew: '0.84', outliers: '2.2%' },
                    ].map(col => (
                      <div key={col.name} className="fe-col-detail-row">
                        <div className="fe-col-detail-name">
                          {col.name}
                          {col.outliers && <span className="fe-outlier-badge">{col.outliers} outliers</span>}
                        </div>
                        <div className="fe-col-detail-stats">
                          <span><em>Range:</em> {col.range}</span>
                          <span><em>Mean:</em> {col.mean}</span>
                          <span><em>Skew:</em> {col.skew}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Categorical */}
                  <div className="fe-overview-card">
                    <h3 className="fe-col-details-heading"><Database size={18} /> Categorical Columns (7)</h3>
                    {['mainroad','guestroom','basement','hotwaterheating','airconditioning','prefarea','furnishingstatus'].map((col, i) => (
                      <div key={col} className="fe-col-detail-row">
                        <div className="fe-col-detail-name">{col}</div>
                        <div className="fe-col-detail-stats">
                          <span>{i === 6 ? '3 unique' : '2 unique'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="fe-profile-footer">
            <button className="fe-back-step-btn" onClick={() => setActiveStep('dataset')}>
              <ChevronLeft size={14} /> Back to Select Dataset
            </button>
            <div className="fe-gen-chips">
              <span className="fe-gen-chip">Dataset: {selected ?? 'Housing.csv'}</span>
              <span className="fe-gen-chip">{profileData?.overview.rows ?? 545} rows</span>
              <span className="fe-gen-chip">{profileData?.overview.columns ?? 13} columns</span>
            </div>
            <button className="fe-next-btn" onClick={() => complete('profile')}>
              Continue to Data Quality <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Data Quality ── */}
      {activeStep === 'quality' && (
        <div className="xt-panel">
          <h2 className="xt-panel-title" style={{ textAlign: 'center' }}>Data Quality Improvement</h2>
          <p className="xt-panel-subtitle" style={{ textAlign: 'center', marginBottom: 28 }}>Review and approve AI-generated solutions for missing values, outliers, and duplicates</p>

          {/* Stat cards */}
          <div className="fe-dq-stat-row">
            <div className="fe-dq-stat-card">
              <span className="fe-dq-stat-label">Missing Values</span>
              <span className="fe-dq-stat-value">4</span>
            </div>
            <div className="fe-dq-stat-card">
              <span className="fe-dq-stat-label">Outliers</span>
              <span className="fe-dq-stat-value">8</span>
            </div>
            <div className="fe-dq-stat-card">
              <span className="fe-dq-stat-label">Duplicates</span>
              <span className="fe-dq-stat-value fe-dq-coming-soon">Coming Soon</span>
            </div>
          </div>

          {/* Quality Improvement Plan table */}
          <div className="fe-dq-plan">
            <div className="fe-dq-plan-header">
              <div>
                <h3 className="fe-dq-plan-title">Quality Improvement Plan ({dqSelected.size} selected)</h3>
                <p className="fe-dq-plan-sub">Review each suggestion and select which ones to apply. You can modify suggestions with custom prompts.</p>
              </div>
              <button className="fe-toggle-all-btn" onClick={() => {
                if (dqSelected.size === QUALITY_ROWS.length) setDqSelected(new Set());
                else setDqSelected(new Set(QUALITY_ROWS.map(r => r.id)));
              }}>
                {dqSelected.size === QUALITY_ROWS.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="fe-table-wrap">
              <table className="fe-table">
                <thead>
                  <tr>
                    <th style={{ width: 60, textAlign: 'center' }}>Select</th>
                    <th>Column</th>
                    <th style={{ width: 120 }}>Issue Type</th>
                    <th style={{ width: 130 }}>Fix</th>
                    <th>Reasoning</th>
                    <th style={{ width: 90, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {QUALITY_ROWS.map(row => (
                    <tr key={row.id} className={dqSelected.has(row.id) ? 'fe-dq-row-selected' : ''}
                      onClick={() => setDqSelected(prev => { const n = new Set(prev); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; })}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        {dqSelected.has(row.id)
                          ? <CheckSquare size={18} color="#fb8c36" />
                          : <Square size={18} color="#cbd5e1" />}
                      </td>
                      <td><span className="fe-col-name">{row.column}</span></td>
                      <td><span className={`fe-dq-badge fe-dq-badge--${row.type}`}>{row.type}</span></td>
                      <td><span className="fe-dq-fix">{row.fix}</span></td>
                      <td><span className="fe-reasoning">{row.reasoning}</span></td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div className="fe-dq-actions">
                          <button className="fe-edit-btn" title="View code"><Code size={14} /></button>
                          <button className="fe-edit-btn" title="Edit"><Edit2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Duplicate Handling placeholder */}
          <div className="fe-dq-duplicate-card">
            <h3 className="fe-dq-duplicate-title">
              <Info size={18} color="#3b82f6" />
              Duplicate Handling
            </h3>
            <p className="fe-dq-duplicate-sub">Duplicate detection and removal will be implemented in the next update</p>
            <p className="fe-dq-duplicate-coming">Coming soon: Intelligent duplicate detection and handling</p>
          </div>

          {/* Footer: Skip / Apply + bottom info bar */}
          <div className="fe-dq-footer">
            <button className="fe-dq-skip-btn" onClick={() => complete('quality')}>Skip Quality Fixes</button>
            <button className="fe-next-btn" onClick={() => complete('quality')}>
              Apply Selected Fixes ({dqSelected.size}) <ChevronRight size={16} />
            </button>
          </div>

          <div className="fe-dq-infobar">
            <button className="fe-back-step-btn" onClick={() => setActiveStep('profile')}>
              <ChevronLeft size={14} /> Back to Data Profile
            </button>
            <div className="fe-gen-chips">
              <span className="fe-gen-chip" style={{ maxWidth: 480 }}>{selected ?? 'Housing.csv'}</span>
              <span className="fe-gen-chip">545 rows</span>
              <span className="fe-gen-chip">13 columns</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: Feature Generation ── */}
      {activeStep === 'generation' && (
        <div className="xt-panel">
          {/* Panel header */}
          <div className="fe-gen-header">
            <div>
              <h2 className="xt-panel-title">AI-Powered Feature Engineering</h2>
              <p className="xt-panel-subtitle">Systematically generate, transform, and select features</p>
            </div>
            <button className="fe-skip-all-btn fe-skip-all-btn--primary" onClick={() => { setSelectedFeat(NEW_PREVIEW_COLS); complete('generation'); }}>
              Skip to Custom Transformations <ChevronRight size={15} />
            </button>
          </div>

          {/* Run Agent gate — shown before agent is started */}
          {!genStarted ? (
            <div className="fe-run-agent-gate">
              <div className="fe-run-agent-icon"><Sparkles size={36} /></div>
              <h3>Ready to Generate Features</h3>
              <p>Click below to run the AI agent. It will analyse your dataset and generate feature suggestions for all 5 stages.</p>
              <button className="fe-run-btn" onClick={() => {
                setGenStarted(true);
                setStageLoading(true);
                setTimeout(() => setStageLoading(false), 2400);
              }}>
                <Play size={16} /> Run Agent
              </button>
            </div>
          ) : stageLoading ? (
            <div className="fe-agent-loading">
              <div className="fe-agent-pulse">
                <Sparkles size={32} color="#fb8c36" />
              </div>
              <h3 className="fe-agent-loading-title">AI Agent Running…</h3>
              <p className="fe-agent-loading-sub">Analysing dataset schema and generating feature suggestions for <strong>{GEN_STAGES[stageIndex].title}</strong></p>
              <div className="fe-agent-dots"><span /><span /><span /></div>
            </div>
          ) : (
            <>
              {/* Progress bar */}
              <div className="fe-progress-wrap">
                <div className="fe-progress-row">
                  <span className="fe-progress-label">Progress</span>
                  <span className="fe-progress-stage">Stage {stageIndex + 1} of {GEN_STAGES.length}</span>
                </div>
                <div className="fe-progress-bar-track">
                  <div className="fe-progress-bar-fill" style={{ width: `${((stageIndex + 1) / GEN_STAGES.length) * 100}%` }} />
                </div>
              </div>

              {/* Stage cards */}
              <div className="fe-stage-cards">
                {GEN_STAGES.map((st, idx) => {
                  const StIcon = st.Icon;
                  const isActive = stageIndex === idx;
                  const isDone   = idx < stageIndex;
                  return (
                    <div key={st.id} className={`fe-stage-card${isActive ? ' active' : isDone ? ' done' : ''}`}>
                      <StIcon size={20} />
                      <span>{st.title}</span>
                    </div>
                  );
                })}
              </div>

              {/* Content card with left orange border */}
              <div className="fe-stage-content-card">
                {/* Stage header */}
                <div className="fe-stage-content-header">
                  <div className="fe-stage-content-icon">
                    {(() => { const StIcon = GEN_STAGES[stageIndex].Icon; return <StIcon size={22} />; })()}
                  </div>
                  <div>
                    <h3 className="fe-stage-title">{stageData[currentStageId].title}</h3>
                    <p className="fe-stage-content-sub">{stageData[currentStageId].desc}</p>
                  </div>
                </div>

                {/* Stage items */}
                {currentStageItems.length === 0 ? (
                  <div className="fe-gen-loading">
                    <span className="fe-spinner-dark" />
                    <span>AI is generating {GEN_STAGES[stageIndex].title.toLowerCase()} suggestions…</span>
                  </div>
                ) : (
                  <>
                    <div className="fe-gen-table-header">
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
                        AI Suggestions ({currentStageSelectedCount}/{currentStageItems.length} selected)
                      </span>
                      <button className="fe-toggle-all-btn" onClick={toggleAll}>
                        {currentStageItems.every(i => i.selected)
                          ? <><Square size={14} /> Deselect All</>
                          : <><CheckSquare size={14} /> Select All</>}
                      </button>
                    </div>
                    <div className="fe-table-wrap">
                      <table className="fe-table">
                        <thead>
                          <tr>
                            <th style={{ width: 60, textAlign: 'center' }}>Select</th>
                            <th>Feature Name</th>
                            <th>Description</th>
                            <th>Reasoning</th>
                            <th style={{ width: 80, textAlign: 'center' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentStageItems.map(row => (
                            <tr key={row.id} onClick={() => toggleItem(row.id)} style={{ cursor: 'pointer' }}
                              className={row.selected ? 'fe-dq-row-selected' : ''}>
                              <td style={{ textAlign: 'center' }}>
                                {row.selected
                                  ? <CheckSquare size={18} color="#fb8c36" />
                                  : <Square size={18} color="#cbd5e1" />}
                              </td>
                              <td><span className="fe-col-name">{row.name}</span></td>
                              <td><span className="fe-item-desc">{row.desc}</span></td>
                              <td><span className="fe-reasoning">{row.reasoning}</span></td>
                              <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                <div className="fe-dq-actions">
                                  <button className="fe-edit-btn"><Code size={14} /></button>
                                  <button className="fe-edit-btn"><Edit2 size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              {/* Stage footer */}
              <div className="fe-dq-footer" style={{ marginTop: 20 }}>
                <button className="fe-dq-skip-btn" onClick={applyAndNext}>Skip Stage</button>
                <button className="fe-next-btn" disabled={stageLoading} onClick={applyAndNext}>
                  <Play size={14} /> {stageIndex === GEN_STAGES.length - 1 ? 'Apply & Continue' : 'Apply & Next Stage'}
                </button>
              </div>

              {/* Bottom info bar */}
              <div className="fe-dq-infobar">
                <button className="fe-back-step-btn" onClick={() => {
                  if (stageIndex === 0) setActiveStep('quality');
                  else setStageIndex(stageIndex - 1);
                }}>
                  <ChevronLeft size={14} />
                  {stageIndex === 0 ? 'Back to Data Quality' : GEN_STAGES[stageIndex - 1].title}
                </button>
                <div className="fe-gen-chips">
                  <span className="fe-gen-chip" style={{ maxWidth: 480 }}>{selected ?? 'Housing.csv'}</span>
                  <span className="fe-gen-chip">10,234 rows</span>
                  <span className="fe-gen-chip">6 cols</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Step 5: Data Preview ── */}
      {activeStep === 'preview' && (
        <div className="xt-panel">
          {/* Title */}
          <h2 className="xt-panel-title" style={{ textAlign: 'center' }}>Data Preview &amp; Custom Transformations</h2>
          <p className="xt-panel-subtitle" style={{ textAlign: 'center', marginBottom: 24 }}>Review your transformed data and apply additional custom changes</p>

          {/* Transformations applied badges */}
          <div className="fe-preview-badges">
            <span className="fe-preview-badge-label">Transformations Applied:</span>
            <span className="fe-preview-badge"><CheckCircle2 size={13} /> Missing Values Fixed</span>
            <span className="fe-preview-badge"><CheckCircle2 size={13} /> Outliers Handled</span>
            <span className="fe-preview-badge"><CheckCircle2 size={13} /> Features Generated</span>
          </div>

          {/* Stat cards */}
          <div className="fe-dq-stat-row" style={{ marginTop: 20 }}>
            <div className="fe-dq-stat-card">
              <span className="fe-dq-stat-label">Total Rows</span>
              <span className="fe-dq-stat-value">10</span>
            </div>
            <div className="fe-dq-stat-card">
              <span className="fe-dq-stat-label">Total Columns</span>
              <span className="fe-dq-stat-value">11</span>
            </div>
            <div className="fe-dq-stat-card">
              <span className="fe-dq-stat-label">Custom Transformations</span>
              <span className="fe-dq-stat-value">0</span>
            </div>
          </div>

          {/* Current Data Preview table */}
          <div className="fe-preview-section">
            <h3 className="fe-preview-section-title"><Eye size={18} /> Current Data Preview</h3>
            <p className="fe-preview-section-sub">Showing first 20 rows of your transformed dataset</p>
            <div className="fe-table-wrap">
              <table className="fe-table fe-preview-table">
                <thead>
                  <tr>
                    {DPREVIEW_HEADERS.map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DPREVIEW_ROWS.map((row, i) => (
                    <tr key={i} className={row[0] === 'Total' ? 'fe-preview-total-row' : ''}>
                      {row.map((cell, j) => (
                        <td key={j} className={cell === 'null' ? 'fe-null-cell' : ''}>
                          {cell === 'null' ? <em>null</em> : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Custom Transformation */}
          <div className="fe-custom-transform">
            <h3 className="fe-preview-section-title"><Wand2 size={18} /> Custom Transformation</h3>
            <p className="fe-preview-section-sub">Describe any additional changes you&apos;d like to make to your data</p>
            <textarea
              className="fe-custom-transform-input"
              rows={4}
              placeholder="E.g., 'Create a new column that is the ratio of column A to column B' or 'Apply log transformation to all numeric columns with skewness > 1'"
              value={customTransform}
              onChange={e => setCustomTransform(e.target.value)}
            />
            <button className="fe-generate-formula-btn">
              <Send size={15} /> Generate Formula
            </button>
          </div>

          {/* Footer */}
          <div className="fe-step-footer" style={{ marginTop: 24 }}>
            <button className="fe-back-step-btn" onClick={() => setActiveStep('generation')}><ArrowLeft size={14} /> Back</button>
            <button className="fe-next-btn" onClick={() => complete('preview')}>Proceed to Export <ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* ── Step 6: Export ── */}
      {activeStep === 'export' && (
        <div className="xt-panel fe-export-panel">

          {/* Success hero */}
          <div className="fe-export-hero">
            <div className="fe-export-hero-icon">
              <CheckCircle2 size={40} color="white" strokeWidth={2.5} />
            </div>
            <h2 className="fe-export-hero-title">Feature Engineering Complete!</h2>
            <p className="fe-export-hero-sub">
              Your dataset has been successfully transformed with AI-powered feature engineering.<br />
              Download your enhanced dataset below.
            </p>
          </div>

          {/* Download formats */}
          <div className="fe-export-download-section">
            <h3 className="fe-export-section-title">Download Transformed Dataset</h3>
            <p className="fe-export-section-sub">Choose your preferred format to export the transformed dataset</p>
            <div className="fe-export-format-grid">
              {[
                { label: 'CSV Format',     desc: 'Compatible with Excel, Pandas, and most data tools',  btnLabel: 'Download CSV',     iconBg: '#dbeafe', iconColor: '#2563eb', Icon: FileText  },
                { label: 'JSON Format',    desc: 'Perfect for APIs and web applications',                btnLabel: 'Download JSON',    iconBg: '#dcfce7', iconColor: '#16a34a', Icon: FileDown  },
                { label: 'Parquet Format', desc: 'Optimized for big data and Apache Spark',             btnLabel: 'Download Parquet', iconBg: '#f3e8ff', iconColor: '#9333ea', Icon: Database  },
              ].map(fmt => (
                <div key={fmt.label} className="fe-export-fmt-card">
                  <div className="fe-export-fmt-icon" style={{ background: fmt.iconBg }}>
                    <fmt.Icon size={28} color={fmt.iconColor} />
                  </div>
                  <h4 className="fe-export-fmt-name">{fmt.label}</h4>
                  <p className="fe-export-fmt-desc">{fmt.desc}</p>
                  <button className="fe-export-dl-btn">
                    <Download size={15} /> {fmt.btnLabel}
                  </button>
                </div>
              ))}
            </div>
            <div className="fe-export-note">
              <CheckCircle2 size={15} color="#64748b" />
              All transformations, new features, and data quality improvements are preserved in the exported file.
            </div>
          </div>

          {/* Continue with Other Features */}
          <div className="fe-export-continue-section">
            <h3 className="fe-export-section-title">Continue with Other Features</h3>
            <p className="fe-export-section-sub" style={{ color: '#fb8c36' }}>Use your transformed dataset with other AI Studio features</p>
            <div className="fe-export-feature-grid">
              <div className="fe-export-feature-card">
                <div className="fe-export-feature-header">
                  <div className="fe-export-feature-icon" style={{ background: '#fb8c36' }}>
                    <Sparkles size={20} color="white" />
                  </div>
                  <div>
                    <h4 className="fe-export-feature-name">AutoML Training</h4>
                    <p className="fe-export-feature-tag">Build ML models</p>
                  </div>
                </div>
                <p className="fe-export-feature-desc">Train and compare multiple machine learning models on your transformed dataset.</p>
                <button className="fe-export-feature-btn fe-export-feature-btn--primary">
                  <ArrowRight size={15} /> Go to AutoML
                </button>
              </div>
              <div className="fe-export-feature-card">
                <div className="fe-export-feature-header">
                  <div className="fe-export-feature-icon" style={{ background: '#3b82f6' }}>
                    <Lock size={20} color="white" />
                  </div>
                  <div>
                    <h4 className="fe-export-feature-name">Data Anonymization</h4>
                    <p className="fe-export-feature-tag">Privacy protection</p>
                  </div>
                </div>
                <p className="fe-export-feature-desc">Anonymize your transformed dataset while preserving utility for analysis.</p>
                <button className="fe-export-feature-btn">
                  <ArrowRight size={15} /> Go to Anonymization
                </button>
              </div>
              <div className="fe-export-feature-card">
                <div className="fe-export-feature-header">
                  <div className="fe-export-feature-icon" style={{ background: '#16a34a' }}>
                    <BarChart2 size={20} color="white" />
                  </div>
                  <div>
                    <h4 className="fe-export-feature-name">Data Visualization</h4>
                    <p className="fe-export-feature-tag">Explore with charts</p>
                  </div>
                </div>
                <p className="fe-export-feature-desc">Create interactive visualizations and explore patterns in your data.</p>
                <button className="fe-export-feature-btn">
                  <ArrowRight size={15} /> Go to Visualization
                </button>
              </div>
            </div>
          </div>

          {/* Bottom info bar */}
          <div className="fe-dq-infobar">
            <button className="fe-back-step-btn" onClick={() => setActiveStep('preview')}>
              <ChevronLeft size={14} /> Back to Data Preview
            </button>
            <div className="fe-gen-chips">
              <span className="fe-gen-chip" style={{ maxWidth: 400 }}>{selected ?? 'Housing.csv'}</span>
              <span className="fe-gen-chip">545 rows</span>
              <span className="fe-gen-chip">13 columns</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeatureEngineeringPage;
