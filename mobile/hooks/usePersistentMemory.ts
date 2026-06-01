import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationSessionSnapshot } from './useConversationSession';
import type { SemanticExtractionResult } from './useSemanticExtraction';
import {
  createConversationChunkFromTranscript,
  type ConversationChunk,
} from './useConversationChunking';
import {
  extractConversationIntelligence,
  type ConversationIntelligence,
} from './useConversationIntelligence';
import {
  createContinuationSnapshotFromMemory,
  type ConversationContinuationSnapshot,
} from './useConversationContinuation';

const MEMORY_STORAGE_KEY = '@EchoMind:ConversationMemory';
const MEMORY_BACKUP_KEY = '@EchoMind:ConversationMemory:Backup';
const MEMORY_CORRUPT_KEY = '@EchoMind:ConversationMemory:Corrupt';
const MEMORY_DELETED_SESSIONS_KEY = '@EchoMind:ConversationMemory:DeletedSessions';
const MAX_RESTORED_MEMORIES = 180;
const MAX_MEMORY_CHUNKS = 40;
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export type MemorySemanticObject = {
  type: string;
  confidence: number;
  datetime?: string;
  task?: string;
  participants?: string[];
};

export type ChatTurn = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
};

export type ConversationVaultEntry = {
  id: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number;
  mergedTranscript: string;
  semanticSummary: string;
  extractedTasks: string[];
  reminders: string[];
  highlights: string[];
  conversationChunks: ConversationChunk[];
  conversationIntelligence: ConversationIntelligence[];
  continuationSnapshot: ConversationContinuationSnapshot;
  participants: string[];
  semanticObjects: MemorySemanticObject[];
  localeHints: string[];
  tags: string[];
  duration: number;
  utteranceCount: number;
  sessionTitle: string;
  importanceScore: number;
  sessionType: 'reminder' | 'meeting' | 'follow_up' | 'brainstorming' | 'general';
  sourceReminderIds: string[];
  turns: ChatTurn[];
  isArchived?: boolean;
  isDeleted?: boolean;
  // Legacy fields to maintain backwards compatibility during migration
  transcript: {
    partial?: string;
    finalized: string;
    merged: string;
  };
  metadata: {
    utteranceCount: number;
    silenceTransitions: number;
    localeHints: string[];
  };
};

export type ConversationMemory = ConversationVaultEntry; // Alias for backward compatibility

export type UsePersistentMemoryReturn = {
  memories: ConversationMemory[];
  isLoaded: boolean;
  diagnostics: {
    restoredCount: number;
    prunedCount: number;
    recoveredFromBackup: boolean;
    corruptedStoreRecovered: boolean;
    lastRecoveryAt: number | null;
  };
  deletedSessionIds: string[];
  saveMemory: (
    session: ConversationSessionSnapshot,
    extraction: SemanticExtractionResult | null
  ) => Promise<void>;
  updateMemory: (sessionId: string, updates: Partial<ConversationVaultEntry>) => Promise<void>;
  deleteMemory: (sessionId: string) => Promise<void>;
  clearMemory: () => Promise<void>;
  reloadMemory: () => Promise<void>;
};

type MemorySubscriber = (memories: ConversationMemory[], deletedSessionIds: string[]) => void;

const memorySubscribers = new Set<MemorySubscriber>();
let sharedMemorySnapshot: ConversationMemory[] = [];
let sharedDeletedSessionIds = new Set<string>();

function emitMemorySnapshot(memories: ConversationMemory[], deletedSessionIds = sharedDeletedSessionIds) {
  sharedMemorySnapshot = boundMemories(memories);
  sharedDeletedSessionIds = new Set(deletedSessionIds);
  memorySubscribers.forEach(subscriber => {
    setTimeout(() => {
      subscriber(sharedMemorySnapshot, Array.from(sharedDeletedSessionIds));
    }, 0);
  });
}

function subscribeToMemorySnapshot(subscriber: MemorySubscriber) {
  memorySubscribers.add(subscriber);
  if (sharedMemorySnapshot.length > 0 || sharedDeletedSessionIds.size > 0) {
    subscriber(sharedMemorySnapshot, Array.from(sharedDeletedSessionIds));
  }
  return () => {
    memorySubscribers.delete(subscriber);
  };
}

