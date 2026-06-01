import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { ConversationMemory } from './usePersistentMemory';
import type { ReminderTask } from './useReminderEngine';
import type { KnowledgeGraphSnapshot } from './useKnowledgeGraph';

export type ProactiveSignalType =
  | 'unresolved_task'
  | 'overdue_reminder'
  | 'continuation_prompt'
  | 'project_followup'
  | 'recurring_topic'
  | 'deadline_warning'
  | 'collaborator_followup'
  | 'daily_digest';

export type ProactiveSignal = {
  signalId: string;
  signalType: ProactiveSignalType;
  createdAt: number;
  priority: number;
  confidenceScore: number;
  relatedEntityIds: string[];
  relatedSessionIds: string[];
  title: string;
  description: string;
  actionable: boolean;
  dismissed: boolean;
  expiresAt: number;
};

export type ProactiveAssistantSnapshot = {
  signals: ProactiveSignal[];
  topSignals: ProactiveSignal[];
  prompts: string[];
  dailyDigest: string;
  contextText: string;
  diagnostics: {
    signalCount: number;
    actionableCount: number;
    overdueCount: number;
    digestSize: number;
    bounded: boolean;
  };
};

export type ProactiveAssistantLimits = {
  maxSignals: number;
  maxSignalsPerType: number;
  maxPrompts: number;
  maxContextCharacters: number;
  maxDigestItems: number;
  notificationCooldownMs: number;
};

export type UseProactiveAssistantInput = {
  memories: ConversationMemory[];
  reminders: ReminderTask[];
  knowledgeGraph: KnowledgeGraphSnapshot;
  activeTranscript?: string;
  enableNotifications?: boolean;
  limits?: Partial<ProactiveAssistantLimits>;
};

const DISMISSED_STORAGE_KEY = '@EchoMind:ProactiveDismissedSignals';
const NOTIFICATION_STATE_KEY = '@EchoMind:ProactiveNotificationState';
const PROACTIVE_CHANNEL_ID = 'proactive-assistant';
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

const DEFAULT_LIMITS: ProactiveAssistantLimits = {
  maxSignals: 18,
  maxSignalsPerType: 4,
  maxPrompts: 3,
  maxContextCharacters: 760,
  maxDigestItems: 5,
  notificationCooldownMs: 6 * HOUR_MS,
};

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, maxLength = 140): string {
  const clean = compact(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function slug(value: string): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'signal';
}

function unique(values: Array<string | undefined | null>, limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = compact(value || '');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= limit) break;
  }
  return output;
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function signalId(type: ProactiveSignalType, key: string): string {
  return `pa:${type}:${slug(key)}`;
}

function createSignal(input: Omit<ProactiveSignal, 'priority' | 'confidenceScore'> & {
  priority: number;
  confidenceScore: number;
}): ProactiveSignal {
  return {
    ...input,
    priority: boundedScore(input.priority),
    confidenceScore: boundedScore(input.confidenceScore),
    relatedEntityIds: unique(input.relatedEntityIds, 10),
    relatedSessionIds: unique(input.relatedSessionIds, 10),
    title: clip(input.title, 86),
    description: clip(input.description, 180),
  };
}

function activeReminder(task: ReminderTask): boolean {
  return task.state === 'pending' || task.state === 'scheduled' || task.state === 'triggered';
}

function reminderPriority(task: ReminderTask, now: number): number {
  if (!task.scheduledFor) return task.state === 'triggered' ? 76 : 48;
  const delta = task.scheduledFor - now;
  if (delta <= -6 * HOUR_MS) return 94;
  if (delta <= 0) return 86;
  if (delta <= 2 * HOUR_MS) return 74;
  if (delta <= DAY_MS) return 62;
  return 42;
}

