import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { fetchDatasets, DatasetEntry } from '../services';

interface Props {
  onSelect?: (id: string) => void;
}

const CatalogView = ({ onSelect }: Props) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsTotal, setDatasetsTotal] = useState(0);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsOffset, setDatasetsOffset] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Derived categories from current dataset results
  const categories = Array.from(new Set(datasets.map(d => d.category))).slice(0, 8);

  const loadDatasets = async (query: string, offset: number) => {
    setDatasetsLoading(true);
    try {
      const page = await fetchDatasets(query, offset, 20);
      setDatasetsTotal(page.total);
      setDatasets(prev => offset === 0 ? page.results : [...prev, ...page.results]);
      setDatasetsOffset(offset);
    } catch {
      // silently keep existing results
    } finally {
      setDatasetsLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => loadDatasets(search, 0), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (datasets.length === 0) {
      loadDatasets('', 0);
    }
  }, []);

  return (
    <div className="view-animate-in">
      <h2 className="xt-panel-title">Explore Dataset Catalog</h2>
      <div className="xt-search-wrap" style={{ position: 'relative' }}>
        <Search size={15} className="xt-search-icon" />
        <input
          className="xt-search-input"
          placeholder="Search Central Gov datasets..."
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
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`xt-tab ${activeCategory === cat ? 'active' : ''}`}
            style={{ fontSize: '11px', padding: '4px 12px', whiteSpace: 'nowrap' }}
          >
            {cat}
          </button>
        ))}
      </div>

      <p className="xt-count">
        {datasetsLoading && datasets.length === 0
          ? 'Connecting to data.gov.in…'
          : `Found ${datasetsTotal.toLocaleString()} datasets in repository`}
      </p>
      <div className="xt-dataset-list">
        {datasetsLoading && datasets.length === 0
          ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="xt-dataset-row" style={{ opacity: 0.4, pointerEvents: 'none' }}>
              <div className="xt-dataset-info">
                <span className="xt-dataset-name" style={{ background: '#334155', borderRadius: 4, color: 'transparent', userSelect: 'none' }}>Loading dataset title placeholder</span>
                <span className="xt-dataset-desc" style={{ background: '#1e293b', borderRadius: 4, color: 'transparent', userSelect: 'none' }}>Loading description text here…</span>
              </div>
              <span className="xt-dataset-badge" style={{ background: '#334155', color: 'transparent' }}>Category</span>
            </div>
          ))
          : (
            <>
              {datasets
                .filter(d => !activeCategory || d.category === activeCategory)
                .map((d: DatasetEntry, i: number) => (
                <div
                  key={`${d.name}-${i}`}
                  className={`xt-dataset-row${selected === d.name ? ' selected' : ''}`}
                  onClick={() => {
                    setSelected(d.name);
                    onSelect?.(d.name);
                  }}
                >
                  <div className="xt-dataset-info">
                    <span className="xt-dataset-name">{d.name}</span>
                    <span className="xt-dataset-desc">{d.desc}</span>
                  </div>
                  <span className="xt-dataset-badge">{d.category}</span>
                </div>
              ))}
            </>
          )}
      </div>
      {datasets.length > 0 && datasets.length < datasetsTotal && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
          <button
            className="xt-tab"
            style={{ background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.2)', padding: '8px 24px', cursor: datasetsLoading ? 'not-allowed' : 'pointer', opacity: datasetsLoading ? 0.6 : 1 }}
            onClick={() => !datasetsLoading && loadDatasets(search, datasetsOffset + 20)}
            disabled={datasetsLoading}
          >
            {datasetsLoading ? 'Loading…' : `Load More (${datasets.length} / ${datasetsTotal.toLocaleString()})`}
          </button>
        </div>
      )}
    </div>
  );
};

export default CatalogView;
