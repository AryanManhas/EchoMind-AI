import { useMemo, useRef } from 'react';
import type { ReminderTask } from './useReminderEngine';
import type { ConversationIntelligence } from './useConversationIntelligence';

export type ConversationContinuationSnapshot = {
  snapshotId: string;
  threadId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  activeTopics: string[];
  unresolvedTasks: string[];
  pendingReminders: string[];
  recentDecisions: string[];
  participants: string[];
  followUps: string[];
  importantContext: string[];
  continuationSummary: string;
  emotionalToneHint: string;
  lastInteractionAt: number;
  continuationScore: number;
  urgencyScore: number;
  relevanceScore: number;
};

export type ContinuationMemoryLike = {
  id: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number;
  sessionTitle?: string;
  semanticSummary?: string;
  sessionType?: string;
  highlights?: string[];
  participants?: string[];
  reminders?: string[];
  extractedTasks?: string[];
  tags?: string[];
  conversationIntelligence?: ConversationIntelligence[];
  continuationSnapshot?: ConversationContinuationSnapshot;
};

export type ConversationThread = {
  threadId: string;
  title: string;
  sessions: ContinuationMemoryLike[];
  latestSnapshot: ConversationContinuationSnapshot;
};

export type ConversationContinuationResult = {
  continuationIntent: boolean;
  prompt: string | null;
  contextText: string;
  activeSnapshot: ConversationContinuationSnapshot | null;
  relevantThreads: ConversationThread[];
  snapshotsBySessionId: Record<string, ConversationContinuationSnapshot>;
  diagnostics: {
    relevanceScore: number;
    continuationScore: number;
    threadCount: number;
    contextSize: number;
  };
};

export type UseConversationContinuationInput = {
  query: string;
  memories: ContinuationMemoryLike[];
  reminders: ReminderTask[];
  currentIntelligence?: ConversationIntelligence[];
  maxThreads?: number;
  maxContextCharacters?: number;
};

const CONTINUATION_PHRASE =
  /\b(continue from|resume|where were we|pick up where we left off|continue project|continue discussion|same topic|from yesterday|last time|carry on|follow up on)\b/i;
const TONE_URGENT = /\b(urgent|asap|critical|blocked|deadline|overdue|stuck)\b/i;
const TONE_PLANNING = /\b(plan|planning|review|prepare|discuss|strategy|roadmap)\b/i;

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, maxLength: number): string {
  const clean = compact(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | undefined | null>, limit: number): string[] {
  return Array.from(new Set(values.map(value => compact(value || '')).filter(Boolean))).slice(0, limit);
}

function normalizeTopic(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
}

function fallbackTopic(memory: ContinuationMemoryLike): string {
  return memory.tags?.[0] || memory.sessionTitle || memory.semanticSummary || memory.sessionType || 'general';
}

function intelligenceOf(memory: ContinuationMemoryLike): ConversationIntelligence[] {
  return memory.conversationIntelligence || [];
}

function activeTopicsFor(memory: ContinuationMemoryLike): string[] {
  return unique([
    ...(memory.tags || []),
    ...intelligenceOf(memory).flatMap(item => item.discussedTopics),
    fallbackTopic(memory),
  ], 8);
}

function unresolvedTasksFor(memory: ContinuationMemoryLike): string[] {
  return unique([
    ...(memory.extractedTasks || []),
    ...intelligenceOf(memory).flatMap(item => [...item.tasks, ...item.actionItems]),
  ], 8);
}

function pendingRemindersFor(memory: ContinuationMemoryLike, reminders: ReminderTask[]): string[] {
  const linked = reminders
    .filter(reminder => reminder.sourceSessionId === memory.sessionId)
    .filter(reminder => reminder.state === 'pending' || reminder.state === 'scheduled' || reminder.state === 'triggered')
    .map(reminder => reminder.title);
  return unique([...(memory.reminders || []), ...linked], 8);
}

function emotionalTone(text: string): string {
  if (TONE_URGENT.test(text)) return 'urgent';
  if (TONE_PLANNING.test(text)) return 'planning';
  return 'steady';
}

function threadIdFor(memory: ContinuationMemoryLike): string {
  const topic = activeTopicsFor(memory)[0] || 'general';
  return `thread-${normalizeTopic(topic) || 'general'}`;
}

function scoreSnapshot(input: {
  unresolvedTasks: string[];
  pendingReminders: string[];
  followUps: string[];
  recentDecisions: string[];
  importantContext: string[];
  urgencyScore: number;
}): number {
  return Math.min(
    input.unresolvedTasks.length * 14 +
      input.pendingReminders.length * 18 +
      input.followUps.length * 12 +
      input.recentDecisions.length * 8 +
      input.importantContext.length * 6 +
      Math.round(input.urgencyScore / 5),
    100
  );
}

export function createContinuationSnapshotFromMemory(
  memory: ContinuationMemoryLike,
  reminders: ReminderTask[] = []
): ConversationContinuationSnapshot {
  const intelligence = intelligenceOf(memory);
  const activeTopics = activeTopicsFor(memory);
  const unresolvedTasks = unresolvedTasksFor(memory);
  const pendingReminders = pendingRemindersFor(memory, reminders);
  const recentDecisions = unique(intelligence.flatMap(item => item.decisions), 6);
  const participants = unique([...(memory.participants || []), ...intelligence.flatMap(item => item.participants)], 8);
  const followUps = unique(intelligence.flatMap(item => item.followUps), 6);
  const importantContext = unique([...(memory.highlights || []), ...intelligence.flatMap(item => item.importantPoints)], 8);
  const urgencyScore = Math.min(
    Math.max(...intelligence.map(item => item.urgencyScore), 0) +
      pendingReminders.length * 10 +
      unresolvedTasks.filter(task => /urgent|asap|deadline|today|tomorrow/i.test(task)).length * 12,
    100
  );
  const continuationScore = scoreSnapshot({
    unresolvedTasks,
    pendingReminders,
    followUps,
    recentDecisions,
    importantContext,
    urgencyScore,
  });
  const summaryParts = [
    activeTopics[0] ? `Active topic: ${activeTopics[0]}` : '',
    unresolvedTasks[0] ? `Unresolved: ${unresolvedTasks[0]}` : '',
    recentDecisions[0] ? `Decision: ${recentDecisions[0]}` : '',
    pendingReminders[0] ? `Reminder: ${pendingReminders[0]}` : '',
  ].filter(Boolean);

  return {
    snapshotId: `${memory.sessionId}:continuation`,
    threadId: memory.continuationSnapshot?.threadId || threadIdFor(memory),
    sessionId: memory.sessionId,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt || memory.finalizedAt || memory.createdAt,
    activeTopics,
    unresolvedTasks,
    pendingReminders,
    recentDecisions,
    participants,
    followUps,
    importantContext,
    continuationSummary: clip(summaryParts.join('  ·  ') || memory.semanticSummary || memory.sessionTitle || 'Conversation thread', 220),
    emotionalToneHint: emotionalTone([memory.semanticSummary, ...importantContext, ...unresolvedTasks].join(' ')),
    lastInteractionAt: memory.finalizedAt || memory.updatedAt || memory.createdAt,
    continuationScore,
    urgencyScore,
    relevanceScore: 0,
  };
}

function tokenize(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(token => token.length > 2)));
}

