import { useCallback, useMemo, useRef, useState } from 'react';

export type ConversationChunk = {
  chunkId: string;
  sessionId: string;
  createdAt: number;
  finalizedAt: number | null;
  transcript: string;
  summary: string;
  highlights: string[];
  tasks: string[];
  reminders: string[];
  participants: string[];
  topicHints: string[];
  tokenEstimate: number;
  importanceScore: number;
};

export type ConversationChunkingConfig = {
  sessionId?: string;
  windowMs: number;
  silenceBoundaryMs: number;
  maxLiveTranscriptChars: number;
  maxRollingSegments: number;
  maxChunkTranscriptChars: number;
  maxRetainedChunks: number;
  topicShiftThreshold: number;
};

export type ConversationTopicGroup = {
  topic: string;
  chunks: ConversationChunk[];
};

export type ConversationChunkingDiagnostics = {
  sessionId: string;
  liveTranscriptChars: number;
  retainedChunkCount: number;
  finalizedChunkCount: number;
  activeTokenEstimate: number;
  lastFinalizeReason: string | null;
};

export type UseConversationChunkingReturn = {
  sessionId: string;
  rollingTranscript: string;
  activeChunk: ConversationChunk | null;
  finalizedChunks: ConversationChunk[];
  chunkHistory: ConversationChunk[];
  topicGroups: ConversationTopicGroup[];
  diagnostics: ConversationChunkingDiagnostics;
  ingestPartialTranscript: (text: string, at?: number) => void;
  ingestFinalTranscript: (text: string, at?: number) => ConversationChunk[];
  markSilenceBoundary: (at?: number) => ConversationChunk[];
  finalizeOpenChunk: (reason?: string, at?: number) => ConversationChunk | null;
  resetChunks: (nextSessionId?: string, at?: number) => void;
};

const DEFAULT_CONFIG: ConversationChunkingConfig = {
  windowMs: 3 * 60 * 1000,
  silenceBoundaryMs: 2200,
  maxLiveTranscriptChars: 1800,
  maxRollingSegments: 24,
  maxChunkTranscriptChars: 3600,
  maxRetainedChunks: 40,
  topicShiftThreshold: 3,
};

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'but',
  'for',
  'from',
  'have',
  'into',
  'just',
  'like',
  'that',
  'the',
  'then',
  'this',
  'with',
  'you',
  'your',
  'hai',
  'kya',
  'aur',
  'mein',
  'mujhe',
]);

const EXPLICIT_TOPIC_BOUNDARY =
  /\b(now let'?s discuss|moving to|next topic|another thing|new topic|switching to|let'?s talk about|coming to)\b/i;
