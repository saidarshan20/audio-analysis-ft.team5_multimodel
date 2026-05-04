import { useState } from 'react';
import { searchDocuments as searchDocumentsApi } from '../utils/ocrApi';

export const useSearch = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ document_id: string; filename: string; text_snippet: string; highlight: string; score: number; document_type?: string; page_count?: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const searchDocuments = async () => {
    const q = searchQuery.trim();
    if (!q || isSearching) return;
    setIsSearching(true);
    setSearchResults([]);

    try {
      const data = await searchDocumentsApi(q, 10);
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    searchOpen,
    setSearchOpen,
    searchDocuments,
  };
};
