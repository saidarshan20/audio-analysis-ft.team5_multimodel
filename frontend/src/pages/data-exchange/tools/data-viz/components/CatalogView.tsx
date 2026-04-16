import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { fetchDatasets, DatasetEntry } from '../services';
import DatasetDetailsHub from './DatasetDetailsHub';

interface Props {
  onSelect?: (id: string) => void;
  onAnalyzeDataset?: (dataset: DatasetEntry) => void;
}

const PAGE_SIZE = 50;

const CatalogView = ({ onSelect, onAnalyzeDataset }: Props) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DatasetEntry | null>(null);
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsTotal, setDatasetsTotal] = useState(0);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsOffset, setDatasetsOffset] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For infinite scroll
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

  // Derived categories from current dataset results (for chips)
  const categories = Array.from(new Set(datasets.map(d => d.category))).slice(0, 10);

  const loadDatasets = async (query: string, category: string, offset: number) => {
    setDatasetsLoading(true);
    setError(null);
    try {
      const page = await fetchDatasets(query, offset, PAGE_SIZE, category);
      if (page.error) {
        setError(page.error);
        return;
      }
      setDatasetsTotal(page.total);
      setDatasets(prev => offset === 0 ? page.results : [...prev, ...page.results]);
      setHasMore(offset + PAGE_SIZE < page.total);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to repository server');
    } finally {
      setDatasetsLoading(false);
    }
  };

  // Effect: When search or activeCategory changes, reset and load
  useEffect(() => {
    // Global search logic: clear category if searching
    if (search.trim()) {
      setActiveCategory(null);
    }
    
    setDatasetsOffset(0);
    const t = setTimeout(() => {
      loadDatasets(search, activeCategory || '', 0);
    }, search ? 400 : 0);
    
    return () => clearTimeout(t);
  }, [search, activeCategory]);

  // Effect: When offset changes (Infinite scroll trigger)
  useEffect(() => {
    if (datasetsOffset > 0) {
      loadDatasets(search, activeCategory || '', datasetsOffset);
    }
  }, [datasetsOffset]);

  return (
    <div className="view-animate-in" style={{ display: 'flex', gap: '20px', position: 'relative', minHeight: '600px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="xt-panel-title">Explore Dataset Catalog</h2>
        
        {/* Search Bar */}
        <div className="xt-search-wrap" style={{ position: 'relative' }}>
          <Search size={15} className="xt-search-icon" />
          <input
            className="xt-search-input"
            placeholder="Search items globally across the repository..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingRight: '40px' }}
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '16px' }}
            >
              ✕
            </button>
          )}
          {datasetsLoading && (
            <div style={{ position: 'absolute', right: search ? '36px' : '12px', top: '50%', transform: 'translateY(-50%)' }}>
              <div className="animate-spin" style={{ width: '12px', height: '12px', border: '2px solid rgba(251,140,54,0.2)', borderTop: '2px solid #fb8c36', borderRadius: '50%' }} />
            </div>
          )}
        </div>

        {/* Category Filter Chips */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '10px 0', marginBottom: '10px', scrollbarWidth: 'none' }}>
          <button 
            onClick={() => setActiveCategory(null)}
            className={`xt-tab ${!activeCategory ? 'active' : ''}`}
            style={{ fontSize: '11px', padding: '4px 12px', whiteSpace: 'nowrap' }}
          >
            All Sectors
          </button>
          {categories.map(cat => (
            <button 
              key={cat}
              onClick={() => {
                setSearch(''); // Ensure search is cleared when using sector filter
                setActiveCategory(activeCategory === cat ? null : cat);
              }}
              className={`xt-tab ${activeCategory === cat ? 'active' : ''}`}
              style={{ fontSize: '11px', padding: '4px 12px', whiteSpace: 'nowrap' }}
            >
              {cat}
            </button>
          ))}
        </div>

        <p className="xt-count">
          {datasetsLoading && datasets.length === 0
            ? 'Connecting to repository…'
            : error 
              ? `Connection error: ${error}`
              : `Found ${datasetsTotal.toLocaleString()} datasets`}
        </p>

        {error && datasets.length === 0 && (
          <div className="hub-empty" style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <p style={{ color: '#ef4444' }}>{error}</p>
            <button className="xt-tab active" onClick={() => loadDatasets(search, activeCategory || '', 0)}>
              Retry Connection
            </button>
          </div>
        )}

        <div className="xt-dataset-list">
          {datasets.length === 0 && datasetsLoading ? (
            /* Initial Loading Skeltons with Shimmer */
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="xt-dataset-row shimmer" style={{ opacity: 0.6, pointerEvents: 'none', background: 'rgba(30, 41, 59, 0.4)' }}>
                <div className="xt-dataset-info">
                  <div style={{ width: '240px', height: '14px', background: '#334155', borderRadius: 4, marginBottom: '8px' }} />
                  <div style={{ width: '380px', height: '10px', background: '#1e293b', borderRadius: 4 }} />
                </div>
                <div style={{ width: '80px', height: '18px', background: '#334155', borderRadius: '10px' }} />
              </div>
            ))
          ) : (
            <>
              {datasets.map((d: DatasetEntry, i: number) => (
                <div
                  key={`${d.name}-${i}`}
                  ref={i === datasets.length - 1 ? lastElementRef : null}
                  className={`xt-dataset-row${selected?.name === d.name ? ' selected' : ''}`}
                  onClick={() => {
                    setSelected(d);
                    onSelect?.(d.id || d.name);
                  }}
                >
                  <div className="xt-dataset-info">
                    <span className="xt-dataset-name">{d.name}</span>
                    <span className="xt-dataset-desc">{d.desc}</span>
                  </div>
                  <span className="xt-dataset-badge">{d.category}</span>
                </div>
              ))}
              
              {datasetsLoading && datasets.length > 0 && (
                /* Load More Spinner/Shimmer */
                <div style={{ padding: '20px', textAlign: 'center', opacity: 0.6 }}>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>Loading more records...</span>
                </div>
              )}
            </>
          )}
        </div>

        {!hasMore && datasets.length > 0 && (
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#475569', marginTop: '20px' }}>
            — End of results —
          </p>
        )}
      </div>

      {/* Dataset Details Hub (Side Panel) */}
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
