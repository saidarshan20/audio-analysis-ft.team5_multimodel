import { useState, useRef } from 'react';
import { ArrowLeft, BarChart2, Database, Upload, Search, Loader2, FileText, Code2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import './ToolPage.css';
import { analyzeTextFile, analyzeCodebase, TextAnalysisResult, CodeAnalysisResult } from './services';

type DatasetTab = 'catalog' | 'upload';

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
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState<string | null>(null);
  
  // -- Analysis State --
  const [loading, setLoading] = useState(false);
  const [textResult, setTextResult] = useState<TextAnalysisResult | null>(null);
  const [codeResult, setCodeResult] = useState<CodeAnalysisResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = DATASETS.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.desc.toLowerCase().includes(search.toLowerCase())
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setTextResult(null);
    setCodeResult(null);

    const isZip = file.name.toLowerCase().endsWith('.zip');
    const isDoc = file.name.toLowerCase().endsWith('.pdf') || file.name.toLowerCase().endsWith('.txt');

    try {
      if (isZip) {
        toast.loading('Analyzing codebase architecture...', { id: 'analysis' });
        const res = await analyzeCodebase(file);
        setCodeResult(res);
        toast.success('Code analysis complete!', { id: 'analysis' });
      } else if (isDoc) {
        toast.loading('Extracting insights from document...', { id: 'analysis' });
        const res = await analyzeTextFile(file);
        setTextResult(res);
        toast.success('Document analysis complete!', { id: 'analysis' });
      } else {
        toast.error('Unsupported file type. Please upload .txt, .pdf, or .zip', { id: 'analysis' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed', { id: 'analysis' });
    } finally {
      setLoading(false);
      // Reset input so the same file can be uploaded again
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
            {!textResult && !codeResult ? (
              <div className="xt-upload-zone" onClick={() => !loading && fileInputRef.current?.click()}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  accept=".txt,.pdf,.zip"
                />
                {loading ? (
                  <Loader2 size={36} className="animate-spin" color="#fb8c36" />
                ) : (
                  <Upload size={36} color="#fb8c36" />
                )}
                <p>{loading ? 'Processing through AI engine...' : 'Click or Drag files here to analyze'}</p>
                <div className="xt-file-chips">
                   <span className="chip"><FileText size={12}/> Document (.pdf, .txt)</span>
                   <span className="chip"><Code2 size={12}/> Codebase (.zip)</span>
                </div>
              </div>
            ) : (
              <div className="analysis-results">
                <div className="results-header">
                  <h3>Analysis Results</h3>
                  <button className="xt-upload-btn" onClick={() => { setTextResult(null); setCodeResult(null); }}>
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
                  <div className="result-card">
                    <div className="summary-section">
                      <h4><Code2 size={16} /> {codeResult.architecture.title}</h4>
                      <p>{codeResult.architecture.summary}</p>
                    </div>
                    <div className="components-grid">
                      {codeResult.architecture.components.map(c => (
                        <div key={c.id} className="comp-item">
                           <strong>{c.name}</strong>
                           <span>({c.type})</span>
                           <p>{c.description}</p>
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
      `}</style>
    </div>
  );
};

export default DataVizPage;
