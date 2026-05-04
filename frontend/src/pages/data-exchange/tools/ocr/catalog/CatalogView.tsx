import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import DatasetDetailsHub from './DatasetDetailsHub';
import { DatasetEntry, FetchForAnalysisResult, fetchDatasets } from './services';

interface Props {
  onSelect?: (id: string) => void;
  onAnalyzeDataset?: (dataset: DatasetEntry, fetchResult?: FetchForAnalysisResult) => void;
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

  const listRef = useRef<HTMLDivElement | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(datasets.map((d) => d.category))).slice(0, 12),
    [datasets],
  );

  const loadDatasets = async (query: string, category: string, offset: number) => {
    setDatasetsLoading(true);
    setError(null);
    try {
      let page = await fetchDatasets(query, offset, PAGE_SIZE, category);
      const pageError = (page.error || '').trim();
      const looksLikeSilentUpstreamFailure =
        !query.trim() && !category.trim() && offset === 0 && page.total === 0 && page.results.length === 0;

      if ((pageError || looksLikeSilentUpstreamFailure) && offset === 0) {
        // Retry once for transient upstream timeouts before surfacing an error.
        await new Promise((resolve) => setTimeout(resolve, 600));
        page = await fetchDatasets(query, offset, PAGE_SIZE, category);
      }

      const retriedError = (page.error || '').trim();
      const stillNoDefaultData =
        !query.trim() && !category.trim() && offset === 0 && page.total === 0 && page.results.length === 0;
      if (retriedError || stillNoDefaultData) {
        setError(retriedError || 'Catalog source returned no data. Please retry in a few seconds.');
        return;
      }

      setDatasetsTotal(page.total);
      setDatasets((prev) => (offset === 0 ? page.results : [...prev, ...page.results]));
      setHasMore(offset + PAGE_SIZE < page.total);
    } catch (err: any) {
      setError(err?.message || 'Failed to connect to catalog server');
    } finally {
      setDatasetsLoading(false);
    }
  };

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (datasetsLoading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && hasMore) setDatasetsOffset((prev) => prev + PAGE_SIZE);
        },
        { root: listRef.current, rootMargin: '240px' },
      );
      if (node) observer.current.observe(node);
    },
    [datasetsLoading, hasMore],
  );

  useEffect(() => {
    if (search.trim()) setActiveCategory(null);
    setDatasetsOffset(0);
    const t = window.setTimeout(() => loadDatasets(search, activeCategory || '', 0), search ? 400 : 0);
    return () => window.clearTimeout(t);
  }, [search, activeCategory]);

  useEffect(() => {
    if (datasetsOffset > 0) loadDatasets(search, activeCategory || '', datasetsOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetsOffset]);

  return (
    <div className="xt-catalog-view" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
      <style>{`
        .xt-catalog-view{
          --xt-catalog-title: #1e293b;
          --xt-chip-bg: #f8fafc;
          --xt-chip-border: #e2e8f0;
          --xt-chip-text: #475569;
          --xt-chip-active-bg: rgba(251,140,54,0.12);
          --xt-chip-active-border: rgba(251,140,54,0.35);
          --xt-chip-active-text: #fb8c36;
          --xt-skeleton-main: #f1f5f9;
          --xt-skeleton-sub: #f8fafc;
          --xt-list-footnote: #94a3b8;
        }
        :root:not([data-theme="light"]) .xt-catalog-view{
          --xt-catalog-title: var(--t-primary, #eef1ff);
          --xt-chip-bg: rgba(255,255,255,0.06);
          --xt-chip-border: rgba(255,255,255,0.1);
          --xt-chip-text: var(--t-secondary, #9fb0ca);
          --xt-chip-active-bg: rgba(251,140,54,0.16);
          --xt-chip-active-border: rgba(251,140,54,0.5);
          --xt-chip-active-text: #fbbf5a;
          --xt-skeleton-main: rgba(255,255,255,0.1);
          --xt-skeleton-sub: rgba(255,255,255,0.07);
          --xt-list-footnote: var(--t-muted, #7e8ca8);
        }
        .xt-catalog-title{
          margin: 0 0 10px;
          font-size: 18px;
          color: var(--xt-catalog-title);
        }
        .xt-chip{
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          white-space: nowrap;
          cursor: pointer;
          background: var(--xt-chip-bg);
          border: 1px solid var(--xt-chip-border);
          color: var(--xt-chip-text);
        }
        .xt-chip[data-active="true"]{
          background: var(--xt-chip-active-bg);
          border-color: var(--xt-chip-active-border);
          color: var(--xt-chip-active-text);
        }
      `}</style>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="xt-catalog-title">Explore Dataset Catalog</h2>

        <div className="xt-search-wrap">
          <Search size={16} className="xt-search-icon" />
          <input
            className="xt-search-input"
            placeholder="Search datasets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '10px' }}>
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className="xt-chip"
            data-active={!activeCategory}
          >
            All Sectors
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setSearch('');
                setActiveCategory((prev) => (prev === cat ? null : cat));
              }}
              className="xt-chip"
              data-active={activeCategory === cat}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="xt-count">
          {datasetsLoading && datasets.length === 0
            ? 'Connecting to repository…'
            : error
              ? `Error: ${error}`
              : `${datasetsTotal.toLocaleString()} datasets`}
        </div>

        <div ref={listRef} className="xt-dataset-list" aria-label="Dataset list">
          {datasets.length === 0 && datasetsLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="xt-dataset-row" style={{ opacity: 0.6 }}>
                <div className="xt-dataset-info">
                  <span
                    className="xt-dataset-name"
                    style={{ background: 'var(--xt-skeleton-main)', borderRadius: '6px' }}
                  >
                    &nbsp;
                  </span>
                  <span
                    className="xt-dataset-desc"
                    style={{ background: 'var(--xt-skeleton-sub)', borderRadius: '6px' }}
                  >
                    &nbsp;
                  </span>
                </div>
                <span className="xt-dataset-badge" style={{ opacity: 0.5 }}>
                  &nbsp;
                </span>
              </div>
            ))
          ) : (
            datasets.map((d, i) => (
              <div
                key={`${d.id || d.name}-${i}`}
                ref={i === datasets.length - 1 ? lastElementRef : null}
                className={`xt-dataset-row${selected?.id === d.id && selected?.name === d.name ? ' selected' : ''}`}
                onClick={() => {
                  setSelected(d);
                  onSelect?.(d.id || d.name);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setSelected(d);
                    onSelect?.(d.id || d.name);
                  }
                }}
              >
                <div className="xt-dataset-info">
                  <span className="xt-dataset-name">{d.name}</span>
                  <span className="xt-dataset-desc">{d.desc || '—'}</span>
                </div>
                <span className="xt-dataset-badge">{d.category || 'General'}</span>
              </div>
            ))
          )}
        </div>

        {datasetsLoading && datasets.length > 0 && (
          <div style={{ textAlign: 'center', padding: '10px', color: 'var(--xt-list-footnote)', fontSize: '13px' }}>
            Loading more…
          </div>
        )}
        {!hasMore && datasets.length > 0 && (
          <div style={{ textAlign: 'center', padding: '10px', color: 'var(--xt-list-footnote)', fontSize: '12px' }}>
            — End of results —
          </div>
        )}
      </div>

      {selected && (
        <DatasetDetailsHub dataset={selected} onClose={() => setSelected(null)} onAnalyze={onAnalyzeDataset} />
      )}
    </div>
  );
};

export default CatalogView;
