import { useCallback, useMemo, useRef, useState } from 'react';
import type { ConversationMemory } from './usePersistentMemory';

export type TimeRangeFilter = 'all' | 'today' | 'yesterday' | 'last7days';
export type SemanticFilter = 'all' | 'reminder' | 'meeting_action' | 'follow_up' | 'general_note';

export type MemoryRetrievalQuery = {
  keyword: string;
  semanticType: SemanticFilter;
  timeRange: TimeRangeFilter;
  showArchived: boolean;
};

export type UseMemoryRetrievalReturn = {
  query: MemoryRetrievalQuery;
  setQuery: (q: Partial<MemoryRetrievalQuery>) => void;
  results: ConversationMemory[];
  clearSearch: () => void;
};

type IndexedMemory = {
  memory: ConversationMemory;
  revision: string;
  searchableText: string;
};

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function matchesTimeRange(createdAt: number, range: TimeRangeFilter, now: number): boolean {
  if (range === 'all') return true;
  
  const date = new Date(createdAt);
  const nowDate = new Date(now);
  
  // Reset time for start of day comparison
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  
  if (range === 'today') {
    return createdAt >= startOfToday;
  }
  
  if (range === 'yesterday') {
    const startOfYesterday = startOfToday - 86400000;
    return createdAt >= startOfYesterday && createdAt < startOfToday;
  }
  
  if (range === 'last7days') {
    const startOf7DaysAgo = startOfToday - (7 * 86400000);
    return createdAt >= startOf7DaysAgo;
  }
  
  return true;
}

export function useMemoryRetrieval(memories: ConversationMemory[]): UseMemoryRetrievalReturn {
  const indexCacheRef = useRef<Map<string, IndexedMemory>>(new Map());
  const [query, setQueryInternal] = useState<MemoryRetrievalQuery>({
    keyword: '',
    semanticType: 'all',
    timeRange: 'all',
    showArchived: false,
  });

  const setQuery = useCallback((q: Partial<MemoryRetrievalQuery>) => {
    setQueryInternal(prev => ({ ...prev, ...q }));
  }, []);

  const clearSearch = useCallback(() => {
    setQueryInternal({ keyword: '', semanticType: 'all', timeRange: 'all', showArchived: false });
  }, []);

  // Incremental/Memoized index: unchanged entries reuse their text index when
  // memories changes, avoiding repeated transcript joins for stable vault rows.
  const indexedMemories = useMemo(() => {
    const nextCache = new Map<string, IndexedMemory>();
    const indexed = memories.map(memory => {
      const revision = `${memory.updatedAt}:${memory.sourceReminderIds?.join(',') || ''}`;
      const cached = indexCacheRef.current.get(memory.id);
      if (cached && cached.revision === revision) {
        nextCache.set(memory.id, cached);
        return cached;
      }

      const searchableText = [
        memory.sessionTitle || '',
        memory.semanticSummary || '',
        memory.continuationSnapshot?.continuationSummary || '',
        ...(memory.continuationSnapshot?.activeTopics || []),
        ...(memory.continuationSnapshot?.unresolvedTasks || []),
        ...(memory.continuationSnapshot?.pendingReminders || []),
        ...(memory.continuationSnapshot?.recentDecisions || []),
        ...(memory.continuationSnapshot?.followUps || []),
        ...(memory.continuationSnapshot?.importantContext || []),
        ...(memory.conversationIntelligence || []).flatMap(item => [
          ...item.tasks,
          ...item.reminders,
          ...item.deadlines,
          ...item.meetings,
          ...item.participants,
          ...item.decisions,
          ...item.followUps,
          ...item.importantPoints,
          ...item.discussedTopics,
          ...item.actionItems,
          ...item.assignments.flatMap(assignment => [assignment.person, assignment.responsibility]),
        ]),
        ...(memory.conversationChunks || []).flatMap(chunk => [
          chunk.summary,
          ...chunk.highlights,
          ...chunk.tasks,
          ...chunk.reminders,
          ...chunk.topicHints,
          ...chunk.participants,
        ]),
        ...(memory.extractedTasks || []),
        ...(memory.reminders || []),
        ...(memory.highlights || []),
        ...(memory.tags || []),
        ...(memory.participants || []),
        ...memory.semanticObjects.map(so => so.task || ''),
        ...memory.semanticObjects.flatMap(so => so.participants || []),
        ...(memory.sourceReminderIds || []),
      ].join(' ').toLowerCase();

      const row = {
        memory,
        revision,
        searchableText,
      };
      nextCache.set(memory.id, row);
      return row;
    });
    indexCacheRef.current = nextCache;
    return indexed;
  }, [memories]);

  // Derived results for UI (deterministic searching)
  const results = useMemo(() => {
    const now = Date.now();
    const keywords = normalize(query.keyword).split(/\s+/).filter(k => k.length > 0);

    const filtered = indexedMemories
      .filter(({ memory, searchableText }) => {
        // 0. Archive Filter
        const matchesArchive = query.showArchived ? !!memory.isArchived : !memory.isArchived;
        if (!matchesArchive) {
          return false;
        }

        // 1. Time Filter
        if (!matchesTimeRange(memory.createdAt, query.timeRange, now)) {
          return false;
        }

        // 2. Semantic Type Filter
        if (query.semanticType !== 'all') {
          const hasType = memory.semanticObjects.some(
            so => so.type === query.semanticType
          ) || (query.semanticType === 'meeting_action' && memory.sessionType === 'meeting')
            || (query.semanticType === 'follow_up' && memory.sessionType === 'follow_up')
            || (query.semanticType === 'reminder' && memory.sessionType === 'reminder')
            || (query.semanticType === 'general_note' && memory.sessionType === 'general');
          if (!hasType) return false;
        }

        // 3. Keyword Search
        if (keywords.length > 0) {
          const allMatch = keywords.every(kw => searchableText.includes(kw));
          if (!allMatch) return false;
        }

        return true;
      })
      .map(item => item.memory);

    if (!(global as any).isPresentationMode) {
      console.log('[DEV] feed updated. Displaying items:', filtered.length);
    }
    return filtered;
  }, [indexedMemories, query]);

  return {
    query,
    setQuery,
    results,
    clearSearch,
  };
}