export function normalizeConversationVaultEntry(raw: any): ConversationVaultEntry {
  const mergedTranscript = raw.mergedTranscript || raw.transcript?.merged || raw.transcript?.finalized || '';
  const createdAt = raw.createdAt || Date.now();
  const updatedAt = raw.updatedAt || raw.finalizedAt || createdAt;
  const utteranceCount = raw.utteranceCount || raw.metadata?.utteranceCount || 0;
  const localeHints = raw.localeHints || raw.metadata?.localeHints || [];
  const transcript = {
    partial: raw.transcript?.partial,
    finalized: raw.transcript?.finalized || raw.finalizedTranscript || mergedTranscript,
    merged: raw.transcript?.merged || mergedTranscript,
  };
  const metadata = raw.metadata || {
    utteranceCount,
    silenceTransitions: raw.silenceTransitions || 0,
    localeHints,
  };
  const conversationChunks: ConversationChunk[] = (Array.isArray(raw.conversationChunks)
    ? raw.conversationChunks
    : Array.isArray(raw.chunks)
      ? raw.chunks
      : mergedTranscript
        ? [
            createConversationChunkFromTranscript({
              sessionId: raw.sessionId || raw.id || `session-${createdAt}`,
              transcript: raw.semanticSummary || mergedTranscript,
              createdAt,
              finalizedAt: raw.finalizedAt || updatedAt,
            }),
          ]
        : []).slice(-MAX_MEMORY_CHUNKS);
  const conversationIntelligence: ConversationIntelligence[] = Array.isArray(raw.conversationIntelligence)
    ? raw.conversationIntelligence
    : conversationChunks.map(chunk => extractConversationIntelligence(chunk));
  const intelligenceSummary = aggregateIntelligence(conversationIntelligence);
  const semanticObjects = uniqueSemanticObjects([
    ...(Array.isArray(raw.semanticObjects) ? raw.semanticObjects : []),
    ...createSemanticObjectsFromIntelligence(intelligenceSummary, raw.createdAt || raw.finalizedAt || Date.now()),
  ]);
  const continuationSnapshot: ConversationContinuationSnapshot = raw.continuationSnapshot || createContinuationSnapshotFromMemory({
    ...raw,
    id: raw.id || raw.sessionId || `mem-${createdAt}`,
    sessionId: raw.sessionId || raw.id || `session-${createdAt}`,
    createdAt,
    updatedAt,
    finalizedAt: raw.finalizedAt || updatedAt,
    semanticSummary: raw.semanticSummary,
    sessionTitle: raw.sessionTitle,
    sessionType: raw.sessionType,
    highlights: raw.highlights || [],
    participants: raw.participants || [],
    reminders: raw.reminders || [],
    extractedTasks: raw.extractedTasks || [],
    tags: raw.tags || [],
    conversationIntelligence,
  });

  const turns: ChatTurn[] = Array.isArray(raw.turns)
    ? raw.turns
    : mergedTranscript
      ? [{ role: 'user', text: mergedTranscript, timestamp: createdAt }]
      : [];

  return {
    ...raw,
    id: raw.id || raw.sessionId || `mem-${createdAt}`,
    sessionId: raw.sessionId || raw.id || `session-${createdAt}`,
    createdAt,
    updatedAt,
    finalizedAt: raw.finalizedAt || updatedAt,
    sessionTitle: raw.sessionTitle || deriveSessionTitle(mergedTranscript, raw.sessionType || 'general', raw.reminders || [], raw.extractedTasks || [], raw.participants || []),
    importanceScore: raw.importanceScore ?? 0,
    sessionType: raw.sessionType || 'general',
    sourceReminderIds: raw.sourceReminderIds || [],
    mergedTranscript,
    semanticSummary: raw.semanticSummary || deriveSemanticSummary(mergedTranscript, raw.sessionType || 'general', raw.reminders || [], raw.extractedTasks || [], raw.participants || []),
    extractedTasks: raw.extractedTasks || [],
    reminders: raw.reminders || [],
    highlights: raw.highlights || [],
    conversationChunks,
    conversationIntelligence,
    continuationSnapshot,
    participants: raw.participants || [],
    semanticObjects,
    localeHints,
    tags: raw.tags || [],
    duration: raw.duration || raw.durationMs || 0,
    utteranceCount,
    turns,
    isArchived: raw.isArchived || false,
    isDeleted: raw.isDeleted || false,
    // legacy
    transcript,
    metadata,
  };
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map(v => (v || '').trim()).filter(Boolean)));
}

function aggregateIntelligence(intelligence: ConversationIntelligence[]) {
  return {
    tasks: uniqueStrings(intelligence.flatMap(item => [...item.tasks, ...item.actionItems])),
    actionItems: uniqueStrings(intelligence.flatMap(item => item.actionItems)),
    reminders: uniqueStrings(intelligence.flatMap(item => item.reminders)),
    deadlines: uniqueStrings(intelligence.flatMap(item => item.deadlines)),
    meetings: uniqueStrings(intelligence.flatMap(item => item.meetings)),
    participants: uniqueStrings(intelligence.flatMap(item => item.participants)),
    decisions: uniqueStrings(intelligence.flatMap(item => item.decisions)),
    followUps: uniqueStrings(intelligence.flatMap(item => item.followUps)),
    importantPoints: uniqueStrings(intelligence.flatMap(item => item.importantPoints)),
    topics: uniqueStrings(intelligence.flatMap(item => item.discussedTopics)),
  };
}

