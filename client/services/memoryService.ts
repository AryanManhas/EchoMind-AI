const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export interface Memory {
  id: string;
  title: string;
  summary: string;
  category: string;
  importance: number;
  rawTranscript: string;
  createdAt: string;
  similarity?: number;
}

export const memoryService = {
  /**
   * Fetches all memories, optionally filtered by a query string and category.
   * @param q Optional search query
   * @param category Optional category filter
   * @returns Array of memories
   */
  async fetchAllMemories(q?: string, category?: string): Promise<Memory[]> {
    try {
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (category && category !== 'All') params.append('category', category);

      const url = `${API_BASE_URL}/memories${params.toString() ? `?${params.toString()}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch memories: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.memories || [];
    } catch (error) {
      console.error('Error fetching all memories:', error);
      throw error;
    }
  },

  /**
   * Performs a semantic search for memories using vector embeddings.
   * @param queryText The search query to embed and compare
   * @param limit Maximum number of results to return (default: 5)
   * @returns Array of semantically similar memories
   */
  async searchSemanticMemories(queryText: string, limit: number = 5): Promise<Memory[]> {
    try {
      if (!queryText || queryText.trim().length === 0) {
        return [];
      }

      const params = new URLSearchParams();
      params.append('q', queryText.trim());
      params.append('limit', limit.toString());

      const response = await fetch(`${API_BASE_URL}/memories/semantic-search?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to perform semantic search: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.memories || [];
    } catch (error) {
      console.error('Error performing semantic search:', error);
      throw error;
    }
  }
};