function overlapScore(query: string, snapshot: ConversationContinuationSnapshot): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const searchText = [
    ...snapshot.activeTopics,
    ...snapshot.unresolvedTasks,
    ...snapshot.pendingReminders,
    ...snapshot.recentDecisions,
    ...snapshot.participants,
    ...snapshot.followUps,
    ...snapshot.importantContext,
  ].join(' ').toLowerCase();
  return queryTokens.filter(token => searchText.includes(token)).length * 12;
}

function buildThreads(memories: ContinuationMemoryLike[], reminders: ReminderTask[]): ConversationThread[] {
  const groups = new Map<string, ContinuationMemoryLike[]>();
  for (const memory of memories) {
    const snapshot = memory.continuationSnapshot || createContinuationSnapshotFromMemory(memory, reminders);
    const threadId = snapshot.threadId;
    groups.set(threadId, [...(groups.get(threadId) || []), memory]);
  }

  return Array.from(groups.entries()).map(([threadId, sessions]) => {
    const sorted = [...sessions].sort((a, b) => (b.finalizedAt || b.updatedAt) - (a.finalizedAt || a.updatedAt));
    const latestSnapshot = sorted[0].continuationSnapshot || createContinuationSnapshotFromMemory(sorted[0], reminders);
    return {
      threadId,
      title: latestSnapshot.activeTopics[0] || sorted[0].sessionTitle || 'Conversation Thread',
      sessions: sorted,
      latestSnapshot,
    };
  }).sort((a, b) => b.latestSnapshot.lastInteractionAt - a.latestSnapshot.lastInteractionAt);
}

function createPrompt(snapshot: ConversationContinuationSnapshot): string | null {
  if (snapshot.unresolvedTasks.length > 0) {
    return `Continue ${snapshot.activeTopics[0] || 'this thread'}? ${snapshot.unresolvedTasks.length} unresolved task${snapshot.unresolvedTasks.length === 1 ? '' : 's'} remain.`;
  }
  if (snapshot.pendingReminders.length > 0) {
    return `Resume ${snapshot.activeTopics[0] || 'this thread'}? You still have ${snapshot.pendingReminders.length} pending reminder${snapshot.pendingReminders.length === 1 ? '' : 's'}.`;
  }
  if (snapshot.recentDecisions.length > 0) {
    return `Pick up from the last ${snapshot.activeTopics[0] || 'discussion'} decision?`;
  }
  return null;
}

