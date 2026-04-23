import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X, Share2, Heart, Brain, Lightbulb, CheckSquare, FileText } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

const getCategoryIcon = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'task': return <CheckSquare color="#4af8e3" size={20} />;
    case 'idea': return <Lightbulb color="#fbbf24" size={20} />;
    default: return <Brain color="#c799ff" size={20} />;
  }
};

const getCategoryColor = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'task': return '#4af8e3';
    case 'idea': return '#fbbf24';
    default: return '#c799ff';
  }
};

export default function DetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  
  let memory: any = null;
  try {
    memory = params.memory ? JSON.parse(params.memory as string) : null;
  } catch {
    // invalid JSON
  }

  if (!memory) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Memory not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const d = new Date(memory.createdAt);
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const catColor = getCategoryColor(memory.category);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <X color="#fcf8fe" size={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Memory</Text>
        <TouchableOpacity style={styles.headerBtn}>
          <Share2 color="#fcf8fe" size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Hero banner */}
        <View style={styles.heroBanner}>
          <LinearGradient
            colors={[catColor + '20', 'transparent']}
            style={StyleSheet.absoluteFill}
          />
          {getCategoryIcon(memory.category)}
        </View>

        <View style={styles.body}>
          {/* Category + Importance */}
          <View style={styles.metaRow}>
            <View style={[styles.categoryPill, { borderColor: catColor + '40' }]}>
              <Text style={[styles.categoryText, { color: catColor }]}>
                {memory.category || 'Memory'}
              </Text>
            </View>
            {memory.importance >= 0.8 && (
              <View style={styles.importanceBadge}>
                <Heart color="#ef4444" size={12} fill="#ef4444" />
                <Text style={styles.importanceText}>Important</Text>
              </View>
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>{memory.title}</Text>

          {/* Date */}
          <Text style={styles.dateText}>{dateStr} at {timeStr}</Text>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <Text style={styles.summaryText}>{memory.summary}</Text>

          {/* Transcript */}
          {memory.rawTranscript && (
            <>
              <View style={styles.divider} />
              <View style={styles.transcriptHeader}>
                <FileText color="#4af8e3" size={14} />
                <Text style={styles.sectionLabel}>Original Transcript</Text>
              </View>
              <View style={styles.transcriptBox}>
                <Text style={styles.transcriptText}>"{memory.rawTranscript}"</Text>
              </View>
            </>
          )}

          {/* Importance Score */}
          {memory.importance != null && (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>Importance Score</Text>
              <View style={styles.scoreBar}>
                <View style={[styles.scoreFill, { width: `${Math.round(memory.importance * 100)}%`, backgroundColor: catColor }]} />
              </View>
              <Text style={styles.scoreText}>{Math.round(memory.importance * 100)}%</Text>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e12',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#0e0e12',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#888',
    fontSize: 16,
  },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fcf8fe',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerTitle: {
    color: '#fcf8fe',
    fontSize: 16,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  heroBanner: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  body: {
    padding: 24,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  importanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  importanceText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fcf8fe',
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: 8,
  },
  dateText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4af8e3',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  summaryText: {
    fontSize: 16,
    color: '#bbb',
    lineHeight: 26,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  transcriptBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
  },
  transcriptText: {
    color: '#888',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  scoreBar: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  scoreFill: {
    height: '100%',
    borderRadius: 3,
  },
  scoreText: {
    fontSize: 12,
    color: '#666',
  },
});
