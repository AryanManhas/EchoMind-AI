import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, FlatList, RefreshControl, ScrollView } from 'react-native';
import { Clock, Heart, Search, X, Plus, Brain, Lightbulb, CheckSquare, FolderOpen, Users, WifiOff } from 'lucide-react-native';
import { EchoMindSocket } from '../../lib/socket';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import ENV from '../../lib/env';
import { TransportManager } from '../../lib/transport/TransportManager';
import { usePersistentMemory, type ConversationMemory } from '../../hooks/usePersistentMemory';
import { useReminderEngine } from '../../hooks/useReminderEngine';
import { useKnowledgeGraph } from '../../hooks/useKnowledgeGraph';
import { useBackendSync } from '../../hooks/useBackendSync';
import { SquishButton } from '../../components/SquishButton';
import { SkeletonFeed } from '../../components/SkeletonCard';
import { AskEchoMindSheet } from '../../components/AskEchoMindSheet';
interface Memory {
  id: string;
  title: string;
  summary: string;
  segments: {
    id: string;
    text: string;
    speakerId: string;
    startTime: number;
    endTime: number;
  }[];
  category: string;
  importance: number;
  createdAt: string;
  updatedAt?: string | number;
  sessionId?: string;
  semanticSummary?: string;
  sessionTitle?: string;
  sessionType?: string;
  conversationChunks?: any[];
  conversationIntelligence?: any[];
  continuationSnapshot?: any;
  extractedTasks?: string[];
  reminders?: string[];
  reminderTasks?: any[];
  highlights?: string[];
  participants?: string[];
  semanticObjects?: any[];
  duration?: number;
  utteranceCount?: number;
  sourceReminderIds?: string[];
  turns?: any[];
  isArchived?: boolean;
  linkedProjects?: string[];
  tags?: string[];
  memoryType?: string;
}

const getActiveApiUrl = () => TransportManager.getApiUrl() || ENV.API_URL;

const toTimestamp = (value: string | number | undefined) => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mergeMemories = (
  existing: Memory[],
  incoming: Memory[],
  deletedSessionIds: string[] = [],
  archivedSessionIds: string[] = []
) => {
  const byId = new Map<string, Memory>();
  const deleted = new Set(deletedSessionIds);
  const archived = new Set(archivedSessionIds);

  [...existing, ...incoming].forEach(memory => {
    const key = memory.sessionId || memory.id;
    if (deleted.has(key) || archived.has(key)) return;
    const current = byId.get(key);
    const currentUpdatedAt = toTimestamp(current?.updatedAt || current?.createdAt);
    const nextUpdatedAt = toTimestamp(memory.updatedAt || memory.createdAt);

    if (!current || nextUpdatedAt >= currentUpdatedAt) {
      byId.set(key, {
        ...current,
        ...memory,
        segments: memory.segments || current?.segments || [],
      });
    }
  });

  return Array.from(byId.values())
    .filter(memory => !memory.isArchived && !deleted.has(memory.sessionId || memory.id) && !archived.has(memory.sessionId || memory.id))
    .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
};

const normalizeRemoteMemory = (raw: any): Memory => ({
  ...raw,
  id: raw.id || raw.sessionId || `remote-${raw.createdAt || Date.now()}`,
  sessionId: raw.sessionId || raw.id,
  title: raw.title || raw.sessionTitle || 'Conversational Snapshot',
  summary: raw.summary || raw.semanticSummary || raw.mergedTranscript || '',
  category: raw.category || raw.sessionType || 'Memory',
  importance: raw.importance ?? ((raw.importanceScore || 0) / 100),
  createdAt: typeof raw.createdAt === 'number' ? new Date(raw.createdAt).toISOString() : raw.createdAt || new Date().toISOString(),
  updatedAt: raw.updatedAt,
  segments: Array.isArray(raw.segments) ? raw.segments : [],
});

