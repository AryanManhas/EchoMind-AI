import { useState, useEffect } from 'react';
import { memoryService, Memory } from '../services/memoryService';

interface UseSemanticSearchResult {
  memories: Memory[];
  loading: boolean;
  error: string | null;
}

export function useSemanticSearch(
  query: string,
  limit: number = 5,
  debounceMs: number = 300
): UseSemanticSearchResult {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If query is empty, clear results and skip API call
    if (!query || query.trim().length === 0) {
      setMemories([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Set up debounce timer
    const handler = setTimeout(async () => {
      try {
        const results = await memoryService.searchSemanticMemories(query, limit);
        setMemories(results);
        setError(null);
      } catch (err: any) {
        setMemories([]);
        setError(err.message || 'An error occurred during semantic search.');
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    // Cancel the timeout if query changes before debounce timer finishes
    return () => {
      clearTimeout(handler);
    };
  }, [query, limit, debounceMs]);

  return { memories, loading, error };
}