function applyTime(date: Date, source: string, fallbackHour = 17): Date {
  const next = new Date(date);
  const time = source.match(/\b(?:at\s+|by\s+|before\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i);
  if (time) {
    let hour = Number(time[1]);
    const minute = Number(time[2] || 0);
    const meridiem = time[3].toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    next.setHours(hour, minute, 0, 0);
    return next;
  }

  if (/\b(eod|end of day|tonight|evening)\b/i.test(source)) {
    next.setHours(18, 0, 0, 0);
    return next;
  }

  next.setHours(fallbackHour, 0, 0, 0);
  return next;
}

function nextWeekdayDate(base: Date, weekday: number): Date {
  const next = new Date(base);
  const delta = (weekday - next.getDay() + 7) % 7 || 7;
  next.setDate(next.getDate() + delta);
  return next;
}

function inferDatetimeFromText(text: string, baseTime: number): string | undefined {
  const source = text.toLowerCase();
  const base = new Date(baseTime);
  const relative = source.match(/\b(?:in|within)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const next = new Date(base);
    if (unit.startsWith('min')) next.setMinutes(next.getMinutes() + amount);
    else if (unit.startsWith('hour') || unit.startsWith('hr')) next.setHours(next.getHours() + amount);
    else next.setDate(next.getDate() + amount);
    return next.toISOString();
  }

  let target: Date | null = null;
  if (/\btomorrow\b/i.test(source)) {
    target = new Date(base);
    target.setDate(target.getDate() + 1);
  } else if (/\btoday\b|\btonight\b|\beod\b|\bend of day\b/i.test(source)) {
    target = new Date(base);
  } else if (/\bnext week\b/i.test(source)) {
    target = new Date(base);
    target.setDate(target.getDate() + 7);
  } else {
    const weekday = source.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1]?.toLowerCase();
    if (weekday && WEEKDAY_INDEX[weekday] !== undefined) {
      target = nextWeekdayDate(base, WEEKDAY_INDEX[weekday]);
    }
  }

  if (!target && /\b(?:at|by|before)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.test(source)) {
    target = new Date(base);
    const withTime = applyTime(target, source);
    if (withTime <= base) withTime.setDate(withTime.getDate() + 1);
    return withTime.toISOString();
  }

  if (!target) return undefined;
  return applyTime(target, source, /\bmeeting|sync|call|standup|demo|presentation\b/i.test(source) ? 10 : 17).toISOString();
}

function createSemanticObjectsFromIntelligence(
  intelligence: AggregatedIntelligenceSummary,
  baseTime: number
): MemorySemanticObject[] {
  const participants = intelligence.participants;
  const objects: MemorySemanticObject[] = [];

  const pushObject = (type: string, task: string, confidence: number, context = task) => {
    const datetime = inferDatetimeFromText(context, baseTime);
    objects.push({
      type,
      confidence,
      datetime,
      task,
      participants,
    });
  };

  intelligence.reminders.forEach(item => pushObject('reminder', item, 0.95));
  intelligence.deadlines.forEach(item => pushObject('calendar_event', item, 0.91, item));
  intelligence.meetings.forEach(item => pushObject('meeting_action', item, 0.9, item));
  intelligence.followUps.forEach(item => pushObject('follow_up', item, 0.92));
  uniqueStrings([...intelligence.tasks, ...intelligence.actionItems]).forEach(item => {
    pushObject(hasTemporalSignal(item) ? 'calendar_event' : 'follow_up', item, hasTemporalSignal(item) ? 0.9 : 0.88);
  });

  return uniqueSemanticObjects(objects);
}

