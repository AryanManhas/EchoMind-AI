import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, SectionList, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Flame } from 'lucide-react-native';
import { ReminderCard, type ReminderSemanticType, type ReminderUrgencyState } from '../../components/ReminderCard';
import { ReminderTask, useReminderEngine } from '../../hooks/useReminderEngine';
import { usePersistentMemory } from '../../hooks/usePersistentMemory';
import { useKnowledgeGraph } from '../../hooks/useKnowledgeGraph';
import { useProactiveAssistant } from '../../hooks/useProactiveAssistant';
import { differenceInCalendarDays, differenceInMinutes, format, formatDistanceToNowStrict, isToday, isTomorrow } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

type ReminderTab = 'command' | 'meetings' | 'completed';

type DashboardReminder = {
  id: string;
  title: string;
  dueAt: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  status: string;
  state: ReminderTask['state'];
  isCritical: boolean;
  sourceSessionId: string;
  semanticType: ReminderSemanticType;
  urgencyState: ReminderUrgencyState;
  participant?: string;
  countdownLabel: string;
  relativeTiming: string;
  dueLabel: string;
  accentColor: string;
  isLive: boolean;
  dueTime: number;
  priorityScore: number;
};

type ReminderSection = {
  title: string;
  subtitle: string;
  accentColor: string;
  data: DashboardReminder[];
};

const SEMANTIC_COLORS: Record<ReminderSemanticType, string> = {
  reminder: '#4af8e3',
  meeting: '#c799ff',
  deadline: '#fbbf24',
  overdue: '#f87171',
  completed: '#86efac',
};

const ACTIVE_STATES = new Set<ReminderTask['state']>(['pending', 'scheduled', 'triggered']);

