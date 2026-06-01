import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Share, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X, Share2, Heart, Brain, Lightbulb, CheckSquare, FileText, Edit2, Trash2, Check, XSquare, Users, Clock, Target, ArrowRight, AlertCircle, Calendar } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePersistentMemory } from '../hooks/usePersistentMemory';

const getCategoryIcon = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'task': return <CheckSquare color="#4af8e3" size={20} />;
    case 'idea': return <Lightbulb color="#fbbf24" size={20} />;
    default: return <Brain color="#c799ff" size={20} />;
  }
};

const getCategoryColor = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'task':
    case 'reminder':
      return '#4af8e3';
    case 'meeting':
    case 'meeting_action':
    case 'idea': return '#fbbf24';
    case 'follow_up': return '#fca5a5';
    case 'brainstorming': return '#7dd3fc';
    default: return '#c799ff';
  }
};

export default function DetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');

  const { memories, updateMemory, deleteMemory } = usePersistentMemory();
  const memoryId = params.id as string;

  const initialMemory = useMemo(() => {
    try {
      return params.memory ? JSON.parse(params.memory as string) : null;
    } catch {
      return null;
    }
  }, [params.memory]);

  const activeMemory = useMemo(() => {
    const found = memories.find(m => m.id === memoryId || m.sessionId === memoryId);
    return found || initialMemory;
  }, [memories, memoryId, initialMemory]);

  useEffect(() => {
    if (!isEditingTitle && activeMemory) {
      setEditedTitle(activeMemory.title || activeMemory.sessionTitle || '');
    }
  }, [activeMemory, isEditingTitle]);

  if (!activeMemory) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Memory not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const d = new Date(activeMemory.createdAt);
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const catColor = getCategoryColor(activeMemory.category);
  const chunks = activeMemory.conversationChunks || [];
  const intelligence = activeMemory.conversationIntelligence || [];
  const continuationSnapshot = activeMemory.continuationSnapshot || null;
  const transcript = activeMemory.summary || '';
  const visibleChunks = transcriptExpanded ? chunks : chunks.slice(0, 4);
  const transcriptPreview = useMemo(() => {
    if (transcript.length <= 900) return transcript;
    return `${transcript.slice(0, 900).trim()}...`;
  }, [transcript]);
  const visibleTranscript = transcriptExpanded ? transcript : transcriptPreview;
  const hasLongTranscript = chunks.length > visibleChunks.length || transcript.length > transcriptPreview.length;
  const reminderTasks = activeMemory.reminderTasks || [];
  
  const intelligenceGroups = useMemo(() => ({
    tasks: Array.from(new Set<string>(intelligence.flatMap((item: any) => [...(item.tasks || []), ...(item.actionItems || [])]))).slice(0, 8),
    deadlines: Array.from(new Set<string>(intelligence.flatMap((item: any) => item.deadlines || []))).slice(0, 8),
    participants: Array.from(new Set<string>(intelligence.flatMap((item: any) => item.participants || []))).slice(0, 8),
    decisions: Array.from(new Set<string>(intelligence.flatMap((item: any) => item.decisions || []))).slice(0, 8),
    followUps: Array.from(new Set<string>(intelligence.flatMap((item: any) => item.followUps || []))).slice(0, 8),
    importantPoints: Array.from(new Set<string>(intelligence.flatMap((item: any) => item.importantPoints || []))).slice(0, 8),
    assignments: intelligence.flatMap((item: any) => item.assignments || []).slice(0, 8),
  }), [intelligence]);

  const durationLabel = activeMemory.duration > 0 ? `${Math.ceil(activeMemory.duration / 1000)}s` : '0s';
  const linkedProjects = activeMemory.linkedProjects || [];

  const handleShare = async () => {
    try {
      const parts = [
        `# ${activeMemory.title || activeMemory.sessionTitle}`,
        `*Date: ${dateStr} at ${timeStr}*`,
        `*Session type: ${activeMemory.category}*`,
        `*Duration: ${durationLabel}*`,
        ``,
        `## Summary`,
        activeMemory.semanticSummary || 'No summary available.',
        ``,
      ];

      if (activeMemory.highlights && activeMemory.highlights.length > 0) {
        parts.push(`## Highlights`);
        parts.push(activeMemory.highlights.map((h: string) => `- ${h}`).join('\n'));
        parts.push(``);
      }

      if ((activeMemory.reminders && activeMemory.reminders.length > 0) || (activeMemory.extractedTasks && activeMemory.extractedTasks.length > 0) || reminderTasks.length > 0) {
        parts.push(`## Reminders / Tasks`);
        reminderTasks.forEach((t: any) => parts.push(`- [ ] ${t.title}`));
        activeMemory.reminders?.forEach((r: string) => parts.push(`- [ ] Reminder: ${r}`));
        activeMemory.extractedTasks?.forEach((t: string) => parts.push(`- [ ] Task: ${t}`));
        parts.push(``);
      }

      parts.push(`## Memory Timeline`);
      if (chunks.length > 0) {
        chunks.forEach((chunk: any, index: number) => {
          parts.push(`${index + 1}. ${chunk.summary}`);
          chunk.highlights?.slice(0, 2).forEach((h: string) => parts.push(`   - ${h}`));
        });
      } else {
        parts.push(transcript);
      }

      if (intelligence.length > 0) {
        parts.push(`## Key Details`);
        intelligenceGroups.importantPoints.forEach((point: string) => parts.push(`- ${point}`));
        intelligenceGroups.decisions.forEach((decision: string) => parts.push(`- Decision: ${decision}`));
        intelligenceGroups.deadlines.forEach((deadline: string) => parts.push(`- Deadline: ${deadline}`));
        intelligenceGroups.assignments.forEach((assignment: any) => parts.push(`- ${assignment.person}: ${assignment.responsibility}`));
        parts.push(``);
      }
      parts.push(``);
      parts.push(`---`);
      parts.push(`*Saved by EchoMind*`);

      await Share.share({
        message: parts.join('\n'),
        title: activeMemory.title || activeMemory.sessionTitle
      });
    } catch (e) {
      console.error('Failed to share memory', e);
    }
  };

  const handleSaveTitle = async () => {
    if (!editedTitle.trim()) return;
    try {
      await updateMemory(activeMemory.sessionId, { sessionTitle: editedTitle.trim() });
      setIsEditingTitle(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to rename session title');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Session',
      'Are you sure you want to permanently delete this conversation session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMemory(activeMemory.sessionId);
              router.back();
            } catch (e) {
              Alert.alert('Error', 'Failed to delete session');
            }
          },
        },
      ]
    );
  };

  const handleToggleArchive = async () => {
    try {
      const nextArchive = !activeMemory.isArchived;
      await updateMemory(activeMemory.sessionId, { isArchived: nextArchive });
      Alert.alert(
        nextArchive ? 'Session Archived' : 'Session Restored',
        nextArchive ? 'This session has been archived and hidden from your feed.' : 'This session is now visible in your feed.'
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to update session archive status');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <X color="#fcf8fe" size={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Memory</Text>
        <TouchableOpacity style={styles.headerBtn} onPress={handleShare}>
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
          {getCategoryIcon(activeMemory.category)}
        </View>

        <View style={styles.body}>
          {/* Category + Importance */}
          <View style={styles.metaRow}>
            <View style={[styles.categoryPill, { borderColor: catColor + '40' }]}>
              <Text style={[styles.categoryText, { color: catColor }]}>
                {activeMemory.category || 'Memory'}
              </Text>
            </View>
            {activeMemory.importance >= 0.8 && (
              <View style={styles.importanceBadge}>
                <Heart color="#ef4444" size={12} fill="#ef4444" />
                <Text style={styles.importanceText}>Important</Text>
              </View>
            )}
          </View>

          {/* Title Area with inline Rename */}
          {isEditingTitle ? (
            <View style={styles.editTitleRow}>
              <TextInput
                style={styles.titleInput}
                value={editedTitle}
                onChangeText={setEditedTitle}
                placeholder="Session title..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoFocus
              />
              <TouchableOpacity onPress={handleSaveTitle} style={styles.editActionBtn}>
                <Check color="#4af8e3" size={20} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIsEditingTitle(false)} style={styles.editActionBtn}>
                <XSquare color="#fca5a5" size={20} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.titleRow}>
              <Text style={styles.title}>{activeMemory.title || activeMemory.sessionTitle}</Text>
              <TouchableOpacity onPress={() => setIsEditingTitle(true)} style={styles.editBtn}>
                <Edit2 color="rgba(255,255,255,0.4)" size={16} />
              </TouchableOpacity>
            </View>
          )}

          {/* Date */}
          <Text style={styles.dateText}>{dateStr} at {timeStr}</Text>
          <Text style={styles.dateText}>Duration {durationLabel} · {reminderTasks.length || activeMemory.sourceReminderIds?.length || 0} linked reminder{(reminderTasks.length || activeMemory.sourceReminderIds?.length || 0) === 1 ? '' : 's'}</Text>
          {!!continuationSnapshot && (
            <Text style={styles.dateText}>
              Thread {continuationSnapshot.activeTopics?.[0] || continuationSnapshot.threadId}
            </Text>
          )}
          {linkedProjects.length > 0 && (
            <Text style={styles.dateText}>
              Connected to {linkedProjects.join(' / ')}
            </Text>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <Text style={styles.summaryText}>{activeMemory.semanticSummary || 'No summary available.'}</Text>
          <View style={styles.divider} />

          {/* ─── Intelligence Sections ─── */}
          {intelligenceGroups.decisions.length > 0 && (
            <>
              <View style={styles.intelSectionHeader}>
                <Target color="#fbbf24" size={16} />
                <Text style={[styles.sectionLabel, styles.intelSectionLabel]}>Decisions Taken</Text>
              </View>
              <View style={styles.intelCard}>
                {intelligenceGroups.decisions.map((d: string, i: number) => (
                  <View key={`dec-${i}`} style={styles.intelRow}>
                    <View style={[styles.intelDot, { backgroundColor: '#fbbf24' }]} />
                    <Text style={styles.intelRowText}>{d}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {!!(intelligenceGroups.tasks.length > 0 || intelligenceGroups.assignments.length > 0) && (
            <>
              <View style={styles.intelSectionHeader}>
                <CheckSquare color="#4af8e3" size={16} />
                <Text style={[styles.sectionLabel, styles.intelSectionLabel]}>Action Items & Ownership</Text>
              </View>
              <View style={styles.intelCard}>
                {intelligenceGroups.assignments.map((a: any, i: number) => (
                  <View key={`asgn-${i}`} style={styles.intelRow}>
                    <View style={[styles.intelDot, { backgroundColor: '#4af8e3' }]} />
                    <View style={styles.assignmentRow}>
                      <View style={styles.ownerBadge}>
                        <Text style={styles.ownerBadgeText}>{a.person}</Text>
                      </View>
                      <Text style={styles.intelRowText}>{a.responsibility}</Text>
                    </View>
                  </View>
                ))}
                {intelligenceGroups.tasks
                  .filter((t: string) => !intelligenceGroups.assignments.some((a: any) => a.responsibility === t))
                  .map((t: string, i: number) => (
                  <View key={`task-intel-${i}`} style={styles.intelRow}>
                    <View style={[styles.intelDot, { backgroundColor: '#4af8e3' }]} />
                    <Text style={styles.intelRowText}>{t}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {intelligenceGroups.deadlines.length > 0 && (
            <>
              <View style={styles.intelSectionHeader}>
                <Clock color="#f87171" size={16} />
                <Text style={[styles.sectionLabel, styles.intelSectionLabel]}>Deadlines & Timings</Text>
              </View>
              <View style={styles.intelCard}>
                {intelligenceGroups.deadlines.map((dl: string, i: number) => (
                  <View key={`dl-${i}`} style={styles.intelRow}>
                    <Calendar color="#f87171" size={13} />
                    <Text style={[styles.intelRowText, styles.deadlineText]}>{dl}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {intelligenceGroups.participants.length > 0 && (
            <>
              <View style={styles.intelSectionHeader}>
                <Users color="#a78bfa" size={16} />
                <Text style={[styles.sectionLabel, styles.intelSectionLabel]}>Participants</Text>
              </View>
              <View style={styles.participantChips}>
                {intelligenceGroups.participants.map((p: string, i: number) => (
                  <View key={`part-${i}`} style={styles.participantChip}>
                    <Text style={styles.participantChipText}>{p}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {intelligenceGroups.followUps.length > 0 && (
            <>
              <View style={styles.intelSectionHeader}>
                <ArrowRight color="#60a5fa" size={16} />
                <Text style={[styles.sectionLabel, styles.intelSectionLabel]}>Pending Follow-ups</Text>
              </View>
              <View style={styles.intelCard}>
                {intelligenceGroups.followUps.map((f: string, i: number) => (
                  <View key={`fu-${i}`} style={styles.intelRow}>
                    <AlertCircle color="#60a5fa" size={13} />
                    <Text style={styles.intelRowText}>{f}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {intelligenceGroups.importantPoints.length > 0 && (
            <>
              <View style={styles.intelSectionHeader}>
                <Lightbulb color="#fcd34d" size={16} />
                <Text style={[styles.sectionLabel, styles.intelSectionLabel]}>Key Points</Text>
              </View>
              <View style={styles.intelCard}>
                {intelligenceGroups.importantPoints.map((p: string, i: number) => (
                  <View key={`kp-${i}`} style={styles.intelRow}>
                    <View style={[styles.intelDot, { backgroundColor: '#fcd34d' }]} />
                    <Text style={styles.intelRowText}>{p}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {!!(intelligenceGroups.decisions.length > 0 ||
            intelligenceGroups.tasks.length > 0 ||
            intelligenceGroups.deadlines.length > 0 ||
            intelligenceGroups.participants.length > 0 ||
            intelligenceGroups.followUps.length > 0 ||
            intelligenceGroups.importantPoints.length > 0) && (
            <View style={styles.divider} />
          )}


          {/* Chat Timeline / Turns */}
          <Text style={styles.sectionLabel}>Timeline & Chat Turns</Text>
          <View style={styles.chatTimeline}>
            {activeMemory.turns && activeMemory.turns.length > 0 ? (
              activeMemory.turns.map((turn: any, index: number) => {
                const isUser = turn.role === 'user';
                const turnTime = new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <View
                    key={index}
                    style={[
                      styles.chatBubbleContainer,
                      isUser ? styles.userBubbleContainer : styles.assistantBubbleContainer,
                    ]}
                  >
                    <View
                      style={[
                        styles.chatBubble,
                        isUser ? styles.userBubble : styles.assistantBubble,
                      ]}
                    >
                      <Text style={isUser ? styles.userText : styles.assistantText}>
                        {turn.text}
                      </Text>
                      <Text style={styles.chatTime}>{turnTime}</Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.transcriptBox}>
                <Text style={styles.transcriptText}>{visibleTranscript}</Text>
              </View>
            )}
          </View>
          <View style={styles.divider} />

          {/* Highlights */}
          {!!(activeMemory.highlights && activeMemory.highlights.length > 0) && (
            <>
              <Text style={styles.sectionLabel}>Highlights</Text>
              <View style={styles.highlightsContainer}>
                {activeMemory.highlights.map((h: string, i: number) => (
                  <View key={i} style={styles.highlightChip}>
                    <Text style={styles.highlightText}>{h}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.divider} />
            </>
          )}

          {/* Tasks & Reminders */}
          {!!((activeMemory.extractedTasks && activeMemory.extractedTasks.length > 0) || (activeMemory.reminders && activeMemory.reminders.length > 0) || reminderTasks.length > 0) && (
            <>
              <Text style={styles.sectionLabel}>To remember</Text>
              {reminderTasks.map((task: any) => (
                <View key={task.id} style={styles.actionItem}>
                  <CheckSquare color="#4af8e3" size={16} />
                  <Text style={styles.actionItemText}>{task.title}</Text>
                </View>
              ))}
              {activeMemory.reminders?.map((r: string, i: number) => (
                <View key={`rem-${i}`} style={styles.actionItem}>
                  <CheckSquare color="#4af8e3" size={16} />
                  <Text style={styles.actionItemText}>{r}</Text>
                </View>
              ))}
              {activeMemory.extractedTasks?.map((t: string, i: number) => (
                <View key={`task-${i}`} style={styles.actionItem}>
                  <CheckSquare color="#fbbf24" size={16} />
                  <Text style={styles.actionItemText}>{t}</Text>
                </View>
              ))}
              <View style={styles.divider} />
            </>
          )}

          {/* Action Row */}
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={handleToggleArchive} style={[styles.actionBtn, styles.archiveBtn]}>
              <Brain color={activeMemory.isArchived ? "#4af8e3" : "#c799ff"} size={18} />
              <Text style={[styles.actionBtnText, { color: activeMemory.isArchived ? "#4af8e3" : "#c799ff" }]}>
                {activeMemory.isArchived ? 'Unarchive' : 'Archive'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleDelete} style={[styles.actionBtn, styles.deleteBtn]}>
              <Trash2 color="#fca5a5" size={18} />
              <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Delete</Text>
            </TouchableOpacity>
          </View>
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
    borderBottomColor: 'rgba(255,255,255,0.03)',
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
    backgroundColor: 'rgba(255,255,255,0.02)',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fcf8fe',
    letterSpacing: -0.5,
    lineHeight: 32,
    flex: 1,
  },
  editBtn: {
    padding: 8,
  },
  editTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  titleInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#fcf8fe',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderBottomWidth: 2,
    borderBottomColor: '#c799ff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  editActionBtn: {
    padding: 8,
  },
  dateText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
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
  transcriptBox: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    padding: 16,
  },
  transcriptText: {
    color: '#acaab0',
    fontSize: 14,
    lineHeight: 23,
  },
  highlightsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  highlightChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  highlightText: {
    fontSize: 12,
    color: '#ddd',
    fontWeight: '500',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  actionItemText: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  chatTimeline: {
    gap: 12,
  },
  chatBubbleContainer: {
    flexDirection: 'row',
    width: '100%',
  },
  userBubbleContainer: {
    justifyContent: 'flex-end',
  },
  assistantBubbleContainer: {
    justifyContent: 'flex-start',
  },
  chatBubble: {
    padding: 12,
    borderRadius: 12,
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: 'rgba(37,37,43,0.6)',
    borderBottomRightRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  assistantBubble: {
    backgroundColor: 'rgba(25,25,30,0.8)',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(74,248,227,0.1)',
  },
  userText: {
    color: '#fcf8fe',
    fontSize: 14,
    lineHeight: 20,
  },
  assistantText: {
    color: '#acaab0',
    fontSize: 14,
    lineHeight: 20,
  },
  chatTime: {
    fontSize: 9,
    color: '#555',
    marginTop: 4,
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  archiveBtn: {
    backgroundColor: 'rgba(199, 153, 255, 0.05)',
    borderColor: 'rgba(199, 153, 255, 0.15)',
  },
  deleteBtn: {
    backgroundColor: 'rgba(252, 165, 165, 0.05)',
    borderColor: 'rgba(252, 165, 165, 0.15)',
  },
  actionBtnText: {
    fontWeight: '600',
    fontSize: 14,
  },
  deleteBtnText: {
    color: '#fca5a5',
  },
  // ─── Intelligence Section Styles ───
  intelSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 4,
  },
  intelSectionLabel: {
    marginBottom: 0,
  },
  intelCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  intelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  intelDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
  },
  intelRowText: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 21,
    flex: 1,
  },
  deadlineText: {
    color: '#fca5a5',
    fontWeight: '600',
  },
  assignmentRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  ownerBadge: {
    backgroundColor: 'rgba(74,248,227,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,248,227,0.2)',
  },
  ownerBadgeText: {
    color: '#4af8e3',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  participantChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  participantChip: {
    backgroundColor: 'rgba(167,139,250,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.2)',
  },
  participantChipText: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '600',
  },
});