function formatRelativeDue(scheduledFor: number, now: number): string {
  const delta = scheduledFor - now;
  const absMinutes = Math.max(1, Math.round(Math.abs(delta) / 60000));
  if (absMinutes < 60) return delta < 0 ? `${absMinutes} min overdue` : `due in ${absMinutes} min`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return delta < 0 ? `${hours} hour${hours === 1 ? '' : 's'} overdue` : `due in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return delta < 0 ? `${days} day${days === 1 ? '' : 's'} overdue` : `due in ${days} day${days === 1 ? '' : 's'}`;
}

function memorySessionIds(memories: ConversationMemory[], memoryIds: string[]): string[] {
  const byId = new Map(memories.map(memory => [memory.id, memory.sessionId]));
  return unique(memoryIds.map(memoryId => byId.get(memoryId)), 10);
}

function dismissedLookup(dismissedIds?: string[]): Set<string> {
  return new Set(dismissedIds || []);
}

function dedupeAndRankSignals(
  signals: ProactiveSignal[],
  limits: ProactiveAssistantLimits
): ProactiveSignal[] {
  const byId = new Map<string, ProactiveSignal>();
  for (const signal of signals) {
    const existing = byId.get(signal.signalId);
    if (!existing || signal.priority > existing.priority || signal.createdAt >= existing.createdAt) {
      byId.set(signal.signalId, signal);
    }
  }

  const perType = new Map<ProactiveSignalType, number>();
  return Array.from(byId.values())
    .filter(signal => signal.expiresAt > Date.now())
    .sort((a, b) => b.priority - a.priority || b.confidenceScore - a.confidenceScore || b.createdAt - a.createdAt)
    .filter(signal => {
      const count = perType.get(signal.signalType) || 0;
      if (count >= limits.maxSignalsPerType) return false;
      perType.set(signal.signalType, count + 1);
      return true;
    })
    .slice(0, limits.maxSignals);
}

function buildDigest(signals: ProactiveSignal[], limits: ProactiveAssistantLimits): string {
  const active = signals.filter(signal => !signal.dismissed);
  if (active.length === 0) return 'Today is clear. No urgent follow-ups are waiting.';
  const lines = active.slice(0, limits.maxDigestItems).map(signal => `- ${signal.title}`);
  return [`Today: ${active.length} active signal${active.length === 1 ? '' : 's'}.`, ...lines].join('\n');
}

function buildContext(signals: ProactiveSignal[], digest: string, limits: ProactiveAssistantLimits): string {
  const blocks = signals
    .filter(signal => !signal.dismissed)
    .slice(0, 6)
    .map(signal => `${signal.signalType}: ${signal.title} - ${signal.description}`);
  const context = [digest, ...blocks].join('\n');
  return context.length > limits.maxContextCharacters
    ? `${context.slice(0, Math.max(0, limits.maxContextCharacters - 3)).trim()}...`
    : context;
}

function promptFor(signal: ProactiveSignal): string {
  switch (signal.signalType) {
    case 'overdue_reminder':
      return signal.title;
    case 'deadline_warning':
      return signal.title;
    case 'collaborator_followup':
      return signal.title;
    case 'project_followup':
    case 'continuation_prompt':
      return signal.title.endsWith('?') ? signal.title : `${signal.title}?`;
    default:
      return signal.description || signal.title;
  }
}

export function buildProactiveAssistantSnapshot(input: {
  memories: ConversationMemory[];
  reminders: ReminderTask[];
  knowledgeGraph: KnowledgeGraphSnapshot;
  activeTranscript?: string;
  dismissedSignalIds?: string[];
  limits?: Partial<ProactiveAssistantLimits>;
  now?: number;
}): ProactiveAssistantSnapshot {
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) };
  const now = input.now || Date.now();
  const dismissed = dismissedLookup(input.dismissedSignalIds);
  const signals: ProactiveSignal[] = [];

  // Real-time transcript keyword triggers (FINAL TOUCH 10)
  if (input.activeTranscript) {
    const lowerTranscript = input.activeTranscript.toLowerCase();

    if (lowerTranscript.includes('meeting') || lowerTranscript.includes('sync') || lowerTranscript.includes('call')) {
      const id = 'pa:dynamic:meeting-prep';
      if (!dismissed.has(id)) {
        signals.push(createSignal({
          signalId: id,
          signalType: 'project_followup',
          createdAt: now,
          priority: 85,
          confidenceScore: 90,
          relatedEntityIds: [],
          relatedSessionIds: [],
          title: 'Prepare for meeting',
          description: 'Would you like to review previous sync notes or schedule prep time?',
          actionable: true,
          dismissed: false,
          expiresAt: now + HOUR_MS,
        }));
      }
    }

    if (lowerTranscript.includes('deadline') || lowerTranscript.includes('due') || lowerTranscript.includes('by tomorrow') || lowerTranscript.includes('schedule')) {
      const id = 'pa:dynamic:deadline-tracker';
      if (!dismissed.has(id)) {
        signals.push(createSignal({
          signalId: id,
          signalType: 'deadline_warning',
          createdAt: now,
          priority: 88,
          confidenceScore: 95,
          relatedEntityIds: [],
          relatedSessionIds: [],
          title: 'Set deadline reminder',
          description: 'Detected a time-sensitive event. Tap to set an EchoMind reminder.',
          actionable: true,
          dismissed: false,
          expiresAt: now + HOUR_MS,
        }));
      }
    }

    if (lowerTranscript.includes('task') || lowerTranscript.includes('need to') || lowerTranscript.includes('must')) {
      const id = 'pa:dynamic:task-tracker';
      if (!dismissed.has(id)) {
        signals.push(createSignal({
          signalId: id,
          signalType: 'unresolved_task',
          createdAt: now,
          priority: 80,
          confidenceScore: 85,
          relatedEntityIds: [],
          relatedSessionIds: [],
          title: 'Add to task list',
          description: 'Detected an actionable item. Tap to track under follow-ups.',
          actionable: true,
          dismissed: false,
          expiresAt: now + HOUR_MS,
        }));
      }
    }

    if (lowerTranscript.includes('rahul')) {
      const id = 'pa:dynamic:rahul-sync-prep';
      if (!dismissed.has(id)) {
        signals.push(createSignal({
          signalId: id,
          signalType: 'collaborator_followup',
          createdAt: now,
          priority: 90,
          confidenceScore: 95,
          relatedEntityIds: [],
          relatedSessionIds: [],
          title: 'Sync details for Rahul',
          description: 'Review Rahul\'s assignments and placement preparation checklist.',
          actionable: true,
          dismissed: false,
          expiresAt: now + HOUR_MS,
        }));
      }
    }
  }

  for (const task of input.reminders.filter(activeReminder).slice(0, 80)) {
    if (task.scheduledFor && task.scheduledFor <= now) {
      const id = signalId('overdue_reminder', task.id);
      signals.push(createSignal({
        signalId: id,
        signalType: 'overdue_reminder',
        createdAt: task.updatedAt || task.createdAt,
        priority: reminderPriority(task, now),
        confidenceScore: task.confidence * 100,
        relatedEntityIds: [],
        relatedSessionIds: [task.sourceSessionId],
        title: `${clip(task.title, 58)} is ${formatRelativeDue(task.scheduledFor, now)}`,
        description: task.description || 'A reminder is waiting for attention.',
        actionable: true,
        dismissed: dismissed.has(id),
        expiresAt: now + DAY_MS,
      }));
    } else if (task.scheduledFor && task.scheduledFor - now <= DAY_MS) {
      const id = signalId('deadline_warning', task.id);
      signals.push(createSignal({
        signalId: id,
        signalType: 'deadline_warning',
        createdAt: task.updatedAt || task.createdAt,
        priority: reminderPriority(task, now),
        confidenceScore: task.confidence * 100,
        relatedEntityIds: [],
        relatedSessionIds: [task.sourceSessionId],
        title: `${clip(task.title, 62)} is ${formatRelativeDue(task.scheduledFor, now)}`,
        description: 'Upcoming reminder detected from your saved conversation.',
        actionable: true,
        dismissed: dismissed.has(id),
        expiresAt: task.scheduledFor + HOUR_MS,
      }));
    }
  }

  for (const project of input.knowledgeGraph.projectTimelines) {
    const unresolved = project.unresolvedTasks.slice(0, 4);
    if (unresolved.length > 0) {
      const id = signalId('unresolved_task', `${project.projectId}:${unresolved.join('|')}`);
      signals.push(createSignal({
        signalId: id,
        signalType: 'unresolved_task',
        createdAt: project.lastInteractionAt,
        priority: 54 + unresolved.length * 7 + Math.round(project.continuityScore / 8),
        confidenceScore: Math.min(92, 62 + unresolved.length * 8),
        relatedEntityIds: [project.projectId],
        relatedSessionIds: project.sessionIds,
        title: `${unresolved.length} unresolved ${project.title.toLowerCase()} item${unresolved.length === 1 ? '' : 's'} remain`,
        description: unresolved.map(item => clip(item, 70)).join('; '),
        actionable: true,
        dismissed: dismissed.has(id),
        expiresAt: now + 3 * DAY_MS,
      }));
    }

    const stalledForMs = now - project.lastInteractionAt;
    if (stalledForMs >= 2 * DAY_MS && (unresolved.length > 0 || project.reminders.length > 0)) {
      const id = signalId('project_followup', project.projectId);
      signals.push(createSignal({
        signalId: id,
        signalType: 'project_followup',
        createdAt: project.lastInteractionAt,
        priority: 48 + Math.min(24, Math.floor(stalledForMs / DAY_MS) * 4) + Math.round(project.continuityScore / 10),
        confidenceScore: 78,
        relatedEntityIds: [project.projectId],
        relatedSessionIds: project.sessionIds,
        title: `Resume ${project.title} thread?`,
        description: project.reminders[0] || project.unresolvedTasks[0] || 'This project has been quiet with open work.',
        actionable: true,
        dismissed: dismissed.has(id),
        expiresAt: now + 2 * DAY_MS,
      }));
    }

    if (project.continuityScore >= 45) {
      const id = signalId('continuation_prompt', project.projectId);
      signals.push(createSignal({
        signalId: id,
        signalType: 'continuation_prompt',
        createdAt: project.lastInteractionAt,
        priority: 40 + Math.round(project.continuityScore / 3),
        confidenceScore: 74,
        relatedEntityIds: [project.projectId],
        relatedSessionIds: project.sessionIds,
        title: `Continue ${project.title}?`,
        description: project.decisions[0] || project.unresolvedTasks[0] || 'Project continuity is available.',
        actionable: true,
        dismissed: dismissed.has(id),
        expiresAt: now + DAY_MS,
      }));
    }
  }

  for (const participant of input.knowledgeGraph.participants) {
    if (participant.assignments.length === 0) continue;
    const id = signalId('collaborator_followup', `${participant.entityId}:${participant.assignments[0]}`);
    signals.push(createSignal({
      signalId: id,
      signalType: 'collaborator_followup',
      createdAt: participant.lastInteractionAt,
      priority: 50 + Math.min(20, participant.interactionCount * 3),
      confidenceScore: 76,
      relatedEntityIds: [participant.entityId],
      relatedSessionIds: [],
      title: `${participant.name} still owns ${clip(participant.assignments[0], 46)}`,
      description: participant.projects.length ? `Connected to ${participant.projects.slice(0, 2).join(', ')}.` : 'Collaborator assignment remains open.',
      actionable: true,
      dismissed: dismissed.has(id),
      expiresAt: now + 2 * DAY_MS,
    }));
  }

  for (const topic of input.knowledgeGraph.recurringTopics) {
    if (topic.mentionCount < 3) continue;
    const id = signalId('recurring_topic', topic.entityId);
    signals.push(createSignal({
      signalId: id,
      signalType: 'recurring_topic',
      createdAt: topic.lastMentionedAt,
      priority: 34 + Math.min(28, topic.mentionCount * 5),
      confidenceScore: 68 + Math.min(20, topic.mentionCount * 3),
      relatedEntityIds: [topic.entityId],
      relatedSessionIds: topic.sessionIds,
      title: `${topic.name} keeps coming up`,
      description: `Discussed across ${topic.mentionCount} session${topic.mentionCount === 1 ? '' : 's'}.`,
      actionable: false,
      dismissed: dismissed.has(id),
      expiresAt: now + 3 * DAY_MS,
    }));
  }

  const activeSignals = dedupeAndRankSignals(signals, limits);
  if (activeSignals.length > 0) {
    const id = signalId('daily_digest', new Date(now).toISOString().slice(0, 10));
    activeSignals.push(createSignal({
      signalId: id,
      signalType: 'daily_digest',
      createdAt: now,
      priority: Math.min(72, 34 + activeSignals.filter(signal => signal.actionable).length * 6),
      confidenceScore: 82,
      relatedEntityIds: unique(activeSignals.flatMap(signal => signal.relatedEntityIds), 12),
      relatedSessionIds: unique(activeSignals.flatMap(signal => signal.relatedSessionIds), 12),
      title: 'Daily context digest is ready',
      description: activeSignals.slice(0, limits.maxDigestItems).map(signal => signal.title).join('; '),
      actionable: false,
      dismissed: dismissed.has(id),
      expiresAt: now + DAY_MS,
    }));
  }

  const rankedSignals = dedupeAndRankSignals(activeSignals, limits);
  const topSignals = rankedSignals.filter(signal => !signal.dismissed).slice(0, Math.min(6, limits.maxSignals));
  const prompts = topSignals.filter(signal => signal.priority >= 52).map(promptFor).slice(0, limits.maxPrompts);
  const dailyDigest = buildDigest(rankedSignals, limits);
  const contextText = buildContext(topSignals, dailyDigest, limits);

  return {
    signals: rankedSignals,
    topSignals,
    prompts,
    dailyDigest,
    contextText,
    diagnostics: {
      signalCount: rankedSignals.length,
      actionableCount: rankedSignals.filter(signal => signal.actionable && !signal.dismissed).length,
      overdueCount: rankedSignals.filter(signal => signal.signalType === 'overdue_reminder' && !signal.dismissed).length,
      digestSize: dailyDigest.length,
      bounded: signals.length > rankedSignals.length,
    },
  };
}

async function loadDismissedSignalIds(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(-80) : [];
  } catch {
    return [];
  }
}

async function ensureProactiveChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(PROACTIVE_CHANNEL_ID, {
    name: 'Assistant nudges',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 120],
    lightColor: '#C799FF',
  });
}

async function scheduleGroupedNotification(
  snapshot: ProactiveAssistantSnapshot,
  limits: ProactiveAssistantLimits
): Promise<void> {
  const candidate = snapshot.topSignals.find(signal =>
    signal.actionable &&
    !signal.dismissed &&
    signal.priority >= 75 &&
    (signal.signalType === 'overdue_reminder' || signal.signalType === 'deadline_warning' || signal.signalType === 'project_followup')
  );
  if (!candidate) return;

  const now = Date.now();
  const data = await AsyncStorage.getItem(NOTIFICATION_STATE_KEY);
  const state = data ? JSON.parse(data) as { lastSentAt?: number; lastSignalId?: string } : {};
  if (state.lastSignalId === candidate.signalId) return;
  if (state.lastSentAt && now - state.lastSentAt < limits.notificationCooldownMs) return;

  try {
    await ensureProactiveChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: candidate.title,
        body: candidate.description || 'EchoMind has a quiet follow-up ready.',
        data: {
          signalId: candidate.signalId,
          signalType: candidate.signalType,
          relatedSessionIds: candidate.relatedSessionIds,
        },
      },
      trigger: null,
    });
    await AsyncStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify({
      lastSentAt: now,
      lastSignalId: candidate.signalId,
    }));
  } catch (e) {
    if (__DEV__) console.warn('[ProactiveAssistant] Failed to schedule notification', e);
  }
}

export function useProactiveAssistant(input: UseProactiveAssistantInput): ProactiveAssistantSnapshot & {
  dismissSignal: (signalId: string) => Promise<void>;
} {
  const limits = useMemo(() => ({ ...DEFAULT_LIMITS, ...(input.limits || {}) }), [input.limits]);
  const [dismissedSignalIds, setDismissedSignalIds] = useState<string[]>([]);
  const notificationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadDismissedSignalIds().then(ids => {
      if (mounted) setDismissedSignalIds(ids);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const snapshot = useMemo(() => buildProactiveAssistantSnapshot({
    memories: input.memories,
    reminders: input.reminders,
    knowledgeGraph: input.knowledgeGraph,
    activeTranscript: input.activeTranscript,
    dismissedSignalIds,
    limits,
  }), [dismissedSignalIds, input.knowledgeGraph, input.memories, input.reminders, input.activeTranscript, limits]);

  useEffect(() => {
    if (!input.enableNotifications) return;
    const key = snapshot.topSignals.map(signal => `${signal.signalId}:${signal.priority}:${signal.dismissed}`).join('|');
    if (notificationKeyRef.current === key) return;
    notificationKeyRef.current = key;
    void scheduleGroupedNotification(snapshot, limits);
  }, [input.enableNotifications, limits, snapshot]);

  const dismissSignal = useCallback(async (id: string) => {
    setDismissedSignalIds(prev => {
      const next = unique([...prev, id], 80);
      AsyncStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next)).catch(e => {
        if (__DEV__) console.warn('[ProactiveAssistant] Failed to persist dismissal', e);
      });
      return next;
    });
  }, []);

  return {
    ...snapshot,
    dismissSignal,
  };
}
