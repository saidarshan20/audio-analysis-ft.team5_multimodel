import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Database,
  Download,
  Layers,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Send,
  Table as TableIcon,
  X,
} from 'lucide-react';
import {
  chatAboutDataset,
  DatasetEntry,
  downloadDatasetCSV,
  FetchForAnalysisResult,
  fetchDatasetForAnalysis,
  fetchDatasetSample,
  FetchProgressEvent,
} from './services';

type TabId = 'overview' | 'preview' | 'ai';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const DatasetDetailsHub = ({
  dataset,
  onClose,
  onAnalyze,
}: {
  dataset: DatasetEntry;
  onClose: () => void;
  onAnalyze?: (dataset: DatasetEntry, fetchResult?: FetchForAnalysisResult) => void;
}) => {
  const [tab, setTab] = useState<TabId>('overview');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ records: any[]; field?: any[]; total?: number } | null>(null);
  const [previewLimit, setPreviewLimit] = useState(500);

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<FetchProgressEvent | null>(null);
  const [fetchResult, setFetchResult] = useState<{ filename: string; rows_fetched: number; truncated: boolean } | null>(
    null,
  );

  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const fields = dataset.fields ?? [];

  const updatedLabel = useMemo(() => {
    const raw = dataset.updated?.trim();
    if (!raw) return null;
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString();
    return raw;
  }, [dataset.updated]);

  useEffect(() => {
    setTab('overview');
    setIsFullscreen(false);
    setPreview(null);
    setPreviewError(null);
    setPreviewLimit(500);
    setChatMessages([]);
    setChatInput('');
    setChatError(null);
    setFetchProgress(null);
    setFetchResult(null);
    setFetchError(null);
    setFetching(false);
  }, [dataset.id, dataset.name]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const loadPreview = async (limit: number) => {
    if (!dataset.id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await fetchDatasetSample(dataset.id, limit);
      if (data?.error) {
        setPreviewError(String(data.error));
        setPreview(null);
      } else {
        setPreview(data);
      }
    } catch (e: any) {
      setPreviewError(e?.message || 'Failed to load preview');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'preview') return;
    if (preview || previewLoading) return;
    void loadPreview(previewLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const previewColumns = useMemo(() => {
    type Col = { key: string; label: string };

    if (preview?.field && Array.isArray(preview.field) && preview.field.length) {
      const cols: Col[] = preview.field
        .map((f: any) => {
          const key = typeof f?.id === 'string' && f.id.trim() ? f.id.trim() : null;
          const label = typeof f?.name === 'string' && f.name.trim() ? f.name.trim() : null;
          if (!key) return null;
          return { key, label: label ?? key };
        })
        .filter(Boolean) as Col[];

      if (cols.length) return cols.slice(0, 10);
    }

    const first = preview?.records?.[0];
    if (first && typeof first === 'object') {
      return Object.keys(first).slice(0, 10).map((k) => ({ key: k, label: k }));
    }

    return [] as Col[];
  }, [preview]);

  const startFetchForAnalysis = async () => {
    if (!dataset.id) {
      setFetchError('Dataset id is missing (cannot fetch full dataset).');
      return;
    }
    setFetching(true);
    setFetchError(null);
    setFetchProgress({ rows_fetched: 0, total: null, pct: 0 });
    setFetchResult(null);
    try {
      const result = await fetchDatasetForAnalysis(dataset.id, dataset.name, (e) => setFetchProgress(e));
      setFetchResult({ filename: result.filename, rows_fetched: result.rows_fetched, truncated: result.truncated });
      onAnalyze?.(dataset, result);
    } catch (e: any) {
      setFetchError(e?.message || 'Fetch failed');
    } finally {
      setFetching(false);
    }
  };

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q) return;
    setChatInput('');
    setChatError(null);
    setChatLoading(true);

    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: q }];
    setChatMessages(nextMessages);

    try {
      const history = nextMessages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const res = await chatAboutDataset(dataset.name, dataset.desc || '', fields, q, history);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (e: any) {
      setChatError(e?.message || 'Chat failed');
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <aside className={`xt-catalog-hub${isFullscreen ? ' fullscreen' : ''}`} aria-label="Dataset details">
      <style>{`
        .xt-catalog-hub{
          --xt-hub-bg: #ffffff;
          --xt-hub-fullscreen-bg: #ffffff;
          --xt-hub-border: #e2e8f0;
          --xt-hub-soft: #f8fafc;
          --xt-hub-soft-2: #f1f5f9;
          --xt-hub-chat-bg: #fbfdff;
          --xt-hub-text: #000000;
          --xt-hub-subtext: #64748b;
          --xt-hub-divider: #f1f5f9;
          --xt-hub-overlay: 0 24px 80px rgba(0,0,0,0.35);
          width: 440px;
          max-width: 45vw;
          background: var(--xt-hub-bg);
          border: 1px solid var(--xt-hub-border);
          border-radius: 12px;
          padding: 16px 16px 14px;
          position: sticky;
          top: 16px;
          color: var(--xt-hub-text);
        }
        :root:not([data-theme="light"]) .xt-catalog-hub{
          --xt-hub-bg: linear-gradient(165deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
          --xt-hub-fullscreen-bg: rgba(8, 12, 24, 0.98);
          --xt-hub-border: var(--border-mid, rgba(255, 255, 255, 0.1));
          --xt-hub-soft: rgba(255,255,255,0.06);
          --xt-hub-soft-2: rgba(255,255,255,0.05);
          --xt-hub-chat-bg: rgba(255,255,255,0.03);
          --xt-hub-text: var(--t-primary, #eef1ff);
          --xt-hub-subtext: var(--t-secondary, #9fb0ca);
          --xt-hub-divider: rgba(255,255,255,0.07);
          --xt-hub-overlay: 0 24px 80px rgba(0,0,0,0.55);
        }
        .xt-catalog-hub.fullscreen{
          position: fixed;
          inset: 68px 12px 12px;
          width: auto;
          max-width: none;
          z-index: 9999;
          border-radius: 14px;
          background: var(--xt-hub-fullscreen-bg);
          box-shadow: var(--xt-hub-overlay);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .xt-catalog-top{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          margin-bottom: 12px;
        }
        .xt-catalog-title{
          font-size: 14px;
          font-weight: 700;
          color: var(--xt-hub-text);
          line-height: 1.35;
          margin: 0;
        }
        .xt-catalog-actions{
          display:flex;
          align-items:center;
          gap: 8px;
          flex-shrink:0;
        }
        .xt-catalog-close{
          border: 1px solid var(--xt-hub-border);
          background: var(--xt-hub-bg);
          width: 32px;
          height: 32px;
          border-radius: 10px;
          display:flex;
          align-items:center;
          justify-content:center;
          cursor:pointer;
          flex-shrink:0;
        }
        .xt-catalog-close:hover{ border-color: #fb8c36; color: #fb8c36; }
        .xt-catalog-meta{
          display:flex;
          flex-wrap:wrap;
          gap: 8px;
          margin: 8px 0 0;
        }
        .xt-pill{
          display:inline-flex;
          align-items:center;
          gap:6px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--xt-hub-border);
          background: var(--xt-hub-soft);
          font-size: 12px;
          color: var(--xt-hub-text);
        }
        .xt-tabs{
          display:flex;
          gap:8px;
          background:var(--xt-hub-soft-2);
          border:1px solid var(--xt-hub-border);
          border-radius: 10px;
          padding: 6px;
          margin: 12px 0;
        }
        .xt-tabbtn{
          flex:1;
          padding: 9px 10px;
          border-radius: 8px;
          border: none;
          background: transparent;
          font-size: 12px;
          font-weight: 600;
          color: var(--xt-hub-subtext);
          cursor:pointer;
        }
        .xt-tabbtn.active{
          background:var(--xt-hub-bg);
          color:var(--xt-hub-text);
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .xt-section-title{
          display:flex;
          align-items:center;
          gap:8px;
          font-size: 13px;
          font-weight: 700;
          color:var(--xt-hub-text);
          margin: 12px 0 8px;
        }
        .xt-desc{
          font-size: 12px;
          color: var(--xt-hub-text);
          line-height: 1.55;
          margin: 0;
          max-height: 120px;
          overflow:auto;
        }
        .xt-actions{
          display:flex;
          gap: 10px;
          margin-top: 12px;
          flex-wrap:wrap;
        }
        .xt-btn{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--xt-hub-border);
          background: var(--xt-hub-bg);
          cursor:pointer;
          font-size: 12px;
          font-weight: 700;
          color:var(--xt-hub-text);
        }
        .xt-btn.primary{
          background: #fb8c36;
          border-color:#fb8c36;
          color:white;
        }
        .xt-btn:disabled{ opacity:0.6; cursor:not-allowed; }
        .xt-progress{
          margin-top: 10px;
          padding: 10px;
          border: 1px solid var(--xt-hub-border);
          border-radius: 10px;
          background: var(--xt-hub-soft);
        }
        .xt-progress-row{
          display:flex;
          align-items:center;
          justify-content:space-between;
          font-size:12px;
          color:var(--xt-hub-text);
          margin-bottom: 8px;
        }
        .xt-bar{
          height: 8px;
          width: 100%;
          border-radius: 999px;
          background: var(--xt-hub-border);
          overflow:hidden;
        }
        .xt-bar > div{
          height: 100%;
          background: #fb8c36;
          width: 0%;
        }
        .xt-tablewrap{
          border: 1px solid var(--xt-hub-border);
          border-radius: 10px;
          overflow:auto;
          max-height: 260px;
        }
        .xt-catalog-hub.fullscreen .xt-tablewrap{ max-height: none; }
        table.xt-table{
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .xt-table th, .xt-table td{
          border-bottom: 1px solid var(--xt-hub-divider);
          padding: 10px 10px;
          text-align: left;
          vertical-align: top;
          color: var(--xt-hub-text);
        }
        .xt-table th{ background: var(--xt-hub-soft); color:var(--xt-hub-text); position: sticky; top: 0; }
        .xt-muted{ color:var(--xt-hub-subtext); opacity: 0.9; font-size: 12px; }
        .xt-chat{
          border: 1px solid var(--xt-hub-border);
          border-radius: 12px;
          overflow:hidden;
        }
        .xt-chatlog{
          max-height: 300px;
          overflow:auto;
          padding: 12px;
          background: var(--xt-hub-chat-bg);
        }
        .xt-msg{
          padding: 10px 12px;
          border-radius: 12px;
          margin-bottom: 10px;
          font-size: 12px;
          line-height: 1.55;
          white-space: pre-wrap;
          color: var(--xt-hub-text);
        }
        .xt-msg.user{ background: rgba(251,140,54,0.12); border: 1px solid rgba(251,140,54,0.25); }
        .xt-msg.assistant{ background: var(--xt-hub-bg); border: 1px solid var(--xt-hub-border); }
        .xt-chatinput{
          display:flex;
          gap: 8px;
          padding: 10px;
          border-top: 1px solid var(--xt-hub-border);
          background: var(--xt-hub-bg);
        }
        .xt-chatinput input{
          flex:1;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--xt-hub-border);
          outline: none;
          font-size: 12px;
          color: var(--xt-hub-text);
          background: var(--xt-hub-soft);
        }
        .xt-chatinput input:focus{ border-color: #fb8c36; }
        .xt-send{
          width: 40px;
          border-radius: 10px;
          border: 1px solid #fb8c36;
          background: #fb8c36;
          color: white;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .xt-send:disabled{ opacity: 0.6; cursor:not-allowed; }
        .spin{ animation: xtspin 1s linear infinite; }
        @keyframes xtspin { to { transform: rotate(360deg); } }
        .xt-catalog-body{ }
        .xt-catalog-hub.fullscreen .xt-catalog-body{
          flex: 1;
          overflow: auto;
          padding-right: 2px;
        }
      `}</style>

      <div className="xt-catalog-top">
        <div style={{ minWidth: 0 }}>
          <h3 className="xt-catalog-title">{dataset.name}</h3>
          <div className="xt-catalog-meta">
            <span className="xt-pill">
              <Database size={14} /> {dataset.org || 'Government of India'}
            </span>
            <span className="xt-pill">
              <Layers size={14} /> {dataset.category || 'General'}
            </span>
            {updatedLabel && (
              <span className="xt-pill">
                <Calendar size={14} /> {updatedLabel}
              </span>
            )}
          </div>
        </div>
        <div className="xt-catalog-actions">
          <button
            className="xt-catalog-close"
            onClick={() => setIsFullscreen((v) => !v)}
            type="button"
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button className="xt-catalog-close" onClick={onClose} type="button" aria-label="Close details">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="xt-tabs" role="tablist" aria-label="Dataset tabs">
        <button type="button" className={`xt-tabbtn${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button type="button" className={`xt-tabbtn${tab === 'preview' ? ' active' : ''}`} onClick={() => setTab('preview')}>
          Preview
        </button>
        <button type="button" className={`xt-tabbtn${tab === 'ai' ? ' active' : ''}`} onClick={() => setTab('ai')}>
          Ask Document
        </button>
      </div>

      <div className="xt-catalog-body">
      {tab === 'overview' && (
        <>
          <div className="xt-section-title">
            <Layers size={16} /> Description
          </div>
          <p className="xt-desc">{dataset.desc || '—'}</p>

          <div className="xt-actions">
            <button
              type="button"
              className="xt-btn"
              onClick={() => {
                if (!dataset.id) return;
                downloadDatasetCSV(dataset.id, dataset.name);
              }}
              disabled={!dataset.id}
              title={!dataset.id ? 'Missing dataset id' : 'Download as CSV'}
            >
              <Download size={16} /> Download CSV
            </button>
            <button type="button" className="xt-btn primary" onClick={startFetchForAnalysis} disabled={!dataset.id || fetching}>
              {fetching ? <Loader2 size={16} className="spin" /> : <Database size={16} />} Fetch for analysis
            </button>
          </div>

          {fetchError && <div className="xt-muted" style={{ color: '#b91c1c', marginTop: '10px' }}>{fetchError}</div>}

          {(fetchProgress || fetchResult) && (
            <div className="xt-progress">
              <div className="xt-progress-row">
                <span>
                  {fetchResult
                    ? `Saved: ${fetchResult.filename}`
                    : `Fetched: ${fetchProgress?.rows_fetched.toLocaleString() ?? 0} rows`}
                </span>
                <span>{fetchResult ? 'Complete' : `${fetchProgress?.pct ?? 0}%`}</span>
              </div>
              <div className="xt-bar" aria-label="Fetch progress">
                <div style={{ width: `${fetchResult ? 100 : fetchProgress?.pct ?? 0}%` }} />
              </div>
              {fetchResult?.truncated && (
                <div className="xt-muted" style={{ marginTop: '8px' }}>
                  Download capped for performance; use data.gov.in for full exports.
                </div>
              )}
            </div>
          )}

          <div className="xt-section-title">
            <TableIcon size={16} /> Schema {fields.length ? `(${fields.length})` : ''}
          </div>
          {fields.length ? (
            <div className="xt-tablewrap">
              <table className="xt-table">
                <thead>
                  <tr>
                    <th style={{ width: '62%' }}>Column</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.slice(0, 40).map((f, i) => (
                    <tr key={`${f.name}-${i}`}>
                      <td style={{ fontWeight: 700, color: 'var(--xt-hub-text)' }}>{f.name}</td>
                      <td style={{ color: 'var(--xt-hub-text)', opacity: 0.8 }}>{f.type ?? 'unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="xt-muted">No schema metadata provided by the catalog listing.</div>
          )}
        </>
      )}

      {tab === 'preview' && (
        <>
          <div className="xt-section-title" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TableIcon size={16} /> Sample rows
              {preview?.records?.length ? (
                <span className="xt-muted">({preview.records.length.toLocaleString()} shown)</span>
              ) : null}
            </span>
            <label className="xt-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Rows
              <select
                value={previewLimit}
                onChange={(e) => {
                  const next = Number(e.target.value) || 500;
                  setPreviewLimit(next);
                  setPreview(null);
                  if (dataset.id) void loadPreview(next);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--xt-hub-border)',
                  background: 'var(--xt-hub-bg)',
                  color: 'var(--xt-hub-text)',
                  fontSize: 12,
                }}
              >
                <option value={100}>100</option>
                <option value={500}>500</option>
                <option value={2000}>2000</option>
              </select>
            </label>
          </div>
          {!dataset.id ? (
            <div className="xt-muted">No dataset id available for preview.</div>
          ) : previewLoading ? (
            <div className="xt-muted" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Loader2 size={16} /> Loading preview…
            </div>
          ) : previewError ? (
            <div className="xt-muted" style={{ color: '#b91c1c' }}>
              {previewError}
            </div>
          ) : preview?.records?.length ? (
            <div className="xt-tablewrap">
              <table className="xt-table">
                <thead>
                  <tr>
                    {previewColumns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.records.map((r: any, idx: number) => (
                    <tr key={idx}>
                      {previewColumns.map((c) => (
                        <td key={c.key}>{String(r?.[c.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="xt-muted">No preview data returned.</div>
          )}
        </>
      )}

      {tab === 'ai' && (
        <>
          <div className="xt-section-title">
            <MessageSquare size={16} /> Ask about this dataset
          </div>
          <div className="xt-chat">
            <div className="xt-chatlog">
              {chatMessages.length === 0 ? (
                <div className="xt-muted">
                  Ask a question about coverage, time period, data quality, or how to use columns in analysis.
                </div>
              ) : (
                chatMessages.map((m, i) => (
                  <div key={i} className={`xt-msg ${m.role}`}>
                    {m.content}
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="xt-muted" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                  <Loader2 size={16} /> Thinking…
                </div>
              )}
              {chatError && <div className="xt-muted" style={{ color: '#b91c1c', marginTop: '8px' }}>{chatError}</div>}
            </div>
            <div className="xt-chatinput">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a question…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendChat();
                }}
              />
              <button className="xt-send" onClick={() => void sendChat()} disabled={chatLoading || !chatInput.trim()} aria-label="Send">
                {chatLoading ? <Loader2 size={16} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </aside>
  );
};

export default DatasetDetailsHub;