const TASK_BOUNDARY = /\b(todo|to-do|need to|must|action item|follow up|follow-up)\b/i;
const REMINDER_BOUNDARY = /\b(remind me|remember to|set a reminder|don't forget)\b/i;
const PARTICIPANT_PATTERN = /\b(?:with|for|call|meeting with|sync with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;

type RollingSegment = {
  text: string;
  at: number;
};

type ChunkDraft = {
  chunkId: string;
  sessionId: string;
  createdAt: number;
  segments: RollingSegment[];
  participants: Set<string>;
  topicHints: Set<string>;
};

function createSessionId(at: number): string {
  return `chunk-session-${at.toString(36)}`;
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, maxLength: number): string {
  const clean = compact(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function estimateTokens(text: string): number {
  return Math.ceil(compact(text).length / 4);
}

function unique(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map(v => compact(v)).filter(Boolean))).slice(0, limit);
}

function extractKeywords(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  for (const token of tokens) {
    if (token.length < 4 || STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token)
    .slice(0, limit);
}

function extractParticipants(text: string): string[] {
  const participants: string[] = [];
  for (const match of text.matchAll(PARTICIPANT_PATTERN)) {
    if (match[1]) participants.push(match[1]);
  }
  return unique(participants, 8);
}

function extractTasks(text: string): string[] {
  return unique(
    compact(text)
      .split(/(?<=[.!?])\s+/)
      .filter(sentence => TASK_BOUNDARY.test(sentence))
      .map(sentence => clip(sentence, 140)),
    6
  );
}

function extractReminders(text: string): string[] {
  return unique(
    compact(text)
      .split(/(?<=[.!?])\s+/)
      .filter(sentence => REMINDER_BOUNDARY.test(sentence))
      .map(sentence => clip(sentence, 140)),
    6
  );
}

function extractHighlights(text: string, tasks: string[], reminders: string[]): string[] {
  const important = compact(text)
    .split(/(?<=[.!?])\s+/)
    .filter(sentence =>
      /\b(important|urgent|deadline|decision|blocked|remember|deploy|frontend|backend|project|meeting)\b/i.test(sentence)
    )
    .map(sentence => clip(sentence, 140));
  return unique([...reminders, ...tasks, ...important], 6);
}

function summarizeChunk(text: string, topicHints: string[], tasks: string[], reminders: string[]): string {
  if (reminders[0]) return `Reminder: ${clip(reminders[0], 120)}`;
  if (tasks[0]) return `Action: ${clip(tasks[0], 120)}`;
  const firstSentence = compact(text).split(/(?<=[.!?])\s+/).find(Boolean);
  if (firstSentence) return clip(firstSentence, 150);
  if (topicHints[0]) return `Discussion about ${topicHints.slice(0, 3).join(', ')}`;
  return 'Conversation chunk';
}

function importanceScore(text: string, tasks: string[], reminders: string[], participants: string[]): number {
  let score = Math.min(estimateTokens(text), 30);
  score += tasks.length * 12;
  score += reminders.length * 18;
  score += participants.length * 8;
  if (/\b(important|urgent|deadline|critical|asap|decision)\b/i.test(text)) score += 20;
  return Math.min(score, 100);
}

function buildChunk(draft: ChunkDraft, finalizedAt: number | null, maxTranscriptChars: number): ConversationChunk {
  const transcript = clip(draft.segments.map(segment => segment.text).join(' '), maxTranscriptChars);
  const topicHints = unique([...draft.topicHints, ...extractKeywords(transcript)], 8);
  const participants = unique([...draft.participants, ...extractParticipants(transcript)], 8);
  const tasks = extractTasks(transcript);
  const reminders = extractReminders(transcript);
  const highlights = extractHighlights(transcript, tasks, reminders);

  return {
    chunkId: draft.chunkId,
    sessionId: draft.sessionId,
    createdAt: draft.createdAt,
    finalizedAt,
    transcript,
    summary: summarizeChunk(transcript, topicHints, tasks, reminders),
    highlights,
    tasks,
    reminders,
    participants,
    topicHints,
    tokenEstimate: estimateTokens(transcript),
    importanceScore: importanceScore(transcript, tasks, reminders, participants),
  };
}

export function createConversationChunkFromTranscript(input: {
  sessionId: string;
  transcript: string;
  createdAt: number;
  finalizedAt?: number | null;
  chunkIndex?: number;
  maxTranscriptChars?: number;
}): ConversationChunk {
  const createdAt = input.createdAt;
  const draft: ChunkDraft = {
    chunkId: `${input.sessionId}:chunk-${input.chunkIndex || 1}`,
    sessionId: input.sessionId,
    createdAt,
    segments: [{ text: compact(input.transcript), at: createdAt }],
    participants: new Set(extractParticipants(input.transcript)),
    topicHints: new Set(extractKeywords(input.transcript)),
  };
  return buildChunk(
    draft,
    input.finalizedAt === undefined ? createdAt : input.finalizedAt,
    input.maxTranscriptChars || DEFAULT_CONFIG.maxChunkTranscriptChars
  );
}

function keywordDivergenceScore(previous: string[], next: string[]): number {
  if (previous.length === 0 || next.length === 0) return 0;
  const previousSet = new Set(previous);
  const overlap = next.filter(token => previousSet.has(token)).length;
  return next.length - overlap;
}

function shouldStartNewChunk(draft: ChunkDraft, nextText: string, at: number, config: ConversationChunkingConfig): boolean {
  if (draft.segments.length === 0) return false;
  if (at - draft.createdAt >= config.windowMs) return true;
  if (EXPLICIT_TOPIC_BOUNDARY.test(nextText)) return true;
  if ((TASK_BOUNDARY.test(nextText) || REMINDER_BOUNDARY.test(nextText)) && draft.segments.length > 1) return true;

  const previousKeywords = Array.from(draft.topicHints);
  const nextKeywords = extractKeywords(nextText);
  return keywordDivergenceScore(previousKeywords, nextKeywords) >= config.topicShiftThreshold;
}

function dedupeSegment(segments: RollingSegment[], text: string): boolean {
  const clean = compact(text).toLowerCase();
  const last = segments[segments.length - 1]?.text.toLowerCase();
  return !!last && (last === clean || last.endsWith(clean) || last.includes(clean));
}

export function useConversationChunking(
  configInput: Partial<ConversationChunkingConfig> = {}
): UseConversationChunkingReturn {
  const configRef = useRef<ConversationChunkingConfig>({
    ...DEFAULT_CONFIG,
    ...configInput,
  });
  configRef.current = { ...configRef.current, ...configInput };

  const sessionIdRef = useRef(configRef.current.sessionId || createSessionId(Date.now()));
  const chunkIndexRef = useRef(0);
  const rollingRef = useRef<RollingSegment[]>([]);
  const finalizedRef = useRef<ConversationChunk[]>([]);
  const draftRef = useRef<ChunkDraft | null>(null);
  const lastFinalizeReasonRef = useRef<string | null>(null);

  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision(value => value + 1), []);

  const createDraft = useCallback((at: number): ChunkDraft => {
    chunkIndexRef.current += 1;
    return {
      chunkId: `${sessionIdRef.current}:chunk-${chunkIndexRef.current}`,
      sessionId: sessionIdRef.current,
      createdAt: at,
      segments: [],
      participants: new Set(),
      topicHints: new Set(),
    };
  }, []);

  const retainFinalized = useCallback(() => {
    const limit = configRef.current.maxRetainedChunks;
    if (finalizedRef.current.length > limit) {
      finalizedRef.current = finalizedRef.current.slice(-limit);
    }
  }, []);

  const appendRolling = useCallback((segment: RollingSegment) => {
    rollingRef.current.push(segment);
    rollingRef.current = rollingRef.current.slice(-configRef.current.maxRollingSegments);
    while (
      rollingRef.current.length > 1 &&
      rollingRef.current.map(s => s.text).join(' ').length > configRef.current.maxLiveTranscriptChars
    ) {
      rollingRef.current.shift();
    }
  }, []);

  const finalizeOpenChunk = useCallback((reason = 'manual', at = Date.now()): ConversationChunk | null => {
    const draft = draftRef.current;
    if (!draft || draft.segments.length === 0) return null;

    const chunk = buildChunk(draft, at, configRef.current.maxChunkTranscriptChars);
    if (!finalizedRef.current.some(existing => existing.chunkId === chunk.chunkId)) {
      finalizedRef.current.push(chunk);
      if (!(global as any).isPresentationMode) {
        console.log('[DEV] transcript finalized. Chunk ID:', chunk.chunkId, 'Length:', chunk.transcript.length);
      }
      retainFinalized();
    }
    draftRef.current = null;
    lastFinalizeReasonRef.current = reason;
    bump();
    return chunk;
  }, [bump, retainFinalized]);

  const ingestPartialTranscript = useCallback((text: string, at = Date.now()) => {
    const clean = compact(text);
    if (!clean) return;
    appendRolling({ text: clean, at });
    bump();
  }, [appendRolling, bump]);

  const ingestFinalTranscript = useCallback((text: string, at = Date.now()): ConversationChunk[] => {
    const clean = compact(text);
    if (!clean) return [];

    const finalized: ConversationChunk[] = [];
    let draft = draftRef.current || createDraft(at);
    if (shouldStartNewChunk(draft, clean, at, configRef.current)) {
      const chunk = finalizeOpenChunk('segment_boundary', at);
      if (chunk) finalized.push(chunk);
      draft = createDraft(at);
    }

    if (!dedupeSegment(draft.segments, clean)) {
      draft.segments.push({ text: clean, at });
      for (const participant of extractParticipants(clean)) draft.participants.add(participant);
      for (const keyword of extractKeywords(clean)) draft.topicHints.add(keyword);
      appendRolling({ text: clean, at });
    }

    draftRef.current = draft;
    bump();
    return finalized;
  }, [appendRolling, bump, createDraft, finalizeOpenChunk]);

  const markSilenceBoundary = useCallback((at = Date.now()): ConversationChunk[] => {
    const draft = draftRef.current;
    if (!draft || draft.segments.length === 0) return [];
    const lastSegment = draft.segments[draft.segments.length - 1];
    if (at - lastSegment.at < configRef.current.silenceBoundaryMs) return [];
    const chunk = finalizeOpenChunk('silence_boundary', at);
    return chunk ? [chunk] : [];
  }, [finalizeOpenChunk]);

  const resetChunks = useCallback((nextSessionId?: string, at = Date.now()) => {
    sessionIdRef.current = nextSessionId || configRef.current.sessionId || createSessionId(at);
    chunkIndexRef.current = 0;
    rollingRef.current = [];
    finalizedRef.current = [];
    draftRef.current = null;
    lastFinalizeReasonRef.current = null;
    bump();
  }, [bump]);

  const snapshot = useMemo(() => {
    void revision;
    const activeChunk = draftRef.current
      ? buildChunk(draftRef.current, null, configRef.current.maxChunkTranscriptChars)
      : null;
    const finalizedChunks = finalizedRef.current;
    const chunkHistory = activeChunk ? [...finalizedChunks, activeChunk] : finalizedChunks;
    const groups = new Map<string, ConversationChunk[]>();
    for (const chunk of chunkHistory) {
      const topic = chunk.topicHints[0] || 'general';
      groups.set(topic, [...(groups.get(topic) || []), chunk]);
    }
    const rollingTranscript = clip(
      rollingRef.current.map(segment => segment.text).join(' '),
      configRef.current.maxLiveTranscriptChars
    );

    return {
      activeChunk,
      finalizedChunks,
      chunkHistory,
      rollingTranscript,
      topicGroups: Array.from(groups.entries()).map(([topic, chunks]) => ({ topic, chunks })),
      diagnostics: {
        sessionId: sessionIdRef.current,
        liveTranscriptChars: rollingTranscript.length,
        retainedChunkCount: chunkHistory.length,
        finalizedChunkCount: finalizedChunks.length,
        activeTokenEstimate: activeChunk?.tokenEstimate || 0,
        lastFinalizeReason: lastFinalizeReasonRef.current,
      },
    };
  }, [revision]);

  return {
    sessionId: sessionIdRef.current,
    rollingTranscript: snapshot.rollingTranscript,
    activeChunk: snapshot.activeChunk,
    finalizedChunks: snapshot.finalizedChunks,
    chunkHistory: snapshot.chunkHistory,
    topicGroups: snapshot.topicGroups,
    diagnostics: snapshot.diagnostics,
    ingestPartialTranscript,
    ingestFinalTranscript,
    markSilenceBoundary,
    finalizeOpenChunk,
    resetChunks,
  };
}