const mapLocalMemory = (memory: ConversationMemory): Memory => {
  const summary = memory.conversationChunks?.length
    ? memory.conversationChunks.slice(-3).map(chunk => chunk.summary).join(' ')
    : memory.semanticSummary || memory.mergedTranscript || '';

  return {
    ...memory,
    id: memory.id,
    sessionId: memory.sessionId,
    title: memory.sessionTitle || memory.semanticSummary || 'Conversational Snapshot',
    summary,
    semanticSummary: memory.semanticSummary,
    sessionTitle: memory.sessionTitle,
    category: memory.sessionType || 'Memory',
    importance: (memory.importanceScore || 0) / 100,
    importanceScore: memory.importanceScore || 0,
    createdAt: new Date(memory.createdAt).toISOString(),
    updatedAt: memory.updatedAt,
    segments: [],
  } as Memory;
};

const matchesQuery = (memory: Memory, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return [
    memory.title,
    memory.sessionTitle,
    memory.summary,
    memory.semanticSummary,
    memory.category,
    memory.sessionType,
    ...(memory.highlights || []),
    ...(memory.extractedTasks || []),
    ...(memory.reminders || []),
    ...(memory.participants || []),
  ]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(q));
};

const titleCaseType = (value: string) => value
  .replace(/_/g, '-')
  .split('-')
  .filter(Boolean)
  .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
  .join('-');

const detectMemoryType = (memory: Memory): string => {
  const explicit = (memory.memoryType || memory.sessionType || memory.category || '').toLowerCase();
  if (explicit.includes('reminder')) return 'Reminder';
  if (explicit.includes('meeting')) return 'Meeting';
  if (explicit.includes('follow')) return 'Follow-up';
  if (explicit.includes('task')) return 'Task';
  if (explicit.includes('deadline')) return 'Deadline';
  if (explicit.includes('decision')) return 'Decision';

  const intelligence = memory.conversationIntelligence || [];
  const semanticObjects = memory.semanticObjects || [];
  const text = [
    memory.title,
    memory.summary,
    memory.semanticSummary,
    ...(memory.highlights || []),
    ...(memory.extractedTasks || []),
    ...(memory.reminders || []),
  ].join(' ').toLowerCase();

  if ((memory.reminders || []).length > 0 || semanticObjects.some(item => item.type === 'reminder') || /\b(remind|reminder|don't forget)\b/.test(text)) return 'Reminder';
  if (intelligence.some(item => (item.deadlines || []).length > 0) || /\b(deadline|due|by tomorrow|eod)\b/.test(text)) return 'Deadline';
  if (intelligence.some(item => (item.decisions || []).length > 0) || /\b(decided|decision|approved)\b/.test(text)) return 'Decision';
  if ((memory.participants || []).length > 0 || intelligence.some(item => (item.participants || []).length > 0 || (item.meetings || []).length > 0)) return 'Meeting';
  if ((memory.extractedTasks || []).length > 0 || intelligence.some(item => (item.tasks || []).length > 0 || (item.actionItems || []).length > 0 || (item.assignments || []).length > 0)) return 'Task';
  if (intelligence.some(item => (item.followUps || []).length > 0) || /\bfollow[- ]?up|circle back|check in\b/.test(text)) return 'Follow-up';
  if (explicit && explicit !== 'general') return titleCaseType(explicit);
  return memory.turns?.length ? 'Session' : 'Memory';
};

const summarizeIntelligence = (memory: ConversationMemory) => {
  const intelligence = memory.conversationIntelligence || [];
  return {
    tasks: Array.from(new Set(intelligence.flatMap(item => [...item.tasks, ...item.actionItems, ...item.followUps]))).slice(0, 3),
    decisions: Array.from(new Set(intelligence.flatMap(item => item.decisions))).slice(0, 2),
    participants: Array.from(new Set([
      ...(memory.participants || []),
      ...intelligence.flatMap(item => item.participants),
    ])).slice(0, 4),
  };
};

const getCategoryIcon = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'reminder':
    case 'task': return <CheckSquare color="#4af8e3" size={14} />;
    case 'meeting': return <Users color="#fbbf24" size={14} />;
    case 'idea': return <Lightbulb color="#fbbf24" size={14} />;
    default: return <Brain color="#c799ff" size={14} />;
  }
};

