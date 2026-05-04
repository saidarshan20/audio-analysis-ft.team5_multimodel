import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eye, FileImage, FileText, Lightbulb, ShieldCheck } from 'lucide-react';

const BASE_URL = 'http://127.0.0.1:8766/team4';
type TabType = 'structured' | 'unstructured' | 'image' | 'audio';

interface StructuredRow {
  columnName: string;
  dataType: string;
  sampleValue: string;
  llmPiiType: string;
  nerPiiType: string | null;
  sensitivity: string;
  risk: string;
}

interface StructuredResult {
  rows: StructuredRow[];
  totalColumns: number;
  totalRows: number | null;
}

interface ClassificationStageProps {
  structuredFile: File | null;
  unstructuredFile: File | null;
  imageFile?: File | null;
  audioFile?: File | null;
  policy: string;
  sampleData?: {
    id: string;
    kind: TabType;
    classification?: any;
  } | null;
  onComplete: (structuredRaw: unknown, unstructuredRaw: unknown, imageRaw: unknown, audioRaw: unknown) => void;
  onBack: () => void;
}

const upper = (value?: string | null) => (value ?? '').toUpperCase();
const titleCase = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

function piiColor(type: string) {
  const normalized = upper(type);
  if (normalized.includes('EMAIL')) return '#f59e0b';
  if (normalized.includes('PHONE')) return '#0ea5e9';
  if (normalized.includes('PERSON') || normalized.includes('NAME')) return '#ef4444';
  if (normalized.includes('SSN') || normalized.includes('CREDIT') || normalized.includes('BANK')) return '#8b5cf6';
  if (normalized === 'NONE') return '#cbd5e1';
  return '#fb8c36';
}

function getRiskColor(risk: string) {
  const r = upper(risk);
  if (r === 'HIGH') return '#ef4444';
  if (r === 'MEDIUM') return '#f59e0b';
  return '#22c55e';
}

function parseStructuredResult(data: any): StructuredResult {
  const result = data?.result ?? {};
  const columns: string[] = result['Column Name'] || [];
  const rows: StructuredRow[] = columns.map((col: string, index: number) => ({
    columnName: col ?? '',
    dataType: result['Data Types']?.[index] ?? '',
    sampleValue: result['Sample Value']?.[index] ?? '',
    llmPiiType: result['PII_Type_LLM']?.[index] ?? 'NONE',
    nerPiiType: result['PII_Type_NER']?.[index] ?? null,
    sensitivity: upper(result['Sensiivity']?.[index] ?? result['Sensitivity']?.[index] ?? 'PUBLIC'),
    risk: upper(result['Risk']?.[index] ?? 'LOW'),
  }));
  return { rows, totalColumns: rows.length, totalRows: data?.num_rows ?? null };
}

function SummaryCard({ title, value, helper }: { title: string; value: string | number; helper?: string }) {
  return (
    <div className="cls-card">
      <div className="cls-card-title">{title}</div>
      <div className="cls-card-value">{value}</div>
      {helper ? <div className="cls-card-helper">{helper}</div> : null}
    </div>
  );
}

function InsightCard({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="cls-panel">
      <div className="cls-heading"><Lightbulb size={16} /> AI Insight</div>
      <p className="cls-copy">{text}</p>
      <p className="cls-copy">{hint}</p>
    </div>
  );
}

function highlightText(text: string, entities: Array<{ start: number; end: number; entity: string }>) {
  if (!text) return <span className="cls-muted">Preview unavailable.</span>;
  if (!entities || entities.length === 0) return <span>{text}</span>;

  // Sort by start position to process linearly
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const ent of sorted) {
    if (ent.start < cursor) continue; // Skip overlaps
    if (ent.start >= text.length) break;

    // Add text before the match
    if (ent.start > cursor) {
      parts.push(text.slice(cursor, ent.start));
    }

    // Add the highlighted match
    const slice = text.slice(ent.start, Math.min(ent.end, text.length));
    parts.push(
      <span 
        key={`${ent.start}-${ent.end}`} 
        className="cls-highlight" 
        title={titleCase(ent.entity)} 
        style={{ ['--cls-color' as string]: piiColor(ent.entity) }}
      >
        {slice}
      </span>
    );
    cursor = ent.end;
  }

  // Add remaining text
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