export function buildContinuationPayload(input: UseConversationContinuationInput): ConversationContinuationResult {
  const maxThreads = input.maxThreads || 3;
  const maxContextCharacters = input.maxContextCharacters || 1200;
  const continuationIntent = CONTINUATION_PHRASE.test(input.query);
  const snapshots = input.memories.map(memory => memory.continuationSnapshot || createContinuationSnapshotFromMemory(memory, input.reminders));
  const currentTopics = unique(input.currentIntelligence?.flatMap(item => item.discussedTopics) || [], 6);
  const currentParticipants = unique(input.currentIntelligence?.flatMap(item => item.participants) || [], 6);

  const scoredSnapshots = snapshots.map(snapshot => {
    const topicOverlap = currentTopics.filter(topic => snapshot.activeTopics.some(active => active.toLowerCase().includes(topic.toLowerCase()) || topic.toLowerCase().includes(active.toLowerCase()))).length * 22;
    const participantOverlap = currentParticipants.filter(person => snapshot.participants.some(p => p.toLowerCase() === person.toLowerCase())).length * 14;
    const relevanceScore = Math.min(overlapScore(input.query, snapshot) + topicOverlap + participantOverlap + Math.round(snapshot.continuationScore / 4), 100);
    return { ...snapshot, relevanceScore };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore || b.lastInteractionAt - a.lastInteractionAt);

  const activeSnapshot = scoredSnapshots[0] || null;
  const shouldInject = continuationIntent || (activeSnapshot?.relevanceScore || 0) >= 42;
  const threads = buildThreads(input.memories, input.reminders)
    .filter(thread => scoredSnapshots.slice(0, maxThreads).some(snapshot => snapshot.threadId === thread.threadId))
    .slice(0, maxThreads);

  const contextBlocks: string[] = [];
  if (shouldInject) {
    for (const snapshot of scoredSnapshots.slice(0, maxThreads)) {
      const block = [
        `Thread: ${snapshot.activeTopics[0] || snapshot.threadId}`,
        snapshot.continuationSummary,
        snapshot.unresolvedTasks.length ? `Unresolved: ${snapshot.unresolvedTasks.slice(0, 3).join('; ')}` : '',
        snapshot.pendingReminders.length ? `Pending reminders: ${snapshot.pendingReminders.slice(0, 3).join('; ')}` : '',
        snapshot.recentDecisions.length ? `Recent decisions: ${snapshot.recentDecisions.slice(0, 2).join('; ')}` : '',
        snapshot.followUps.length ? `Follow-ups: ${snapshot.followUps.slice(0, 2).join('; ')}` : '',
        snapshot.participants.length ? `Participants: ${snapshot.participants.slice(0, 4).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      const next = [...contextBlocks, block].join('\n\n');
      if (next.length > maxContextCharacters) break;
      contextBlocks.push(block);
    }
  }

  const contextText = contextBlocks.join('\n\n');
  const snapshotsBySessionId = scoredSnapshots.reduce<Record<string, ConversationContinuationSnapshot>>((acc, snapshot) => {
    acc[snapshot.sessionId] = snapshot;
    return acc;
  }, {});

  return {
    continuationIntent,
    prompt: activeSnapshot ? createPrompt(activeSnapshot) : null,
    contextText,
    activeSnapshot,
    relevantThreads: threads,
    snapshotsBySessionId,
    diagnostics: {
      relevanceScore: activeSnapshot?.relevanceScore || 0,
      continuationScore: activeSnapshot?.continuationScore || 0,
      threadCount: threads.length,
      contextSize: contextText.length,
    },
  };
}

export function useConversationContinuation(input: UseConversationContinuationInput): ConversationContinuationResult {
  const cacheRef = useRef<{ key: string; result: ConversationContinuationResult } | null>(null);
  const key = [
    input.query,
    input.memories.map(memory => `${memory.sessionId}:${memory.updatedAt}:${memory.continuationSnapshot?.updatedAt || 0}`).join('|'),
    input.reminders.map(reminder => `${reminder.id}:${reminder.state}:${reminder.updatedAt}`).join('|'),
    input.currentIntelligence?.map(item => `${item.intelligenceId}:${item.importanceScore}:${item.urgencyScore}`).join('|') || '',
  ].join('::');

  return useMemo(() => {
    if (cacheRef.current?.key === key) return cacheRef.current.result;
    const result = buildContinuationPayload(input);
    cacheRef.current = { key, result };
    return result;
  }, [input, key]);
}