const getCategoryColor = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'reminder':
    case 'task': return '#4af8e3';
    case 'meeting':
    case 'idea': return '#fbbf24';
    case 'follow-up':
    case 'deadline': return '#fca5a5';
    case 'decision': return '#7dd3fc';
    default: return '#c799ff';
  }
};

export default function FeedScreen() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [askSheetVisible, setAskSheetVisible] = useState(false);
  const [focusFilter, setFocusFilter] = useState('All');
  const [whenFilter, setWhenFilter] = useState('All Time');
  const [error, setError] = useState<string | null>(null);
  const persistentMemory = usePersistentMemory();
  const reminders = useReminderEngine(persistentMemory.memories);
  const memoriesRef = useRef<Memory[]>([]);
  const router = useRouter();

  const localMemories = useMemo(
    () => persistentMemory.memories.map(mapLocalMemory),
    [persistentMemory.memories]
  );
  const archivedSessionIds = useMemo(
    () => persistentMemory.memories.filter(memory => memory.isArchived).map(memory => memory.sessionId),
    [persistentMemory.memories]
  );

  const visibleMemories = useMemo(
    () => memories.filter(memory => {
      // 1. Search Query
      if (typeof matchesQuery === 'function' && !matchesQuery(memory, searchQuery)) return false;

      // 2. Focus Filter
      if (focusFilter !== 'All') {
        const type = detectMemoryType(memory);
        if (focusFilter === 'Reminders' && !['Reminder', 'Task', 'Deadline'].includes(type)) return false;
        if (focusFilter === 'Meetings' && type !== 'Meeting') return false;
        if (focusFilter === 'Follow-ups' && !['Follow-up', 'Task'].includes(type)) return false;
      }

      // 3. When Filter
      if (whenFilter !== 'All Time') {
        const memoryDate = new Date(memory.createdAt);
        const today = new Date();
        const memoryDateString = memoryDate.toDateString();
        
        if (whenFilter === 'Today') {
          if (memoryDateString !== today.toDateString()) return false;
        } else if (whenFilter === 'Yesterday') {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          if (memoryDateString !== yesterday.toDateString()) return false;
        } else if (whenFilter === 'Last 7 Days') {
          const sevenDaysAgo = new Date(today);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          if (memoryDate < sevenDaysAgo) return false;
        }
      }

      return true;
    }),
    [memories, searchQuery, focusFilter, whenFilter]
  );

  const localCacheAvailable = localMemories.length > 0;
  const knowledgeGraph = useKnowledgeGraph({
    memories: persistentMemory.memories.filter(memory => {
      // 2. Focus Filter
      if (focusFilter !== 'All') {
        const type = detectMemoryType(mapLocalMemory(memory));
        if (focusFilter === 'Reminders' && !['Reminder', 'Task', 'Deadline'].includes(type)) return false;
        if (focusFilter === 'Meetings' && type !== 'Meeting') return false;
        if (focusFilter === 'Follow-ups' && !['Follow-up', 'Task'].includes(type)) return false;
      }
      // 3. When Filter
      if (whenFilter !== 'All Time') {
        const memoryDate = new Date(memory.createdAt);
        const today = new Date();
        const memoryDateString = memoryDate.toDateString();
        if (whenFilter === 'Today') {
          if (memoryDateString !== today.toDateString()) return false;
        } else if (whenFilter === 'Yesterday') {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          if (memoryDateString !== yesterday.toDateString()) return false;
        } else if (whenFilter === 'Last 7 Days') {
          const sevenDaysAgo = new Date(today);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          if (memoryDate < sevenDaysAgo) return false;
        }
      }
      return true;
    }),
    reminders: reminders.tasks,
    query: searchQuery,
    limits: {
      maxProjects: 8,
      maxParticipants: 8,
      maxTopics: 8,
      maxContextCharacters: 680,
    },
  });

  useBackendSync({
    memories: persistentMemory.memories,
    reminders: reminders.tasks,
  });

  const meetingMemories = useMemo(
    () => persistentMemory.memories
      .filter(memory => {
        // Focus Filter
        if (focusFilter !== 'All') {
          const type = detectMemoryType(mapLocalMemory(memory));
          if (focusFilter === 'Reminders' && !['Reminder', 'Task', 'Deadline'].includes(type)) return false;
          if (focusFilter === 'Meetings' && type !== 'Meeting') return false;
          if (focusFilter === 'Follow-ups' && !['Follow-up', 'Task'].includes(type)) return false;
        }
        // When Filter
        if (whenFilter !== 'All Time') {
          const memoryDate = new Date(memory.createdAt);
          const today = new Date();
          const memoryDateString = memoryDate.toDateString();
          if (whenFilter === 'Today' && memoryDateString !== today.toDateString()) return false;
          else if (whenFilter === 'Yesterday') {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            if (memoryDateString !== yesterday.toDateString()) return false;
          } else if (whenFilter === 'Last 7 Days') {
            const sevenDaysAgo = new Date(today);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            if (memoryDate < sevenDaysAgo) return false;
          }
        }
        return memory.sessionType === 'meeting' || summarizeIntelligence(memory).participants.length > 0;
      })
      .slice(0, 3),
    [persistentMemory.memories, focusFilter, whenFilter]
  );

  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    if (!persistentMemory.isLoaded) return;
    setMemories(prev => mergeMemories(prev, localMemories, persistentMemory.deletedSessionIds, archivedSessionIds));
    setLoading(false);
  }, [archivedSessionIds, localMemories, persistentMemory.deletedSessionIds, persistentMemory.isLoaded]);



  const fetchMemories = useCallback(async () => {
    try {
      setError(null);
      const token = EchoMindSocket.getInstance().getAuthToken();
      const activeUrl = getActiveApiUrl();
      const res = await fetch(`${activeUrl}/api/memories`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.data?.memories)
        ? data.data.memories
        : Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.memories)
        ? data.memories
        : Array.isArray(data)
        ? data
        : [];
      setMemories(prev => mergeMemories(prev, list.map(normalizeRemoteMemory), persistentMemory.deletedSessionIds, archivedSessionIds));
      setError(null);
    } catch (err: any) {
      console.log('[Feed] Fetch error:', err.message);
      if (memoriesRef.current.length === 0 && !localCacheAvailable) {
        setError('Memory service unavailable.');
      } else {
        setError(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [archivedSessionIds, localCacheAvailable, persistentMemory.deletedSessionIds]);

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      return fetchMemories();
    }
    
    setLoading(true);
    setError(null);
    try {
      const activeUrl = getActiveApiUrl();
      const token = EchoMindSocket.getInstance().getAuthToken();
      const res = await fetch(`${activeUrl}/api/memories/search?q=${encodeURIComponent(query)}&mode=semantic`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.data?.memories)
        ? data.data.memories
        : Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.memories)
        ? data.memories
        : Array.isArray(data)
        ? data
        : [];
      setMemories(prev => mergeMemories(prev, list.map(normalizeRemoteMemory), persistentMemory.deletedSessionIds, archivedSessionIds));
      setError(null);
    } catch (err: any) {
      console.log('[Feed] Search error:', err.message);
      if (memoriesRef.current.length === 0 && !localCacheAvailable) {
        setError('Search failed. Check connection.');
      } else {
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (persistentMemory.isLoaded) {
      fetchMemories();
    }

    const socket = EchoMindSocket.getInstance();
    const handleNewMemory = (payload: any) => {
      if (payload.data) {
        setMemories(prev => mergeMemories(prev, [normalizeRemoteMemory(payload.data)], persistentMemory.deletedSessionIds, archivedSessionIds));
      }
    };

    socket.on('MEMORY_SAVED', handleNewMemory);
    return () => {
      socket.off('MEMORY_SAVED', handleNewMemory);
    };
  }, [archivedSessionIds, fetchMemories, persistentMemory.deletedSessionIds, persistentMemory.isLoaded]);

  const formatDate = (dateString: string) => {
    try {
      const d = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const renderItem = ({ item, index }: { item: Memory; index: number }) => (
    <Animated.View 
      entering={FadeIn.duration(400).delay(index < 5 ? index * 100 : 0)} 
      style={styles.cardWrapper}
    >
      <SquishButton
        contentContainerStyle={styles.card}
        haptic="light"
        squishScale={0.96}
        onPress={() => router.push({ pathname: '/detail', params: { id: item.id, memory: JSON.stringify(item) } })}
      >
        {/* Category + importance */}
        <View style={styles.cardHeader}>
          <View style={[styles.categoryPill, { borderColor: getCategoryColor(detectMemoryType(item)) + '40' }]}>
            {getCategoryIcon(detectMemoryType(item))}
            <Text style={[styles.categoryText, { color: getCategoryColor(detectMemoryType(item)) }]}>
              {detectMemoryType(item)}
            </Text>
          </View>
          {item.importance >= 0.8 && (
            <Heart color="#ef4444" size={14} fill="#ef4444" />
          )}
        </View>

        {/* Title */}
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>

        {/* Summary */}
        <Text style={styles.cardSummary} numberOfLines={2}>
          {item.summary}
        </Text>

        {/* Time */}
        <View style={styles.cardFooter}>
          <Clock color="#666" size={12} />
          <Text style={styles.cardTime}>{formatDate(item.createdAt)}</Text>
        </View>

        {!!((item.participants?.length || 0) > 0 || (item.tags?.length || 0) > 0) && (
          <View style={styles.inlineChipRow}>
            {(item.participants || []).slice(0, 3).map(person => (
              <View key={`${item.id}-${person}`} style={styles.personChip}>
                <Users color="#c799ff" size={11} />
                <Text style={styles.personChipText}>{person}</Text>
              </View>
            ))}
            {(item.tags || []).slice(0, 3).map(tag => (
              <View key={`${item.id}-${tag}`} style={styles.memoryTag}>
                <Clock color="#fbbf24" size={11} />
                <Text style={styles.memoryTagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </SquishButton>
    </Animated.View>
  );

  const openLocalSession = (sessionId: string) => {
    const memory = persistentMemory.memories.find(item => item.sessionId === sessionId || item.id === sessionId);
    if (!memory) return;

    router.push({
      pathname: '/detail',
      params: {
        id: memory.id,
        memory: JSON.stringify(mapLocalMemory(memory)),
      },
    });
  };

  const ListHeader = useCallback(() => (
    <View style={styles.header}>
      {/* Date & Title */}
      <Text style={styles.dateLabel}>
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </Text>
      <Text style={styles.pageTitle}>Your Memories</Text>

      {/* Ask EchoMind Button */}
      <SquishButton
        contentContainerStyle={styles.askEchoMindButton}
        onPress={() => setAskSheetVisible(true)}
        haptic="medium"
        squishScale={0.95}
      >
        <LinearGradient
          colors={['#c799ff', '#a855f7']}
          style={{ borderRadius: 14, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
        />
        <Brain color="#fff" size={18} />
        <Text style={styles.askEchoMindText}>Ask EchoMind</Text>
      </SquishButton>

      {/* Search */}
      <View style={styles.searchBar}>
        <Search color="#666" size={18} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search memories..."
          placeholderTextColor="#555"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => performSearch(searchQuery)}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => { setSearchQuery(''); performSearch(''); }}>
            <X color="#666" size={18} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Rows */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
        {['All', 'Reminders', 'Meetings', 'Follow-ups'].map(filter => (
          <SquishButton 
            key={filter} 
            contentContainerStyle={[styles.filterChip, focusFilter === filter && styles.filterChipActive]}
            onPress={() => setFocusFilter(filter)}
            haptic="light"
            squishScale={0.92}
          >
            <Text style={[styles.filterChipText, focusFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
          </SquishButton>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.filterRow, { marginBottom: 16 }]} contentContainerStyle={styles.filterContent}>
        {['All Time', 'Today', 'Yesterday', 'Last 7 Days'].map(filter => (
          <SquishButton 
            key={filter} 
            contentContainerStyle={[styles.filterChip, whenFilter === filter && styles.filterChipActive]}
            onPress={() => setWhenFilter(filter)}
            haptic="light"
            squishScale={0.92}
          >
            <Text style={[styles.filterChipText, whenFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
          </SquishButton>
        ))}
      </ScrollView>

      {/* Error message */}
      {!!error && (
        <View style={memories.length > 0 ? styles.statusBox : styles.errorBox}>
          {memories.length > 0 && <WifiOff color="#4af8e3" size={14} />}
          <Text style={memories.length > 0 ? styles.statusText : styles.errorText}>{error}</Text>
        </View>
      )}

      {!!(knowledgeGraph.projectTimelines.length > 0) && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <FolderOpen color="#4af8e3" size={15} />
            <Text style={styles.sectionLabel}>Projects</Text>
          </View>
          <View style={styles.projectChipRow}>
            {knowledgeGraph.projectTimelines.slice(0, 6).map(project => (
              <SquishButton
                key={project.projectId}
                contentContainerStyle={styles.projectChip}
                onPress={() => setSearchQuery(project.title)}
                haptic="light"
                squishScale={0.92}
              >
                <Text style={styles.projectChipText}>{project.title}</Text>
                <Text style={styles.projectChipMeta}>{project.sessionIds.length}</Text>
              </SquishButton>
            ))}
          </View>
        </View>
      )}

      {!!(meetingMemories.length > 0) && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Users color="#60a5fa" size={15} />
            <Text style={styles.sectionLabel}>Meeting Intelligence</Text>
          </View>
          {meetingMemories.map(memory => {
            const intelligence = summarizeIntelligence(memory);
            return (
              <SquishButton
                key={memory.sessionId}
                contentContainerStyle={styles.meetingCard}
                onPress={() => openLocalSession(memory.sessionId)}
                haptic="light"
                squishScale={0.96}
              >
                <View style={styles.meetingCardHeader}>
                  <Text style={styles.meetingTitle} numberOfLines={1}>{memory.sessionTitle}</Text>
                  <Text style={styles.meetingTime}>{formatDate(new Date(memory.createdAt).toISOString())}</Text>
                </View>
                <Text style={styles.meetingSummary} numberOfLines={2}>{memory.semanticSummary}</Text>
                {!!(intelligence.participants.length > 0) && (
                  <View style={styles.inlineChipRow}>
                    {intelligence.participants.map(person => (
                      <View key={`${memory.sessionId}-${person}`} style={styles.personChip}>
                        <Users color="#c799ff" size={11} />
                        <Text style={styles.personChipText}>{person}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!(intelligence.tasks.length > 0 || intelligence.decisions.length > 0) && (
                  <Text style={styles.meetingDetails} numberOfLines={2}>
                    {[...intelligence.decisions, ...intelligence.tasks].join('  ·  ')}
                  </Text>
                )}
              </SquishButton>
            );
          })}
        </View>
      )}

      {/* Count */}
      {!!(!loading && visibleMemories.length > 0) && (
        <Text style={styles.countLabel}>{visibleMemories.length} memor{visibleMemories.length === 1 ? 'y' : 'ies'}</Text>
      )}
    </View>
  ), [searchQuery, focusFilter, whenFilter, memories.length, visibleMemories.length, error, knowledgeGraph, loading]);

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Brain color="#333" size={48} />
      <Text style={styles.emptyTitle}>No memories yet</Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery.trim()
          ? 'No local memories match this search.'
          : 'Go to the Listener tab and speak\nto create your first memory.'}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading && memories.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ListHeader />
          <View style={{ marginTop: 20 }}>
            <SkeletonFeed />
          </View>
        </View>
      ) : (
        <Animated.FlatList
          data={visibleMemories}
          renderItem={renderItem}
          keyExtractor={(item, i) => item.id || String(i)}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={EmptyState}
          contentContainerStyle={styles.listContent}
          itemLayoutAnimation={LinearTransition}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchMemories(); }}
              tintColor="#c799ff"
              colors={['#c799ff']}
              progressBackgroundColor="#1c1c24"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <SquishButton
        style={styles.fab}
        onPress={() => router.push('/(tabs)/listener')}
        haptic="medium"
        squishScale={0.85}
      >
        <LinearGradient
          colors={['#4af8e3', '#3de0cf']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
        />
        <Plus color="#0e0e12" size={24} strokeWidth={3} />
      </SquishButton>

      <AskEchoMindSheet 
        visible={askSheetVisible} 
        onClose={() => setAskSheetVisible(false)} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e12',
  },
  loadingContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 120,
  },
  header: {
    paddingTop: 90,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4af8e3',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fcf8fe',
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  askEchoMindButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  askEchoMindText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fcf8fe',
    fontSize: 15,
  },
  filterRow: {
    marginBottom: 10,
    flexGrow: 0,
  },
  filterContent: {
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterChipActive: {
    backgroundColor: 'rgba(74, 248, 227, 0.15)',
    borderColor: 'rgba(74, 248, 227, 0.4)',
  },
  filterChipText: {
    color: 'rgba(252, 248, 254, 0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#4af8e3',
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
  },
  statusBox: {
    backgroundColor: 'rgba(74, 248, 227, 0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(74, 248, 227, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusText: {
    color: '#4af8e3',
    fontSize: 13,
    textAlign: 'center',
  },
  countLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  sectionBlock: {
    marginBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionLabel: {
    color: 'rgba(252, 248, 254, 0.62)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  projectChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(74, 248, 227, 0.075)',
    borderWidth: 1,
    borderColor: 'rgba(74, 248, 227, 0.16)',
  },
  projectChipText: {
    color: '#d9fffb',
    fontSize: 12,
    fontWeight: '700',
  },
  projectChipMeta: {
    color: '#4af8e3',
    fontSize: 11,
    fontWeight: '800',
  },
  meetingCard: {
    backgroundColor: 'rgba(96, 165, 250, 0.055)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.12)',
    padding: 14,
    marginBottom: 10,
  },
  meetingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  meetingTitle: {
    flex: 1,
    color: '#fcf8fe',
    fontSize: 15,
    fontWeight: '800',
  },
  meetingTime: {
    color: 'rgba(252, 248, 254, 0.42)',
    fontSize: 11,
    fontWeight: '600',
  },
  meetingSummary: {
    color: 'rgba(252, 248, 254, 0.64)',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  meetingDetails: {
    color: 'rgba(96, 165, 250, 0.82)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  inlineChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(199, 153, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(199, 153, 255, 0.12)',
  },
  personChipText: {
    color: '#d8b4fe',
    fontSize: 10,
    fontWeight: '700',
  },
  memoryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.12)',
  },
  memoryTagText: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '700',
  },
  cardWrapper: {
    width: '100%',
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fcf8fe',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  cardSummary: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardTime: {
    fontSize: 12,
    color: '#555',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#555',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#444',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#4af8e3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
});