export default function RemindersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { memories } = usePersistentMemory();
  const { tasks, reloadTasks, completeTask, dismissTask, deleteTask, clearTasks } = useReminderEngine(memories);
  const knowledgeGraph = useKnowledgeGraph({
    memories,
    reminders: tasks,
    limits: {
      maxContextCharacters: 520,
      maxProjects: 6,
      maxParticipants: 8,
      maxTopics: 8,
    },
  });
  const proactive = useProactiveAssistant({
    memories,
    reminders: tasks,
    knowledgeGraph,
    limits: {
      maxSignals: 14,
      maxPrompts: 2,
      maxContextCharacters: 420,
      maxDigestItems: 4,
    },
  });
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ReminderTab>('command');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setNow(Date.now());
    await reloadTasks();
    setRefreshing(false);
  }, [reloadTasks]);

  const handleComplete = useCallback(async (id: string) => {
    try {
      await completeTask(id);
    } catch (err) {
      console.warn('[RemindersUI] Failed to complete reminder:', err);
    }
  }, [completeTask]);

  const memoriesBySession = useMemo(() => {
    return memories.reduce<Record<string, any>>((acc, memory) => {
      acc[memory.sessionId] = memory;
      return acc;
    }, {});
  }, [memories]);

  const openSourceSession = useCallback((reminderId: string) => {
    const task = tasks.find(t => t.id === reminderId);
    const memory = task ? memoriesBySession[task.sourceSessionId] : null;
    if (!memory) return;

    const linkedTasks = tasks.filter(t => t.sourceSessionId === memory.sessionId);
    const transcript = memory.conversationChunks?.length
      ? memory.conversationChunks.slice(-3).map((chunk: { summary: string }) => chunk.summary).join(' ')
      : memory.semanticSummary || '';
    router.push({ pathname: '/detail', params: { id: memory.id, memory: JSON.stringify({
      id: memory.id,
      sessionId: memory.sessionId,
      title: memory.sessionTitle || memory.semanticSummary || 'Conversational Snapshot',
      semanticSummary: memory.semanticSummary || '',
      summary: transcript,
      category: memory.sessionType || 'general',
      importance: (memory.importanceScore || 0) / 100,
      importanceScore: memory.importanceScore || 0,
      createdAt: new Date(memory.createdAt).toISOString(),
      extractedTasks: memory.extractedTasks || [],
      reminders: memory.reminders || [],
      reminderTasks: linkedTasks,
      highlights: memory.highlights || [],
      conversationChunks: memory.conversationChunks || [],
      conversationIntelligence: memory.conversationIntelligence || [],
      continuationSnapshot: memory.continuationSnapshot,
      participants: memory.participants || [],
      semanticObjects: memory.semanticObjects || [],
      duration: memory.duration || 0,
      utteranceCount: memory.utteranceCount || 0,
      sourceReminderIds: memory.sourceReminderIds || [],
    }) } });
  }, [memoriesBySession, router, tasks]);

  const dashboardReminders = useMemo(() => {
    return tasks.map(task => mapTaskToDashboardReminder(task, now));
  }, [now, tasks]);

  const activeReminders = useMemo(() => {
    return dashboardReminders
      .filter(reminder => ACTIVE_STATES.has(reminder.state))
      .sort(sortByPriority);
  }, [dashboardReminders]);

  const completedReminders = useMemo(() => {
    return dashboardReminders
      .filter(reminder => reminder.state === 'completed')
      .sort((a, b) => b.dueTime - a.dueTime);
  }, [dashboardReminders]);

  const liveMeetings = useMemo(() => {
    return activeReminders.filter(reminder => reminder.isLive);
  }, [activeReminders]);

  const overdueReminders = useMemo(() => {
    return activeReminders.filter(reminder => reminder.urgencyState === 'overdue' && !reminder.isLive);
  }, [activeReminders]);

  const todayReminders = useMemo(() => {
    return activeReminders.filter(reminder =>
      reminder.urgencyState === 'due_today' &&
      !reminder.isLive &&
      reminder.semanticType !== 'meeting'
    );
  }, [activeReminders]);

  const upcomingReminders = useMemo(() => {
    return activeReminders.filter(reminder =>
      reminder.urgencyState === 'upcoming' &&
      reminder.semanticType !== 'meeting'
    );
  }, [activeReminders]);

  const upcomingMeetings = useMemo(() => {
    return activeReminders.filter(reminder =>
      reminder.semanticType === 'meeting' &&
      reminder.urgencyState === 'upcoming'
    );
  }, [activeReminders]);

  const activeTasks = useMemo(() => {
    return activeReminders.filter(reminder =>
      reminder.urgencyState === 'normal' ||
      (reminder.semanticType === 'reminder' && !reminder.dueAt)
    );
  }, [activeReminders]);

  const sections = useMemo<ReminderSection[]>(() => {
    if (activeTab === 'completed') {
      return compactSections([
        section('Completed', 'Finished reminders and tasks', SEMANTIC_COLORS.completed, completedReminders),
      ]);
    }

    if (activeTab === 'meetings') {
      return compactSections([
        section('Live Meetings', 'Active calls and timing windows', SEMANTIC_COLORS.meeting, liveMeetings),
        section('Upcoming Meetings', 'Scheduled calls and syncs', SEMANTIC_COLORS.meeting, upcomingMeetings),
        section('Meeting Deadlines', 'Follow-ups tied to conversations', SEMANTIC_COLORS.deadline, activeReminders.filter(item => item.semanticType === 'deadline')),
      ]);
    }

    return compactSections([
      section('Live Meetings', 'Meetings happening now', SEMANTIC_COLORS.meeting, liveMeetings),
      section('Overdue', 'Needs attention first', SEMANTIC_COLORS.overdue, overdueReminders),
      section('Today', 'Deadlines and reminders before midnight', SEMANTIC_COLORS.deadline, todayReminders),
      section('Upcoming Meetings', 'Calls and syncs coming next', SEMANTIC_COLORS.meeting, upcomingMeetings),
      section('Upcoming', 'Scheduled next', SEMANTIC_COLORS.reminder, upcomingReminders),
      section('Active Tasks', 'Open follow-ups without a hard deadline', SEMANTIC_COLORS.reminder, activeTasks),
    ]);
  }, [activeReminders, activeTab, activeTasks, completedReminders, liveMeetings, overdueReminders, todayReminders, upcomingMeetings, upcomingReminders]);

  const priorityItems = useMemo(() => {
    return activeReminders.slice(0, 3);
  }, [activeReminders]);

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.greeting}>Reminders</Text>
        <Text style={styles.subGreeting}>
          {activeReminders.length} active · {overdueReminders.length} overdue · {liveMeetings.length} live
        </Text>
      </View>
      {activeReminders.length > 0 && (
        <TouchableOpacity style={styles.clearButton} onPress={clearTasks}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderPriorityPanel = () => {
    if (priorityItems.length === 0) return null;

    return (
      <View style={styles.priorityPanel}>
        <View style={styles.priorityHeader}>
          <Flame size={16} color="#fbbf24" />
          <Text style={styles.priorityTitle}>Today’s priorities</Text>
        </View>
        {priorityItems.map(item => (
          <TouchableOpacity key={item.id} style={styles.priorityRow} onPress={() => openSourceSession(item.id)}>
            <View style={[styles.priorityDot, { backgroundColor: item.accentColor }]} />
            <Text style={styles.priorityText} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.priorityTime, { color: item.accentColor }]}>{item.countdownLabel}</Text>
          </TouchableOpacity>
        ))}
        {proactive.signals.length > 0 && (
          <Text style={styles.digestText} numberOfLines={2}>{proactive.dailyDigest}</Text>
        )}
      </View>
    );
  };

  const renderTabs = () => (
    <View style={styles.tabContainer}>
      {([
        ['command', 'Command'],
        ['meetings', 'Meetings'],
        ['completed', 'Done'],
      ] as Array<[ReminderTab, string]>).map(([value, label]) => (
        <TouchableOpacity
          key={value}
          onPress={() => setActiveTab(value)}
          style={[styles.tab, activeTab === value && styles.activeTab]}
        >
          <Text style={[styles.tabText, activeTab === value && styles.activeTabText]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={['rgba(199, 153, 255, 0.04)', 'rgba(74, 248, 227, 0.02)', 'transparent']}
        style={styles.bgGradient}
      />

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ReminderCard
            reminder={item}
            onComplete={handleComplete}
            onArchive={dismissTask}
            onDelete={deleteTask}
            onPress={openSourceSession}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: section.accentColor }]}>{section.title}</Text>
              <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
            </View>
            <Text style={[styles.sectionCount, { color: section.accentColor }]}>{section.data.length}</Text>
          </View>
        )}
        ListHeaderComponent={
          <>
            {renderHeader()}
            {renderPriorityPanel()}
            {renderTabs()}
          </>
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c799ff" />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Bell size={48} color="rgba(252, 248, 254, 0.12)" />
            <Text style={styles.emptyText}>
              {activeTab === 'completed' ? 'Nothing completed yet' : 'You’re all caught up.'}
            </Text>
            <Text style={styles.emptySubtext}>
              {activeTab === 'meetings'
                ? 'Meeting intelligence, deadlines, and follow-ups will appear here when EchoMind detects them.'
                : activeTab === 'completed'
                  ? 'Completed reminders will settle here.'
                  : 'No active reminders, deadlines, or live meetings need attention right now.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function section(title: string, subtitle: string, accentColor: string, data: DashboardReminder[]): ReminderSection {
  return { title, subtitle, accentColor, data };
}

function compactSections(sections: ReminderSection[]): ReminderSection[] {
  return sections.filter(item => item.data.length > 0);
}

function mapTaskToDashboardReminder(task: ReminderTask, now: number): DashboardReminder {
  const dueTime = task.scheduledFor || task.createdAt;
  const dueDate = new Date(dueTime);
  const hasSchedule = !!task.scheduledFor;
  const minutesUntil = Math.round((dueTime - now) / 60000);
  const isCompleted = task.state === 'completed';
  const isMeeting = task.type === 'meeting';
  const isLive = isMeeting && hasSchedule && minutesUntil <= 0 && minutesUntil > -60 && !isCompleted;
  const isOverdue = !isCompleted && hasSchedule && dueTime < now && !isLive;
  const semanticType = getSemanticType(task, isOverdue, isCompleted);
  const urgencyState = getUrgencyState({ isCompleted, isLive, isOverdue, dueDate, hasSchedule });
  const priority = getPriority(task);
  const participant = task.metadata.participants?.filter(Boolean).join(', ');

  return {
    id: task.id,
    title: task.title,
    dueAt: hasSchedule ? dueDate.toISOString() : new Date(task.createdAt).toISOString(),
    category: getCategoryLabel(task, semanticType),
    priority,
    status: isCompleted ? 'completed' : task.state,
    state: task.state,
    isCritical: semanticType === 'deadline' || semanticType === 'meeting' || priority === 'high',
    sourceSessionId: task.sourceSessionId,
    semanticType,
    urgencyState,
    participant,
    countdownLabel: getCountdownLabel(dueTime, now, isLive, isOverdue, hasSchedule),
    relativeTiming: getRelativeTiming(dueTime, now, hasSchedule),
    dueLabel: getDueLabel(dueDate, hasSchedule),
    accentColor: SEMANTIC_COLORS[semanticType],
    isLive,
    dueTime,
    priorityScore: getPriorityScore({ semanticType, urgencyState, priority, dueTime, now }),
  };
}

function getSemanticType(task: ReminderTask, isOverdue: boolean, isCompleted: boolean): ReminderSemanticType {
  if (isCompleted) return 'completed';
  if (isOverdue) return 'overdue';
  if (task.type === 'meeting') return 'meeting';
  if (task.type === 'calendar_event' || (task.type === 'follow_up' && task.scheduledFor)) return 'deadline';
  return 'reminder';
}

function getUrgencyState(input: {
  isCompleted: boolean;
  isLive: boolean;
  isOverdue: boolean;
  dueDate: Date;
  hasSchedule: boolean;
}): ReminderUrgencyState {
  if (input.isCompleted) return 'completed';
  if (input.isLive) return 'live';
  if (input.isOverdue) return 'overdue';
  if (input.hasSchedule && isToday(input.dueDate)) return 'due_today';
  if (input.hasSchedule) return 'upcoming';
  return 'normal';
}

function getPriority(task: ReminderTask): 'low' | 'medium' | 'high' {
  if (task.confidence >= 0.8 || task.state === 'triggered') return 'high';
  if (task.confidence >= 0.5) return 'medium';
  return 'low';
}

function getCategoryLabel(task: ReminderTask, semanticType: ReminderSemanticType): string {
  if (semanticType === 'overdue') return 'Overdue';
  if (semanticType === 'completed') return 'Completed';
  if (task.type === 'meeting') return 'Meeting';
  if (task.type === 'calendar_event') return 'Deadline';
  if (task.type === 'follow_up') return task.scheduledFor ? 'Deadline' : 'Follow Up';
  return 'Reminder';
}

function getCountdownLabel(dueTime: number, now: number, isLive: boolean, isOverdue: boolean, hasSchedule: boolean): string {
  if (!hasSchedule) return 'Open task';
  if (isLive) {
    const minutesRemaining = Math.max(1, 60 + differenceInMinutes(new Date(now), new Date(dueTime)) * -1);
    return `${minutesRemaining} min remaining`;
  }
  if (isOverdue) {
    return `Overdue by ${formatDistanceToNowStrict(new Date(dueTime))}`;
  }
  const minutesUntil = differenceInMinutes(new Date(dueTime), new Date(now));
  if (minutesUntil > 0 && minutesUntil <= 30) return `Starts in ${minutesUntil} min`;
  return `In ${formatDistanceToNowStrict(new Date(dueTime))}`;
}

function getRelativeTiming(dueTime: number, now: number, hasSchedule: boolean): string {
  if (!hasSchedule) return 'No fixed deadline';
  const dayDistance = differenceInCalendarDays(new Date(dueTime), new Date(now));
  if (dayDistance === 0) return `Today at ${format(new Date(dueTime), 'h:mm a')}`;
  if (dayDistance === 1) return 'Tomorrow';
  return format(new Date(dueTime), 'EEEE');
}

function getDueLabel(dueDate: Date, hasSchedule: boolean): string {
  if (!hasSchedule) return 'No fixed time';
  if (isToday(dueDate)) return `Today · ${format(dueDate, 'h:mm a')}`;
  if (isTomorrow(dueDate)) return `Tomorrow · ${format(dueDate, 'h:mm a')}`;
  return format(dueDate, 'EEE · h:mm a');
}

function getPriorityScore(input: {
  semanticType: ReminderSemanticType;
  urgencyState: ReminderUrgencyState;
  priority: 'low' | 'medium' | 'high';
  dueTime: number;
  now: number;
}): number {
  let score = 0;
  if (input.urgencyState === 'overdue') score += 1000;
  if (input.urgencyState === 'due_today') score += 700;
  if (input.urgencyState === 'live') score += 650;
  if (input.semanticType === 'meeting') score += 480;
  if (input.semanticType === 'deadline') score += 420;
  if (input.priority === 'high') score += 90;
  if (input.priority === 'medium') score += 40;
  score -= Math.max(0, input.dueTime - input.now) / 3_600_000;
  return score;
}

function sortByPriority(a: DashboardReminder, b: DashboardReminder): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  return a.dueTime - b.dueTime;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111115',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 40,
    marginBottom: 18,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 16,
  },
  greeting: {
    color: '#fcf8fe',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subGreeting: {
    color: 'rgba(252, 248, 254, 0.5)',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 2,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(252, 165, 165, 0.065)',
    borderWidth: 1,
    borderColor: 'rgba(252, 165, 165, 0.08)',
  },
  clearButtonText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700',
  },
  priorityPanel: {
    marginHorizontal: 20,
    marginBottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(199, 186, 255, 0.045)',
    borderWidth: 1,
    borderColor: 'rgba(199, 186, 255, 0.06)',
  },
  priorityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  priorityTitle: {
    color: 'rgba(247, 244, 251, 0.78)',
    fontSize: 13,
    fontWeight: '800',
  },
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
    gap: 9,
  },
  priorityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  priorityText: {
    color: 'rgba(247, 244, 251, 0.72)',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  priorityTime: {
    fontSize: 11,
    fontWeight: '800',
  },
  digestText: {
    color: 'rgba(247, 244, 251, 0.46)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 22,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.032)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  activeTab: {
    backgroundColor: 'rgba(199, 186, 255, 0.18)',
    borderColor: 'rgba(199, 186, 255, 0.28)',
  },
  tabText: {
    color: 'rgba(252, 248, 254, 0.5)',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: 'rgba(247, 244, 251, 0.88)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    color: 'rgba(252, 248, 254, 0.36)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '800',
    opacity: 0.8,
  },
  listContent: {
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyText: {
    color: '#fcf8fe',
    fontSize: 16,
    fontWeight: '700',
    opacity: 0.72,
  },
  emptySubtext: {
    color: 'rgba(252, 248, 254, 0.35)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
});
