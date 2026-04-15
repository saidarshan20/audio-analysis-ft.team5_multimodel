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
      <div className="xt-search-wrap">
        <Search size={15} className="xt-search-icon" />
        <input
          className="xt-search-input"
          placeholder="Search datasets by name, description, or tags..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <p className="xt-count">
        {datasetsLoading && datasets.length === 0
          ? 'Loading datasets…'
          : `Found ${datasetsTotal.toLocaleString()} datasets`}
      </p>
      <div className="xt-dataset-list">
        {datasetsLoading && datasets.length === 0
          ))
          : (
            <>
              {/* Pinned Demo Video (from video-analysis branch port) */}
              <div 
                className={`xt-dataset-row${selected === 'demo-video' ? ' selected' : ''}`}
                style={{ borderLeft: '4px solid #fb8c36', background: 'rgba(251, 140, 54, 0.05)' }}
                onClick={() => {
                  setSelected('demo-video');
                  onSelect?.('demo-video');
                }}
              >
                <div className="xt-dataset-info">
                  <span className="xt-dataset-name" style={{ color: '#fb8c36', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🎬 Pre-analyzed Demo Video (Huhu Sample)
                  </span>
                  <span className="xt-dataset-desc">
                    Experience full multimodal analysis immediately. Features YOLO object tracking, BLIP captioning, and CLIP scene descriptors from a test sample.
                  </span>
                </div>
                <span className="xt-dataset-badge" style={{ background: 'rgba(251, 140, 54, 0.15)', color: '#fb8c36' }}>Sample</span>
              </div>

              {datasets.map((d: DatasetEntry, i: number) => (
            <div
              key={`${d.name}-${i}`}
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