function StructuredPanel({ file, raw, result }: { file: File; raw: any; result: StructuredResult }) {
  const preview = (raw?.raw_preview ?? []) as Record<string, unknown>[];
  const piiColumns = new Map(result.rows.filter((row) => upper(row.llmPiiType) !== 'NONE').map((row) => [row.columnName, row.llmPiiType]));
  const piiCount = result.rows.filter((row) => upper(row.llmPiiType) !== 'NONE').length;

  return (
    <div className="cls-stack">
      <div className="cls-file-line">File: <span>{file.name}</span></div>
      <div className="cls-metrics">
        <SummaryCard title="Rows" value={result.totalRows ?? preview.length} helper="Raw records previewed" />
        <SummaryCard title="PII Columns" value={piiCount} helper="Columns flagged for protection" />
        <SummaryCard title="Safe Columns" value={result.totalColumns - piiCount} helper="Columns without detected PII" />
        <SummaryCard title="Top Risk" value={result.rows.find((row) => row.risk === 'HIGH')?.columnName ?? 'None'} helper="Most urgent column" />
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><FileText size={16} /> Raw Data Preview</div>
          <div className="cls-table-wrap">
            <table className="cls-table">
              <thead><tr>{Object.keys(preview[0] ?? {}).map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {preview.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {Object.entries(row).map(([column, value]) => <td key={`${rowIndex}-${column}`}>{String(value ?? '') || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="cls-panel">
          <div className="cls-heading"><Eye size={16} /> Highlighted PII Preview</div>
          <div className="cls-table-wrap">
            <table className="cls-table">
              <thead><tr>{Object.keys(preview[0] ?? {}).map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {preview.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {Object.entries(row).map(([column, value]) => {
                      const piiType = piiColumns.get(column);
                      return <td key={`${rowIndex}-${column}`}>{piiType ? <span className="cls-highlight" title={titleCase(piiType)} style={{ ['--cls-color' as string]: piiColor(piiType) }}>{String(value ?? '') || '—'}</span> : String(value ?? '') || '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><ShieldCheck size={16} /> Column Classification</div>
          <div className="cls-list">
            {result.rows.map((row) => (
              <div key={row.columnName} className="cls-list-row">
                <div>
                  <div className="cls-strong">{row.columnName}</div>
                  <div className="cls-meta">{row.dataType || 'unknown'} · {titleCase(row.llmPiiType)}</div>
                </div>
                <span className="cls-pill" style={{ backgroundColor: `${getRiskColor(row.risk)}20`, color: getRiskColor(row.risk) }}>{titleCase(row.risk)}</span>
              </div>
            ))}
          </div>
        </div>
        <InsightCard text={raw?.ai_summary ?? 'No AI summary available.'} hint="Suggested next step: use stronger masking for high-risk identity or financial columns before export." />
      </div>
    </div>
  );
}

function UnstructuredPanel({ file, raw }: { file: File; raw: any }) {
  const rows = (raw?.results ?? []) as Array<{ line_number?: number; text_span?: string; llm_pii_type?: string; presidio_pii_type?: string; status?: string }>;
  const preview = String(raw?.preview ?? '');
  const entities = (raw?.raw_entities ?? []) as Array<{ start: number; end: number; entity: string }>;

  return (
    <div className="cls-stack">
      <div className="cls-file-line">File: <span>{file.name}</span></div>
      <div className="cls-metrics">
        <SummaryCard title="Lines Processed" value={raw?.lines_processed ?? 0} helper="Preview lines scanned" />
        <SummaryCard title="PII Candidates" value={raw?.pii_candidates_found ?? 0} helper="Suspicious spans detected" />
        <SummaryCard title="Confirmed PII" value={raw?.pii_confirmed ?? 0} helper="High-confidence matches" />
        <SummaryCard title="Risk Score" value={raw?.metrics?.risk_score ?? 0} helper={`Level: ${raw?.metrics?.risk_level ?? 'Low'}`} />
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><FileText size={16} /> Raw Text Preview</div>
          <div className="cls-text">{preview || 'Preview unavailable.'}</div>
        </div>
        <div className="cls-panel">
          <div className="cls-heading"><Eye size={16} /> Highlighted PII Preview</div>
          <div className="cls-text">{highlightText(preview, entities)}</div>
        </div>
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><ShieldCheck size={16} /> Entity Table</div>
          <div className="cls-table-wrap">
            <table className="cls-table">
              <thead><tr><th>Line</th><th>Span</th><th>Type</th><th>Engine</th><th>Status</th></tr></thead>
              <tbody>
                {rows.length > 0 ? rows.map((row, index) => (
                  <tr key={`${row.line_number}-${index}`}>
                    <td>{row.line_number ?? '—'}</td>
                    <td>{row.text_span ?? '—'}</td>
                    <td>{titleCase(row.llm_pii_type ?? 'Unknown')}</td>
                    <td>{row.presidio_pii_type ? 'NER' : 'Regex'}</td>
                    <td>{row.status ?? '—'}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="cls-muted">No PII candidates found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <InsightCard text={raw?.ai_summary ?? 'No AI summary available.'} hint="Suggested next step: mix stronger redaction for repeated high-risk entities with lighter masking where readability matters." />
      </div>
    </div>
  );
}

function ImagePanel({ file, raw }: { file: File; raw: any }) {
  const [url, setUrl] = useState('');
  const entities = (raw?.entities ?? []) as Array<{ entity_type: string; score: number; left: number; top: number; width: number; height: number }>;
  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return (
    <div className="cls-stack">
      <div className="cls-file-line">File: <span>{file.name}</span></div>
      <div className="cls-metrics">
        <SummaryCard title="Entities" value={entities.length} helper="OCR + vision detections" />
        <SummaryCard title="Risk Score" value={raw?.metrics?.risk_score ?? 0} helper={`Level: ${raw?.metrics?.risk_level ?? 'Low'}`} />
        <SummaryCard title="Top Entity" value={titleCase(raw?.metrics?.top_entity ?? 'None')} helper="Most repeated class" />
        <SummaryCard title="PII Density" value={raw?.metrics?.pii_density ?? 0} helper="Image-level density signal" />
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><FileImage size={16} /> Raw Image Preview</div>
          <div className="cls-image-wrap"><img src={url} alt={file.name} className="cls-image" /></div>
        </div>
        <div className="cls-panel">
          <div className="cls-heading"><Eye size={16} /> Highlighted PII Preview</div>
          <div className="cls-image-wrap">
            <img src={url} alt={`${file.name} highlighted`} className="cls-image" />
            {entities.map((entity, index) => (
              <div key={`${entity.entity_type}-${index}`} className="cls-box" title={`${titleCase(entity.entity_type)} ${(entity.score * 100).toFixed(0)}%`} style={{ left: entity.left, top: entity.top, width: entity.width, height: entity.height, borderColor: piiColor(entity.entity_type) }} />
            ))}
          </div>
        </div>
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><ShieldCheck size={16} /> Detection Table</div>
          <div className="cls-table-wrap">
            <table className="cls-table">
              <thead><tr><th>Type</th><th>Confidence</th><th>Position</th><th>Size</th></tr></thead>
              <tbody>
                {entities.length > 0 ? entities.map((entity, index) => (
                  <tr key={`${entity.entity_type}-${index}`}>
                    <td>{titleCase(entity.entity_type)}</td>
                    <td>{(entity.score * 100).toFixed(0)}%</td>
                    <td>{`${entity.left}, ${entity.top}`}</td>
                    <td>{`${entity.width}×${entity.height}`}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="cls-muted">No image entities found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <InsightCard text={raw?.ai_summary ?? 'No AI summary available.'} hint="Suggested next step: keep full redaction on identity-bearing regions and review any low-confidence detections before export." />
      </div>
    </div>
  );
}

function AudioPanel({ file, raw }: { file: File; raw: any }) {
  const [url, setUrl] = useState('');
  const entities = (raw?.entities ?? []) as Array<{ entity_type: string; value: string; score: number; start_time: number; end_time: number; start: number; end: number }>;
  const transcript = String(raw?.transcript || '');
  const transcriptMatches = entities.map(e => ({ start: e.start, end: e.end, entity: e.entity_type }));

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  
  return (
    <div className="cls-stack">
      <div className="cls-file-line">File: <span>{file.name}</span></div>
      <div className="cls-metrics">
        <SummaryCard title="Duration" value={`${(raw?.duration ?? 0).toFixed(1)}s`} helper="Total recognized speech" />
        <SummaryCard title="Entities" value={entities.length} helper="Voiced PII signatures" />
        <SummaryCard title="Risk Score" value={raw?.metrics?.risk_score ?? 0} helper={`Level: ${raw?.metrics?.risk_level ?? 'Low'}`} />
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading"><FileText size={16} /> Raw Audio Transcription</div>
          <div className="cls-text">{transcript || 'Transcription unavailable...'}</div>
        </div>
        <div className="cls-panel">
          <div className="cls-heading"><Eye size={16} /> Highlighted PII Transcript</div>
          <div className="cls-text">{highlightText(transcript, transcriptMatches)}</div>
        </div>
      </div>
      <div className="cls-grid-two">
        <div className="cls-panel">
          <div className="cls-heading">Audio Playback Preview</div>
          <div className="cls-image-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <audio controls src={url} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="cls-panel">
          <div className="cls-heading"><ShieldCheck size={16} /> Detection Table</div>
          <div className="cls-table-wrap">
            <table className="cls-table">
              <thead><tr><th>Type</th><th>Value</th><th>Time Window</th><th>Confidence</th></tr></thead>
              <tbody>
                {entities.length > 0 ? entities.map((entity, index) => (
                  <tr key={`${entity.entity_type}-${index}`}>
                    <td>{titleCase(entity.entity_type)}</td>
                    <td>{entity.value}</td>
                    <td>{`${entity.start_time.toFixed(1)}s – ${entity.end_time.toFixed(1)}s`}</td>
                    <td>{(entity.score * 100).toFixed(0)}%</td>
                  </tr>
                )) : <tr><td colSpan={4} className="cls-muted">No audio entities found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <InsightCard text={raw?.ai_summary ?? 'No AI summary available.'} hint="Suggested next step: apply Bleep or Silence techniques to precise timestamp locations to preserve context." />
    </div>
  );
}

export function ClassificationStage({ structuredFile, unstructuredFile, imageFile, audioFile, policy, sampleData, onComplete, onBack }: ClassificationStageProps) {
  const [activeTab, setActiveTab] = useState<TabType>(structuredFile ? 'structured' : audioFile ? 'audio' : imageFile ? 'image' : 'unstructured');
  const [structuredRaw, setStructuredRaw] = useState<any>(null);
  const [structuredResult, setStructuredResult] = useState<StructuredResult | null>(null);
  const [unstructuredRaw, setUnstructuredRaw] = useState<any>(null);
  const [imageRaw, setImageRaw] = useState<any>(null);
  const [audioRaw, setAudioRaw] = useState<any>(null);
  const [loading, setLoading] = useState<Record<TabType, boolean>>({ structured: false, unstructured: false, image: false, audio: false });
  const [errors, setErrors] = useState<Record<TabType, string | null>>({ structured: null, unstructured: null, image: null, audio: null });

  useEffect(() => {
    if (sampleData?.classification) {
      setStructuredRaw(sampleData.kind === 'structured' ? sampleData.classification : null);
      setStructuredResult(sampleData.kind === 'structured' ? parseStructuredResult(sampleData.classification) : null);
      setUnstructuredRaw(sampleData.kind === 'unstructured' ? sampleData.classification : null);
      setImageRaw(sampleData.kind === 'image' ? sampleData.classification : null);
      setAudioRaw(sampleData.kind === 'audio' ? sampleData.classification : null);
      setErrors({ structured: null, unstructured: null, image: null, audio: null });
      setLoading({ structured: false, unstructured: false, image: false, audio: false });
      setActiveTab(sampleData.kind);
      return;
    }

    const run = async (tab: TabType, file: File, path: string, onSuccess: (data: any) => void) => {
      setLoading((prev) => ({ ...prev, [tab]: true }));
      setErrors((prev) => ({ ...prev, [tab]: null }));
      try {
        const form = new FormData();
        form.append('file', file);
        const url = new URL(`${BASE_URL}${path}`);
        url.searchParams.set('policy', policy);

        const response = await fetch(url.toString(), { method: 'POST', body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail ?? `${titleCase(tab)} detection failed`);
        onSuccess(data);
      } catch (error) {
        setErrors((prev) => ({ ...prev, [tab]: error instanceof Error ? error.message : `${titleCase(tab)} detection failed` }));
      } finally {
        setLoading((prev) => ({ ...prev, [tab]: false }));
      }
    };
    if (structuredFile) run('structured', structuredFile, '/api/anonymization/pii-detection-structured', (data) => { setStructuredRaw(data); setStructuredResult(parseStructuredResult(data)); });
    if (unstructuredFile) run('unstructured', unstructuredFile, '/api/anonymization/pii-detection-unstructured', setUnstructuredRaw);
    if (imageFile) run('image', imageFile, '/api/anonymization/pii-detection-image', setImageRaw);
    if (audioFile) run('audio', audioFile, '/api/anonymization/pii-detection-audio', setAudioRaw);
  }, [structuredFile, unstructuredFile, imageFile, audioFile, policy, sampleData]);

  const showTabs = useMemo(() => [structuredFile, unstructuredFile, imageFile, audioFile].filter(Boolean).length > 1, [structuredFile, unstructuredFile, imageFile, audioFile]);
  const canProceed = Boolean(structuredRaw || unstructuredRaw || imageRaw || audioRaw);

  const renderTab = () => {
    if (activeTab === 'structured' && structuredFile) {
      if (loading.structured) return <div className="cls-panel cls-muted">Running structured classification...</div>;
      if (errors.structured) return <div className="cls-panel cls-muted">{errors.structured}</div>;
      if (structuredResult) return <StructuredPanel file={structuredFile} raw={structuredRaw} result={structuredResult} />;
    }
    if (activeTab === 'unstructured' && unstructuredFile) {
      if (loading.unstructured) return <div className="cls-panel cls-muted">Running unstructured classification...</div>;
      if (errors.unstructured) return <div className="cls-panel cls-muted">{errors.unstructured}</div>;
      if (unstructuredRaw) return <UnstructuredPanel file={unstructuredFile} raw={unstructuredRaw} />;
    }
    if (activeTab === 'image' && imageFile) {
      if (loading.image) return <div className="cls-panel cls-muted">Running image classification...</div>;
      if (errors.image) return <div className="cls-panel cls-muted">{errors.image}</div>;
      if (imageRaw) return <ImagePanel file={imageFile} raw={imageRaw} />;
    }
    if (activeTab === 'audio' && audioFile) {
      if (loading.audio) return <div className="cls-panel cls-muted">Running audio classification (transcribing)...</div>;
      if (errors.audio) return <div className="cls-panel cls-muted">{errors.audio}</div>;
      if (audioRaw) return <AudioPanel file={audioFile} raw={audioRaw} />;
    }
    return null;
  };

  return (
    <>
      <style>{`
        .cls-stack{display:flex;flex-direction:column;gap:18px;min-width:0}
        .cls-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
        .cls-grid-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
        .cls-panel,.cls-card{background:var(--bg-surface);border:1px solid var(--border-mid);border-radius:16px;padding:16px;min-width:0;color:var(--t-primary)}
        .cls-card-title{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--t-muted)}
        .cls-card-value{font-size:clamp(22px,2vw,28px);font-weight:800;color:var(--t-primary);margin-top:8px;overflow-wrap:anywhere;word-break:break-word}
        .cls-card-helper,.cls-copy,.cls-meta,.cls-file-line,.cls-muted{color:var(--t-secondary);font-size:13px;line-height:1.6}
        .cls-file-line span,.cls-strong,.cls-heading{color:var(--t-primary);overflow-wrap:anywhere}
        .cls-heading{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;margin-bottom:12px}
        .cls-table-wrap{overflow:auto;border:1px solid var(--border-mid);border-radius:14px;max-height:320px}
        .cls-table{width:100%;min-width:620px;border-collapse:collapse}
        .cls-table th{background:var(--bg-elevated);font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--t-secondary);padding:12px 14px;text-align:left}
        .cls-table td{padding:12px 14px;border-top:1px solid var(--border-dim);color:var(--t-primary);font-size:14px;vertical-align:top;overflow-wrap:anywhere}
        .cls-highlight{background:color-mix(in srgb,var(--cls-color) 18%,transparent);border-bottom:2px solid var(--cls-color);padding:1px 3px;border-radius:4px;cursor:help;color:var(--t-primary)}
        .cls-list{display:flex;flex-direction:column;gap:10px;max-height:320px;overflow:auto;padding-right:4px}
        .cls-list-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px;border:1px solid var(--border-mid);border-radius:12px;background:var(--bg-elevated);min-width:0}
        .cls-pill{display:inline-flex;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:800;text-transform:uppercase;white-space:nowrap}
        .cls-text{min-height:220px;max-height:280px;overflow:auto;white-space:pre-wrap;line-height:1.8;border:1px solid var(--border-mid);border-radius:14px;padding:16px;background:var(--bg-elevated);color:var(--t-primary);overflow-wrap:anywhere}
        .cls-image-wrap{position:relative;border:1px solid var(--border-mid);border-radius:14px;overflow:auto;background:var(--bg-elevated);min-height:240px;max-height:360px}
        .cls-image{display:block;max-width:100%;height:auto}.cls-box{position:absolute;border:2px solid #fb8c36;background:rgba(251,140,54,.08);box-sizing:border-box}
        .cls-tabs{display:flex;gap:10px;border-bottom:1px solid var(--border-mid);margin-bottom:18px}.cls-tab{background:transparent;border:none;border-bottom:2px solid transparent;padding:12px 4px;font-size:14px;font-weight:700;color:var(--t-secondary);cursor:pointer}.cls-tab.active{color:#fb8c36;border-bottom-color:#fb8c36}
        @media (max-width:1024px){.cls-metrics,.cls-grid-two{grid-template-columns:1fr}}
      `}</style>
      <div className="xt-panel fade-in">
        <h2 className="xt-panel-title">PII Detection & Classification</h2>
        <p className="xt-panel-subtitle">Each data type gets its own raw preview, highlighted PII preview, metrics, and AI suggestions.</p>
        {showTabs ? (
          <div className="cls-tabs">
            {structuredFile ? <button className={`cls-tab ${activeTab === 'structured' ? 'active' : ''}`} onClick={() => setActiveTab('structured')}>Structured</button> : null}
            {unstructuredFile ? <button className={`cls-tab ${activeTab === 'unstructured' ? 'active' : ''}`} onClick={() => setActiveTab('unstructured')}>Unstructured</button> : null}
            {imageFile ? <button className={`cls-tab ${activeTab === 'image' ? 'active' : ''}`} onClick={() => setActiveTab('image')}>Image</button> : null}
            {audioFile ? <button className={`cls-tab ${activeTab === 'audio' ? 'active' : ''}`} onClick={() => setActiveTab('audio')}>Audio</button> : null}
          </div>
        ) : null}
        {renderTab()}
        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <button className="xt-btn-outline" onClick={onBack}>Back</button>
          <button className="xt-upload-btn" onClick={() => onComplete(structuredRaw, unstructuredRaw, imageRaw, audioRaw)} disabled={!canProceed} style={{ opacity: canProceed ? 1 : 0.45, cursor: canProceed ? 'pointer' : 'not-allowed' }}>Configure Techniques →</button>
        </div>
      </div>
    </>
  );
}
