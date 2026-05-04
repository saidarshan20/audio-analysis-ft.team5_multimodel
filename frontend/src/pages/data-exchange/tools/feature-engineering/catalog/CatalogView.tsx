import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { fetchDatasets, DatasetEntry } from './services';
import DatasetDetailsHub from './DatasetDetailsHub';

interface Props {
  /** Called when a dataset is selected — useful for integrating with other views */
   onSelect?: (id: string) => void;
  /** Called when "Analyze Full Dataset" is clicked in the hub */
  onAnalyzeDataset?: (dataset: DatasetEntry) => void;
}

const PAGE_SIZE = 50;

const CatalogView = ({ onAnalyzeDataset }: Props) => {
  const [search,          setSearch]          = useState('');
  const [selected,        setSelected]        = useState<DatasetEntry | null>(null);
  const [datasets,        setDatasets]        = useState<DatasetEntry[]>([]);
  const [datasetsTotal,   setDatasetsTotal]   = useState(0);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsOffset,  setDatasetsOffset]  = useState(0);
  const [activeCategory,  setActiveCategory]  = useState<string | null>(null);
  const [hasMore,         setHasMore]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);

  // ── Infinite scroll ──────────────────────────────────────
  const observer = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback((node: HTMLDivElement) => {
    if (datasetsLoading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setDatasetsOffset(prev => prev + PAGE_SIZE);
      }
    });
    if (node) observer.current.observe(node);
  }, [datasetsLoading, hasMore]);

  // Derive category chips from currently loaded results
  const categories = Array.from(new Set(datasets.map(d => d.category))).slice(0, 10);

  const loadDatasets = async (query: string, category: string, offset: number) => {
    setDatasetsLoading(true);
    setError(null);
    try {
      const page = await fetchDatasets(query, offset, PAGE_SIZE, category);
      if (page.error) { setError(page.error); return; }
      setDatasetsTotal(page.total);
      setDatasets(prev => offset === 0 ? page.results : [...prev, ...page.results]);
      setHasMore(offset + PAGE_SIZE < page.total);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to repository server');
    } finally {
      setDatasetsLoading(false);
    }
  };

  // Reset + reload when search or sector changes (400ms debounce on search)
  useEffect(() => {
    if (search.trim()) setActiveCategory(null);
    setDatasetsOffset(0);
    const t = setTimeout(() => loadDatasets(search, activeCategory || '', 0), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, activeCategory]);

  // Load next page on scroll
  useEffect(() => {
    if (datasetsOffset > 0) loadDatasets(search, activeCategory || '', datasetsOffset);
  }, [datasetsOffset]);

  return (
    <div style={{ display: 'flex', gap: '20px', position: 'relative', minHeight: '600px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2>Explore Dataset Catalog</h2>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            placeholder="Search datasets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '36px', paddingRight: search ? '40px' : '12px', padding: '10px 40px 10px 36px', borderRadius: '8px', background: 'var(--surface-soft)', border: '1px solid var(--border-color)', color: 'var(--text-color)', fontSize: '14px', boxSizing: 'border-box' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
          )}
        </div>

        {/* Sector chips */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '10px', scrollbarWidth: 'none' }}>
          {['All Sectors', ...categories].map(cat => (
            <button
              key={cat}
              onClick={() => {
                if (cat === 'All Sectors') { setActiveCategory(null); }
                else { setSearch(''); setActiveCategory(activeCategory === cat ? null : cat); }
              }}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '11px', whiteSpace: 'nowrap', cursor: 'pointer',
                background: (cat === 'All Sectors' ? !activeCategory : activeCategory === cat) ? 'rgba(251,140,54,0.2)' : 'var(--surface-muted)',
                color:      (cat === 'All Sectors' ? !activeCategory : activeCategory === cat) ? '#fb8c36' : 'var(--text-muted)',
                border:     (cat === 'All Sectors' ? !activeCategory : activeCategory === cat) ? '1px solid rgba(251,140,54,0.4)' : '1px solid var(--border-color)',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {datasetsLoading && datasets.length === 0
            ? 'Connecting to repository…'
            : error
              ? `Error: ${error}`
              : `${datasetsTotal.toLocaleString()} datasets`}
        </p>

        {/* Dataset list */}
        <div>
          {datasets.length === 0 && datasetsLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ padding: '16px', marginBottom: '8px', background: 'var(--surface)', borderRadius: '8px', opacity: 0.6 }}>
                  <div style={{ width: '60%', height: '14px', background: 'var(--border-color)', borderRadius: '4px', marginBottom: '8px' }} />
                  <div style={{ width: '80%', height: '10px', background: 'var(--surface-muted)', borderRadius: '4px' }} />
                </div>
              ))
            : datasets.map((d, i) => (
                <div
                  key={`${d.name}-${i}`}
                  ref={i === datasets.length - 1 ? lastElementRef : null}
                  onClick={() => { setSelected(d); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 16px', marginBottom: '6px', borderRadius: '8px', cursor: 'pointer',
                    background: selected?.name === d.name ? 'rgba(251,140,54,0.08)' : 'var(--surface)',
                    border: `1px solid ${selected?.name === d.name ? 'rgba(251,140,54,0.3)' : 'var(--border-color)'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-color)', marginBottom: '4px' }}>{d.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '500px' }}>{d.desc}</div>
                  </div>
                  <span style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '20px', background: 'rgba(251,140,54,0.1)', color: '#fb8c36', border: '1px solid rgba(251,140,54,0.2)', whiteSpace: 'nowrap', marginLeft: '12px', flexShrink: 0 }}>
                    {d.category}
                  </span>
                </div>
              ))
          }
          {datasetsLoading && datasets.length > 0 && (
            <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Loading more…
            </div>
          )}
        </div>
        {!hasMore && datasets.length > 0 && (
          <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', marginTop: '16px' }}>— End of results —</p>
        )}
      </div>

      {/* Side panel */}
      {selected && (
        <DatasetDetailsHub
          dataset={selected}
          onClose={() => setSelected(null)}
          onAnalyze={onAnalyzeDataset}
        />
      )}
    </div>
  );
};

export default CatalogView;