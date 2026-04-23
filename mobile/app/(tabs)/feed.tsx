import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { Clock, Heart, Search, X, Plus, Brain, Lightbulb, CheckSquare } from 'lucide-react-native';
import { EchoMindSocket } from '../../lib/socket';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';

interface Memory {
  id: string;
  title: string;
  summary: string;
  rawTranscript: string;
  category: string;
  importance: number;
  createdAt: string;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.29.113:8080';

const getCategoryIcon = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'task': return <CheckSquare color="#4af8e3" size={14} />;
    case 'idea': return <Lightbulb color="#fbbf24" size={14} />;
    default: return <Brain color="#c799ff" size={14} />;
  }
};

const getCategoryColor = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'task': return '#4af8e3';
    case 'idea': return '#fbbf24';
    default: return '#c799ff';
  }
};

export default function FeedScreen() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchMemories = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_URL}/api/memories`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.memories) ? data.memories : Array.isArray(data) ? data : [];
      setMemories(list);
    } catch (err: any) {
      console.log('[Feed] Fetch error:', err.message);
      setError('Could not reach server. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      return fetchMemories();
    }
    
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/memories/semantic-search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.memories) ? data.memories : Array.isArray(data) ? data : [];
      setMemories(list);
    } catch (err: any) {
      console.log('[Feed] Search error:', err.message);
      setError('Search failed. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();

    const socket = EchoMindSocket.getInstance();
    const handleNewMemory = (payload: any) => {
      if (payload.data) {
        setMemories(prev => [payload.data, ...prev]);
      }
    };

    socket.on('MEMORY_SAVED', handleNewMemory);
    return () => {
      socket.off('MEMORY_SAVED', handleNewMemory);
    };
  }, [fetchMemories]);

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
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => router.push({ pathname: '/detail', params: { id: item.id, memory: JSON.stringify(item) } })}
      >
        {/* Category + importance */}
        <View style={styles.cardHeader}>
          <View style={[styles.categoryPill, { borderColor: getCategoryColor(item.category) + '40' }]}>
            {getCategoryIcon(item.category)}
            <Text style={[styles.categoryText, { color: getCategoryColor(item.category) }]}>
              {item.category || 'Memory'}
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
      </TouchableOpacity>
    </Animated.View>
  );

  const ListHeader = () => (
    <View style={styles.header}>
      {/* Date & Title */}
      <Text style={styles.dateLabel}>
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </Text>
      <Text style={styles.pageTitle}>Your Memories</Text>

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

      {/* Error message */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Count */}
      {!loading && memories.length > 0 && (
        <Text style={styles.countLabel}>{memories.length} memor{memories.length === 1 ? 'y' : 'ies'}</Text>
      )}
    </View>
  );

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Brain color="#333" size={48} />
      <Text style={styles.emptyTitle}>No memories yet</Text>
      <Text style={styles.emptySubtitle}>Go to the Listener tab and speak{'\n'}to create your first memory.</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading && memories.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ListHeader />
          <ActivityIndicator size="large" color="#c799ff" style={{ marginTop: 40 }} />
        </View>
      ) : (
        <FlatList
          data={memories}
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
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/listener')}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={['#4af8e3', '#3de0cf']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <Plus color="#0e0e12" size={24} strokeWidth={3} />
      </TouchableOpacity>
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
  countLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
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