function hasTemporalSignal(text: string): boolean {
  return /\b(deadline|due|by|before|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|eod|end of day|evening|morning|\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i.test(text);
}

function hasStrongActionSignal(text: string): boolean {
  return /\b(i(?:'ll| will)|we(?:'ll| will)|need to|needs to|must|have to|should\s+(?:complete|finish|submit|review|finalize|prepare|send|call|deploy|deliver)|action item|follow up|follow-up)\b/i.test(text);
}

function shouldPromoteExtractionToTaskList(extraction: SemanticExtractionResult): boolean {
  if (!extraction.task || extraction.type === 'general_note') return false;
  if (extraction.type === 'reminder') return extraction.confidence >= 0.9;
  return extraction.confidence >= 0.85 && (
    !!extraction.datetime ||
    (extraction.participants?.length || 0) > 0 ||
    hasStrongActionSignal(extraction.rawText)
  );
}

function filterPromotableTaskLines(values: string[]): string[] {
  return values.filter(value => hasTemporalSignal(value) || hasStrongActionSignal(value));
}

function truncateTitle(text: string, max = 34): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trim()}...`;
}

function deriveHighlights(text: string, tasks: string[], reminders: string[]): string[] {
  const sentenceMatches = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => /\b(call|schedule|meeting|deadline|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|remind|need to|must|important|urgent|follow up)\b/i.test(s))
    .slice(0, 4);

  return uniqueStrings([
    ...reminders.map(r => `Reminder: ${r}`),
    ...tasks.map(t => `Task: ${t}`),
    ...sentenceMatches,
  ]).slice(0, 6);
}

function deriveSessionType(
  text: string,
  extraction: SemanticExtractionResult | null,
  reminders: string[],
  tasks: string[]
): ConversationVaultEntry['sessionType'] {
  const lower = text.toLowerCase();
  if (reminders.length > 0 || extraction?.type === 'reminder') return 'reminder';
  if (extraction?.type === 'meeting_action' || /\b(meeting|call|standup|sync)\b/.test(lower)) return 'meeting';
  if (tasks.length > 0 || extraction?.type === 'follow_up' || /\bfollow up\b/.test(lower)) return 'follow_up';
  if (/\b(brainstorm|idea|ideas|plan|design)\b/.test(lower)) return 'brainstorming';
  return 'general';
}

function deriveSessionTitle(
  text: string,
  sessionType: ConversationVaultEntry['sessionType'],
  reminders: string[],
  tasks: string[],
  participants: string[]
): string {
  const lower = text.toLowerCase();
  
  if (lower.includes('presentation') || lower.includes('slides') || lower.includes('demo')) {
    return 'AI Presentation Planning';
  }
  if (lower.includes('frontend') || lower.includes('ui') || lower.includes('ux') || lower.includes('design') || lower.includes('layout')) {
    return 'Frontend Team Discussion';
  }
  if (lower.includes('placement') || lower.includes('leetcode') || lower.includes('resume') || lower.includes('mock interview') || lower.includes('job')) {
    return 'Placement Preparation';
  }
  if (lower.includes('daily briefing') || lower.includes('briefing') || lower.includes('agenda')) {
    return 'Daily Briefing';
  }
  if (lower.includes('follow-up') || lower.includes('action item') || lower.includes('todo') || lower.includes('tasks')) {
    return 'Meeting Follow-up';
  }
  if (lower.includes('rahul')) {
    return 'Rahul Sync';
  }

  if (sessionType === 'meeting') {
    if (participants.length > 0) {
      const names = participants.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' & ');
      return `${names} Discussion`;
    }
    return 'Team Sync';
  }
  if (sessionType === 'reminder') {
    return reminders.length > 0 ? `Reminder: ${truncateTitle(reminders[0], 24)}` : 'Personal Reminder';
  }
  if (sessionType === 'follow_up') {
    return 'Action Planning';
  }
  if (sessionType === 'brainstorming') return 'Brainstorming Session';

  return 'Conversational Briefing';
}

type AggregatedIntelligenceSummary = {
  tasks: string[];
  actionItems: string[];
  reminders: string[];
  deadlines: string[];
  meetings: string[];
  participants: string[];
  decisions: string[];
  followUps: string[];
  importantPoints: string[];
  topics: string[];
};

function deriveSemanticSummary(
  text: string,
  sessionType: ConversationVaultEntry['sessionType'],
  reminders: string[],
  tasks: string[],
  participants: string[],
  intelligence?: AggregatedIntelligenceSummary
): string {
  // If we have rich intelligence data, produce a structured executive summary
  if (intelligence) {
    const hasStructuredContent =
      intelligence.decisions.length > 0 ||
      intelligence.deadlines.length > 0 ||
      intelligence.followUps.length > 0 ||
      (intelligence.importantPoints.length > 0 && intelligence.tasks.length > 0);

    if (hasStructuredContent) {
      const sections: string[] = [];

      if (intelligence.importantPoints.length > 0) {
        sections.push('Key Discussion Points:');
        intelligence.importantPoints.slice(0, 5).forEach(p => sections.push(`• ${p}`));
        sections.push('');
      }

      if (intelligence.decisions.length > 0) {
        sections.push('Decisions Taken:');
        intelligence.decisions.slice(0, 4).forEach(d => sections.push(`• ${d}`));
        sections.push('');
      }

      const allActions = uniqueStrings([...intelligence.tasks, ...tasks]);
      if (allActions.length > 0) {
        sections.push('Action Items:');
        allActions.slice(0, 5).forEach(a => sections.push(`• ${a}`));
        sections.push('');
      }

      if (intelligence.deadlines.length > 0) {
        sections.push('Deadlines & Timings:');
        intelligence.deadlines.slice(0, 4).forEach(dl => sections.push(`• ${dl}`));
        sections.push('');
      }

      if (intelligence.followUps.length > 0) {
        sections.push('Pending Follow-ups:');
        intelligence.followUps.slice(0, 4).forEach(f => sections.push(`• ${f}`));
        sections.push('');
      }

      if (sections.length > 0) return sections.join('\n').trim();
    }
  }

  // Fallback: simple concise summary
  if (reminders.length > 0) return `Reminder setup: ${reminders[0]}`;
  if (sessionType === 'meeting' && participants.length > 0) return `Meeting discussion involving ${participants.join(', ')}`;
  if (tasks.length > 0) return `Action planning: ${tasks[0]}`;

  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  if (sentences[0]) return truncateTitle(sentences[0], 140);
  return 'Conversational Snapshot';
}

function deriveImportanceScore(
  text: string,
  utteranceCount: number,
  reminders: string[],
  tasks: string[],
  participants: string[]
): number {
  let score = Math.min(utteranceCount * 2, 20);
  score += (reminders.length + tasks.length) * 15;
  score += participants.length * 10;
  if (/\b(important|urgent|deadline|critical|asap)\b/i.test(text)) score += 20;
  return Math.min(score, 100);
}

function uniqueSemanticObjects(arr: MemorySemanticObject[]): MemorySemanticObject[] {
  const seen = new Set<string>();
  return arr.filter(item => {
    const key = `${item.type}:${item.task || ''}:${(item.participants || []).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boundMemories(memories: ConversationMemory[]): ConversationMemory[] {
  const bySession = new Map<string, ConversationMemory>();
  for (const memory of memories) {
    const existing = bySession.get(memory.sessionId);
    if (!existing || memory.updatedAt >= existing.updatedAt) {
      bySession.set(memory.sessionId, {
        ...memory,
        conversationChunks: (memory.conversationChunks || []).slice(-MAX_MEMORY_CHUNKS),
        conversationIntelligence: (memory.conversationIntelligence || []).slice(-MAX_MEMORY_CHUNKS),
      });
    }
  }
  return Array.from(bySession.values())
    .sort((a, b) => (b.finalizedAt || b.updatedAt) - (a.finalizedAt || a.updatedAt))
    .slice(0, MAX_RESTORED_MEMORIES);
}

async function persistMemorySnapshot(memories: ConversationMemory[]): Promise<void> {
  const payload = JSON.stringify(boundMemories(memories));
  await AsyncStorage.setItem(MEMORY_BACKUP_KEY, payload);
  await AsyncStorage.setItem(MEMORY_STORAGE_KEY, payload);
  if (!(global as any).isPresentationMode) {
    console.log('[DEV] memory persisted. Total:', memories.length);
  }
}

async function persistDeletedSessionIds(sessionIds: Set<string>): Promise<void> {
  await AsyncStorage.setItem(MEMORY_DELETED_SESSIONS_KEY, JSON.stringify(Array.from(sessionIds)));
}

async function readDeletedSessionIds(): Promise<Set<string>> {
  try {
    const data = await AsyncStorage.getItem(MEMORY_DELETED_SESSIONS_KEY);
    if (!data) return new Set();
    const parsed = JSON.parse(data);
    return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

async function readMemoryArray(key: string): Promise<any[] | null> {
  const data = await AsyncStorage.getItem(key);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function usePersistentMemory(): UsePersistentMemoryReturn {
  const [internalMemories, setInternalMemories] = useState<ConversationMemory[]>([]);
  const memories = useMemo(() => internalMemories.filter(m => !m.isDeleted), [internalMemories]);
  const [deletedSessionIds, setDeletedSessionIds] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<UsePersistentMemoryReturn['diagnostics']>({
    restoredCount: 0,
    prunedCount: 0,
    recoveredFromBackup: false,
    corruptedStoreRecovered: false,
    lastRecoveryAt: null,
  });

  // Guard against duplicate saves for the same session ID
  const savedSessionIdsRef = useRef<Set<string>>(new Set());

  const loadMemory = useCallback(async () => {
    try {
      let recoveredFromBackup = false;
      let corruptedStoreRecovered = false;
      let parsed = await readMemoryArray(MEMORY_STORAGE_KEY);
      const deletedIds = await readDeletedSessionIds();
      sharedDeletedSessionIds = deletedIds;
      setDeletedSessionIds(Array.from(deletedIds));

      if (parsed === null) {
        corruptedStoreRecovered = true;
        const raw = await AsyncStorage.getItem(MEMORY_STORAGE_KEY);
        if (raw) {
          await AsyncStorage.setItem(MEMORY_CORRUPT_KEY, raw.slice(0, 24000));
        }
        parsed = await readMemoryArray(MEMORY_BACKUP_KEY);
        recoveredFromBackup = Array.isArray(parsed);
      }

      if (parsed && parsed.length >= 0) {
        const normalized = boundMemories(parsed.map(normalizeConversationVaultEntry))
          .filter(memory => !deletedIds.has(memory.sessionId));
        const prunedCount = Math.max(0, parsed.length - normalized.length);
        
        setInternalMemories(prev => {
          const merged = boundMemories([...prev, ...normalized])
            .filter(memory => !deletedIds.has(memory.sessionId));
          savedSessionIdsRef.current = new Set(merged.map(m => m.sessionId));
          
          persistMemorySnapshot(merged).catch(e => {
            if (__DEV__) console.warn('[PersistentMemory] Failed to sync loaded memory', e);
          });
          emitMemorySnapshot(merged, deletedIds);
          
          return merged;
        });

        setDiagnostics({
          restoredCount: normalized.length,
          prunedCount,
          recoveredFromBackup,
          corruptedStoreRecovered,
          lastRecoveryAt: corruptedStoreRecovered || recoveredFromBackup || prunedCount > 0 ? Date.now() : null,
        });
        if (!(global as any).isPresentationMode) {
          console.log('[DEV] hydration completed. Loaded memories count:', normalized.length);
        }
      }
    } catch (e) {
      setDiagnostics(prev => ({
        ...prev,
        corruptedStoreRecovered: true,
        lastRecoveryAt: Date.now(),
      }));
      if (__DEV__) {
        console.warn('[PersistentMemory] Failed to load memory', e);
      }
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMemory();

    const unsubscribe = subscribeToMemorySnapshot((nextMemories, nextDeletedSessionIds) => {
      setInternalMemories(nextMemories);
      setDeletedSessionIds(nextDeletedSessionIds);
      savedSessionIdsRef.current = new Set(nextMemories.map(m => m.sessionId));
    });

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        void loadMemory();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [loadMemory]);

  const saveMemory = useCallback(
    async (
      session: ConversationSessionSnapshot,
      extraction: SemanticExtractionResult | null
    ) => {
      // Deterministic gate: only save if fully finalized
      if (session.state !== 'finalized') return;
      if (sharedDeletedSessionIds.has(session.sessionId)) return;
      
      if (savedSessionIdsRef.current.has(session.sessionId)) {
        setInternalMemories(prev => {
          const idx = prev.findIndex(m => m.sessionId === session.sessionId);
          if (idx === -1) return prev;
          
          const existing = prev[idx];
          const next = {
            ...existing,
            mergedTranscript: session.mergedTranscript || existing.mergedTranscript,
            turns: (session as any).turns || existing.turns,
            updatedAt: Date.now(),
          };

          if (extraction && extraction.sourceSessionId === session.sessionId) {
            const semanticObjects: MemorySemanticObject[] = [{
              type: extraction.type,
              confidence: extraction.confidence,
              datetime: extraction.datetime,
              task: extraction.task,
              participants: extraction.participants,
            }];
            const extractedTasks: string[] = [];
            const reminders: string[] = [];
            if (extraction.task && shouldPromoteExtractionToTaskList(extraction)) {
              if (extraction.type === 'reminder') reminders.push(extraction.task);
              else extractedTasks.push(extraction.task);
            }
            const participants = extraction.participants || [];

            next.semanticObjects = uniqueSemanticObjects([...existing.semanticObjects, ...semanticObjects]);
            next.extractedTasks = uniqueStrings([...existing.extractedTasks, ...extractedTasks]);
            next.reminders = uniqueStrings([...existing.reminders, ...reminders]);
            next.participants = uniqueStrings([...existing.participants, ...participants]);
          }

          next.sessionType = deriveSessionType(next.mergedTranscript, extraction, next.reminders, next.extractedTasks);
          next.sessionTitle = deriveSessionTitle(next.mergedTranscript, next.sessionType, next.reminders, next.extractedTasks, next.participants);
          const updatedIntelligence = (next.conversationIntelligence || []) as ConversationIntelligence[];
          const updatedIntelSummary = updatedIntelligence.length > 0 ? aggregateIntelligence(updatedIntelligence) : undefined;
          if (updatedIntelSummary) {
            next.semanticObjects = uniqueSemanticObjects([
              ...next.semanticObjects,
              ...createSemanticObjectsFromIntelligence(updatedIntelSummary, next.createdAt),
            ]);
          }
          next.semanticSummary = deriveSemanticSummary(next.mergedTranscript, next.sessionType, next.reminders, next.extractedTasks, next.participants, updatedIntelSummary);
          
          const updatedMemories = [...prev];
          updatedMemories[idx] = normalizeConversationVaultEntry(next);
          const bounded = boundMemories(updatedMemories);

          if (!(global as any).isPresentationMode) {
            console.log('[DEV] memory updated with new session turns:', next.id);
          }

          persistMemorySnapshot(bounded).catch(e => {
            if (__DEV__) console.warn('[PersistentMemory] Failed to update memory with new session turns', e);
          });
          emitMemorySnapshot(bounded);
          return bounded;
        });
        return;
      }

      const now = Date.now();
      savedSessionIdsRef.current.add(session.sessionId);
      const sessionLocaleHints = session.localeHints as any;

      const semanticObjects: MemorySemanticObject[] = [];
      const extractedTasks: string[] = [];
      const reminders: string[] = [];
      const participants: string[] = [];

      if (extraction && extraction.sourceSessionId === session.sessionId) {
        semanticObjects.push({
          type: extraction.type,
          confidence: extraction.confidence,
          datetime: extraction.datetime,
          task: extraction.task,
          participants: extraction.participants,
        });

        if (extraction.task && shouldPromoteExtractionToTaskList(extraction)) {
          if (extraction.type === 'reminder') reminders.push(extraction.task);
          else extractedTasks.push(extraction.task);
        }
        if (extraction.participants) {
          participants.push(...extraction.participants);
        }
      }

      const mergedTranscript = session.mergedTranscript || session.finalizedTranscript;
      const sessionChunks = ((session as any).conversationChunks || []) as ConversationChunk[];
      const conversationChunks = sessionChunks.length > 0
        ? sessionChunks
        : [
            createConversationChunkFromTranscript({
              sessionId: session.sessionId,
              transcript: mergedTranscript,
              createdAt: session.startedAt,
              finalizedAt: now,
            }),
          ];
      const sessionIntelligence = (((session as any).conversationIntelligence || []) as ConversationIntelligence[]).length > 0
        ? ((session as any).conversationIntelligence || []) as ConversationIntelligence[]
        : conversationChunks.map(chunk => extractConversationIntelligence(chunk));
      const intelligenceSummary = aggregateIntelligence(sessionIntelligence);
      semanticObjects.push(...createSemanticObjectsFromIntelligence(intelligenceSummary, session.startedAt));
      const uniqueTasks = uniqueStrings([
        ...extractedTasks,
        ...filterPromotableTaskLines([
          ...intelligenceSummary.tasks,
          ...intelligenceSummary.actionItems,
          ...intelligenceSummary.followUps,
        ]),
      ]);
      const uniqueReminders = uniqueStrings([
        ...reminders,
        ...intelligenceSummary.reminders.filter(item => hasTemporalSignal(item) || /\b(remind me|set a reminder|don't forget|notify me|alert me)\b/i.test(item)),
      ]);
      const allParticipants = uniqueStrings([...participants, ...intelligenceSummary.participants]);
      const sessionType = deriveSessionType(mergedTranscript, extraction, uniqueReminders, uniqueTasks);
      const sessionTitle = deriveSessionTitle(mergedTranscript, sessionType, uniqueReminders, uniqueTasks, allParticipants);
      const semanticSummary = deriveSemanticSummary(mergedTranscript, sessionType, uniqueReminders, uniqueTasks, allParticipants, intelligenceSummary);
      const highlights = uniqueStrings([...intelligenceSummary.importantPoints, ...intelligenceSummary.decisions, ...deriveHighlights(mergedTranscript, uniqueTasks, uniqueReminders)]);
      const importanceScore = Math.max(
        deriveImportanceScore(mergedTranscript, session.utteranceCount, uniqueReminders, uniqueTasks, allParticipants),
        ...sessionIntelligence.map(item => item.importanceScore),
        0
      );
      const continuationSnapshot = createContinuationSnapshotFromMemory({
        id: `mem-${now.toString(36)}`,
        sessionId: session.sessionId,
        createdAt: session.startedAt,
        updatedAt: now,
        finalizedAt: now,
        sessionTitle,
        semanticSummary,
        sessionType,
        highlights,
        participants: allParticipants,
        reminders: uniqueReminders,
        extractedTasks: uniqueTasks,
        tags: intelligenceSummary.topics,
        conversationIntelligence: sessionIntelligence,
      });

      const duration = session.durationMs || now - session.startedAt;

      const newMemory: ConversationVaultEntry = {
        id: `mem-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: session.sessionId,
        createdAt: session.startedAt,
        updatedAt: now,
        finalizedAt: now,
        mergedTranscript,
        semanticSummary,
        extractedTasks: uniqueTasks,
        reminders: uniqueReminders,
        highlights,
        conversationChunks,
        conversationIntelligence: sessionIntelligence,
        continuationSnapshot,
        participants: allParticipants,
        semanticObjects,
        localeHints: Array.isArray(sessionLocaleHints?.preferredLocales)
          ? [...sessionLocaleHints.preferredLocales]
          : sessionLocaleHints?.primaryLocale
            ? [sessionLocaleHints.primaryLocale]
            : [],
        tags: intelligenceSummary.topics,
        duration,
        utteranceCount: session.utteranceCount,
        sessionTitle,
        importanceScore,
        sessionType,
        sourceReminderIds: [],
        turns: (session as any).turns || [],
        // Legacy
        transcript: {
          partial: session.partialTranscript || undefined,
          finalized: session.finalizedTranscript,
          merged: session.mergedTranscript,
        },
        metadata: {
          utteranceCount: session.utteranceCount,
          silenceTransitions: session.silenceTransitions,
          localeHints: Array.isArray(sessionLocaleHints?.preferredLocales)
            ? [...sessionLocaleHints.preferredLocales]
            : sessionLocaleHints?.primaryLocale
              ? [sessionLocaleHints.primaryLocale]
              : [],
        },
      };

      if (!(global as any).isPresentationMode) {
        console.log('[DEV] memory generated:', newMemory.id);
      }

      setInternalMemories(prev => {
        const updated = boundMemories([newMemory, ...prev]);
        // Fire-and-forget persist to storage (batched internally by AsyncStorage)
        persistMemorySnapshot(updated).catch(
          e => {
            if (__DEV__) {
              console.warn('[PersistentMemory] Failed to save memory', e);
            }
          }
        );
        emitMemorySnapshot(updated);
        return updated;
      });
    },
    []
  );

  const updateMemory = useCallback(async (sessionId: string, updates: Partial<ConversationVaultEntry>) => {
    setInternalMemories(prev => {
      const idx = prev.findIndex(m => m.sessionId === sessionId);
      if (idx === -1) return prev;
      const updatedMemories = [...prev];
      const next = { ...updatedMemories[idx], ...updates, updatedAt: Date.now() };
      if (updates.sourceReminderIds) {
        next.sourceReminderIds = uniqueStrings(updates.sourceReminderIds);
      }
      updatedMemories[idx] = normalizeConversationVaultEntry(next);
      const bounded = boundMemories(updatedMemories);
      persistMemorySnapshot(bounded).catch(e => {
        if (__DEV__) console.warn('[PersistentMemory] Failed to update memory', e);
      });
      emitMemorySnapshot(bounded);
      return bounded;
    });
  }, []);

  const deleteMemory = useCallback(async (sessionId: string) => {
    const nextDeletedIds = new Set(sharedDeletedSessionIds);
    nextDeletedIds.add(sessionId);
    sharedDeletedSessionIds = nextDeletedIds;
    setDeletedSessionIds(Array.from(nextDeletedIds));
    persistDeletedSessionIds(nextDeletedIds).catch(e => {
      if (__DEV__) console.warn('[PersistentMemory] Failed to persist deleted session tombstone', e);
    });

    setInternalMemories(prev => {
      const updatedMemories = prev.filter(m => m.sessionId !== sessionId);
      savedSessionIdsRef.current.delete(sessionId);
      
      persistMemorySnapshot(updatedMemories).catch(e => {
        if (__DEV__) console.warn('[PersistentMemory] Failed to delete memory', e);
      });
      emitMemorySnapshot(updatedMemories, nextDeletedIds);
      return updatedMemories;
    });
  }, []);

  const clearMemory = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(MEMORY_STORAGE_KEY);
      await AsyncStorage.removeItem(MEMORY_BACKUP_KEY);
      await AsyncStorage.removeItem(MEMORY_DELETED_SESSIONS_KEY);
      setInternalMemories([]);
      setDeletedSessionIds([]);
      savedSessionIdsRef.current.clear();
      emitMemorySnapshot([], new Set());
    } catch (e) {
      if (__DEV__) {
        console.warn('[PersistentMemory] Failed to clear memory', e);
      }
    }
  }, []);

  return {
    memories,
    isLoaded,
    diagnostics,
    deletedSessionIds,
    saveMemory,
    updateMemory,
    deleteMemory,
    clearMemory,
    reloadMemory: loadMemory,
  };
}
