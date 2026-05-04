import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Globe, ChevronRight, RefreshCw, Download, X } from 'lucide-react';
import { fetchDatasets, fetchDatasetForAnalysis, downloadDatasetCSV, DatasetEntry } from './services';

interface Props {
  /** Called when the user selects a dataset and fetches it to the backend */
  onSelect: (file: File, datasetName: string) => void;
}

const PAGE_SIZE = 30;

const SECTORS = [
  'All Sectors', 'Agriculture', 'Education', 'Finance', 'Health', 'Transport',
  'Environment', 'Energy', 'Science', 'Labour', 'Legal',
];

export const GovCatalogView = ({ onSelect }: Props) => {
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DatasetEntry | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchPct, setFetchPct] = useState(0);
  const [fetchMsg, setFetchMsg] = useState('');

  // ── Infinite scroll sentinel
  const observer = useRef<IntersectionObserver | null>(null);
  const lastRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) setOffset((prev) => prev + PAGE_SIZE);
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const load = async (q: string, sec: string, off: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchDatasets(q, off, PAGE_SIZE, sec);
      if (page.error) { setError(page.error); return; }
      setTotal(page.total);
      setDatasets((prev) => off === 0 ? page.results : [...prev, ...page.results]);
      setHasMore(off + PAGE_SIZE < page.total);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  // Reset on search/sector change
  useEffect(() => {
    setOffset(0);
    setDatasets([]);
    const t = setTimeout(() => load(search, sector, 0), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, sector]);

  // Load next page
  useEffect(() => {
    if (offset > 0) load(search, sector, offset);
  }, [offset]);

  const handleAnalyze = async (ds: DatasetEntry) => {
    if (!ds.id) { setError('This dataset has no resource ID to fetch.'); return; }
    setFetching(true);
    setFetchPct(0);
    setFetchMsg('Connecting to data.gov.in…');
    try {
      const result = await fetchDatasetForAnalysis(
        ds.id,
        ds.name,
        (e) => {
          setFetchPct(e.pct);
          setFetchMsg(`Fetching… ${e.rows_fetched.toLocaleString()} rows${e.total ? ` of ${e.total.toLocaleString()}` : ''}`);
        },
        50_000,
      );
      setFetchMsg(`Done! ${result.rows_fetched.toLocaleString()} rows saved.`);
      // Create a synthetic File pointing to the backend-saved CSV filename
      const fakeContent = `__backend_filename__:${result.filename}`;
      const file = new File([fakeContent], result.filename, { type: 'text/csv' });
      onSelect(file, ds.name);
    } catch (e: any) {
      setError(e.message ?? 'Fetch failed');
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="gc-root">
      <style>{`
        .gc-root{display:flex;flex-direction:column;gap:14px;height:420px}
        .gc-searchrow{display:flex;gap:10px;align-items:center}
        .gc-search-wrap{position:relative;flex:1}
        .gc-search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94a3b8;pointer-events:none}
        .gc-search{width:100%;padding:9px 12px 9px 36px;border-radius:10px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;background:#fff;box-sizing:border-box}
        .gc-search:focus{outline:none;border-color:#fb8c36;box-shadow:0 0 0 3px rgba(251,140,54,.1)}
        .gc-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;flex-shrink:0}
        .gc-chip{padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;cursor:pointer;white-space:nowrap;transition:all .15s}
        .gc-chip.active{background:#fff7ed;border-color:#fb8c36;color:#c2410c}
        .gc-meta{font-size:12px;color:#94a3b8}
        .gc-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:0}
        .gc-row{padding:12px 14px;border:1px solid #f1f5f9;border-radius:12px;background:#f8fafc;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all .15s}
        .gc-row:hover,.gc-row.selected{border-color:#fb8c36;background:#fff7ed}
        .gc-row-info{min-width:0;flex:1}
        .gc-row-name{font-size:13px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gc-row-meta{font-size:11px;color:#94a3b8;margin-top:2px}
        .gc-row-badge{font-size:10px;padding:3px 10px;border-radius:999px;background:#fff7ed;color:#fb8c36;border:1px solid rgba(251,140,54,.3);white-space:nowrap;flex-shrink:0;margin-left:10px}
        .gc-detail{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fff;margin-top:0}
        .gc-detail-name{font-weight:700;font-size:14px;color:#0f172a;margin-bottom:6px}
        .gc-detail-desc{font-size:12px;color:#64748b;line-height:1.6;margin-bottom:12px}
        .gc-detail-btns{display:flex;gap:8px}
        .gc-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;font-size:12px;font-weight:700;border:none;cursor:pointer;transition:all .15s}
        .gc-btn-primary{background:#fb8c36;color:#fff}
        .gc-btn-primary:hover{background:#e07328}
        .gc-btn-outline{background:#fff;color:#334155;border:1px solid #e2e8f0}
        .gc-btn-outline:hover{border-color:#fb8c36;color:#fb8c36}
        .gc-progress{height:6px;background:#f1f5f9;border-radius:999px;overflow:hidden;margin-top:10px}
        .gc-progress-bar{height:100%;background:#fb8c36;border-radius:999px;transition:width .3s}
        .gc-progress-label{font-size:12px;color:#64748b;margin-top:6px}
        .gc-error{color:#ef4444;font-size:12px;padding:8px 0}
        .gc-empty{text-align:center;padding:40px 0;color:#94a3b8;font-size:13px}
        .gc-skeleton{height:52px;background:#f1f5f9;border-radius:12px;animation:pulse 1.4s infinite}
        @keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}
      `}</style>

      {/* Search row */}
      <div className="gc-searchrow">
        <div className="gc-search-wrap">
          <Search className="gc-search-icon" size={14} />
          <input
            className="gc-search"
            placeholder="Search 277k+ Indian government datasets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <button className="gc-btn gc-btn-outline" style={{ padding: '8px 10px' }} onClick={() => setSearch('')}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Sector chips */}
      <div className="gc-chips">
        {SECTORS.map((s) => {
          const active = s === 'All Sectors' ? !sector : sector === s;
          return (
            <button
              key={s}
              className={`gc-chip${active ? ' active' : ''}`}
              onClick={() => { setSector(s === 'All Sectors' ? '' : (sector === s ? '' : s)); }}
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="gc-meta">
        {loading && datasets.length === 0
          ? 'Connecting to data.gov.in…'
          : error && datasets.length === 0
          ? <span className="gc-error">{error}</span>
          : `${total.toLocaleString()} datasets`}
      </div>

      {/* Dataset list */}
      <div className="gc-list">
        {datasets.length === 0 && loading
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="gc-skeleton" />)
          : datasets.length === 0 && !loading
          ? <div className="gc-empty">No datasets found. Try a different search.</div>
          : datasets.map((ds, i) => (
            <div
              key={`${ds.id ?? ds.name}-${i}`}
              ref={i === datasets.length - 1 ? lastRef : undefined}
              className={`gc-row${selected?.id === ds.id ? ' selected' : ''}`}
              onClick={() => setSelected(selected?.id === ds.id ? null : ds)}
            >
              <div className="gc-row-info">
                <div className="gc-row-name">{ds.name}</div>
                <div className="gc-row-meta">{ds.org} · Updated {ds.updated?.split('T')[0] ?? '—'}</div>
              </div>
              <span className="gc-row-badge">{ds.category}</span>
            </div>
          ))}
        {loading && datasets.length > 0 && (
          <div style={{ textAlign: 'center', padding: 12, fontSize: 12, color: '#94a3b8' }}>
            <RefreshCw size={14} className="spin" style={{ display: 'inline', marginRight: 6 }} /> Loading more…
          </div>
        )}
      </div>

      {/* Selected dataset detail panel */}
      {selected && (
        <div className="gc-detail">
          <div className="gc-detail-name">{selected.name}</div>
          <div className="gc-detail-desc">{selected.desc || 'No description available.'}</div>
          {fetching && (
            <>
              <div className="gc-progress">
                <div className="gc-progress-bar" style={{ width: `${fetchPct}%` }} />
              </div>
              <div className="gc-progress-label">{fetchMsg}</div>
            </>
          )}
          {error && <div className="gc-error">{error}</div>}
          {!fetching && (
            <div className="gc-detail-btns">
              <button className="gc-btn gc-btn-primary" onClick={() => handleAnalyze(selected)} disabled={!selected.id}>
                <ChevronRight size={14} /> Use for Anonymization
              </button>
              {selected.id && (
                <button className="gc-btn gc-btn-outline" onClick={() => downloadDatasetCSV(selected.id!, selected.name)}>
                  <Download size={14} /> Download CSV
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
