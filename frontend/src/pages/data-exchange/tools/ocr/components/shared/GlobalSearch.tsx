import React from 'react';
import { Search, Loader2, FileText, ChevronDown as ChevDown } from 'lucide-react';

type GlobalSearchProps = {
  searchOpen: boolean;
  searchQuery: string;
  isSearching: boolean;
  searchResults: Array<{ document_id: string; filename: string; text_snippet: string; highlight: string; score: number; document_type?: string; page_count?: number }>;
  onToggleOpen: () => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
};

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  searchOpen,
  searchQuery,
  isSearching,
  searchResults,
  onToggleOpen,
  onQueryChange,
  onSearch,
}) => {
  return (
    <div className="xt-search-section">
      <button className="xt-search-bar-toggle" onClick={onToggleOpen}>
        <Search size={16} />
        <span>Search Across All Documents</span>
        <ChevDown size={14} className={searchOpen ? 'rotated' : ''} />
      </button>
      {searchOpen && (
        <div className="xt-search-panel">
          <div className="xt-search-input-row">
            <input
              className="xt-global-search-input"
              value={searchQuery}
              onChange={e => onQueryChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSearch(); }}
              placeholder="Search for text across all processed documents..."
            />
            <button className="xt-search-go" onClick={onSearch} disabled={isSearching || !searchQuery.trim()}>
              {isSearching ? <Loader2 size={16} className="xt-spin" /> : <Search size={16} />}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="xt-search-results">
              {searchResults.map((r, i) => (
                <div key={i} className="xt-search-result-card">
                  <div className="xt-search-result-header">
                    <span className="xt-search-result-filename"><FileText size={13} /> {r.filename}</span>
                    <span className="xt-search-result-score">{(r.score * 100).toFixed(0)}% match</span>
                  </div>
                  {r.document_type && <span className="xt-search-result-type">{r.document_type.toUpperCase()}</span>}
                  <p className="xt-search-result-highlight">{r.highlight || r.text_snippet.slice(0, 200)}</p>
                </div>
              ))}
            </div>
          )}
          {searchResults.length === 0 && !isSearching && searchQuery.trim() && (
            <div className="xt-search-empty">No results found. Try a different query.</div>
          )}
        </div>
      )}
    </div>
  );
};