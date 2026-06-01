import { useMemo, useRef } from 'react';
import type { ConversationMemory } from './usePersistentMemory';
import type { ReminderTask } from './useReminderEngine';
import type { SemanticExtractionResult } from './useSemanticExtraction';
import {
  buildKnowledgeGraphSnapshot,
  type KnowledgeGraphSnapshot,
} from './useKnowledgeGraph';

export type ContextualRecallLimits = {
  maxSessions: number;
  maxSnippetLength: number;
  maxContextCharacters: number;
  maxReminderCount: number;
  maxCandidateSessions: number;
};

export type ContextualRecallMatch = {
  memory: ConversationMemory;
  score: number;
  reasons: string[];
  snippet: string;
  reminders: ReminderTask[];
};

export type ContextualRecallDiagnostics = {
  query: string;
  retrievedSessions: number;
  selectedSummaries: string[];
  contextSize: number;
  injectedReminders: number;
  graphContextSize: number;
  rankingReasons: Array<{
    sessionId: string;
    title: string;
    score: number;
    reasons: string[];
  }>;
};

export type ContextualRecallPayload = {
  contextText: string;
  matches: ContextualRecallMatch[];
  diagnostics: ContextualRecallDiagnostics;
};

export type UseContextualRecallInput = {
  query: string;
  memories: ConversationMemory[];
  reminders: ReminderTask[];
  semanticExtraction: SemanticExtractionResult | null;
  knowledgeGraph?: KnowledgeGraphSnapshot;
  limits?: Partial<ContextualRecallLimits>;
};

const DEFAULT_LIMITS: ContextualRecallLimits = {
  maxSessions: 4,
  maxSnippetLength: 220,
  maxContextCharacters: 1800,
  maxReminderCount: 6,
  maxCandidateSessions: 80,
};

const STOP_WORDS = new Set([
  'what',
  'did',
  'with',
  'show',
  'are',
  'the',
  'that',
  'this',
  'were',
  'was',
  'hai',
  'kya',
  'ka',
  'ki',
  'ke',
  'mein',
  'me',
  'mujhe',
  'mera',
  'mere',
  'aur',
]);

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, maxLength: number): string {
  const clean = compact(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter(token => token.length > 2 && !STOP_WORDS.has(token)) || []
    )
  );
}

function detectQueryShape(query: string) {
  const lower = query.toLowerCase();
  return {
    wantsPendingReminders: /\b(reminders?|pending|incomplete|tasks?|to[- ]?do)\b/.test(lower),
    wantsMeeting: /\b(meeting|meetings|discussion|discussions|call|calls)\b/.test(lower),
    wantsYesterday: /\b(yesterday|kal)\b/.test(lower),
    wantsToday: /\b(today|aaj)\b/.test(lower),
    wantsFollowUp: /\b(follow up|follow-up|incomplete|tasks?)\b/.test(lower),
  };
}

function isWithinDay(createdAt: number, offsetDays: number): boolean {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays);
  const start = target.getTime();
  const end = start + 86400000;
  return createdAt >= start && createdAt < end;
}

function buildSearchText(memory: ConversationMemory): string {
  return [
    memory.sessionTitle,
    memory.semanticSummary,
    memory.continuationSnapshot?.continuationSummary,
    ...(memory.continuationSnapshot?.activeTopics || []),
    ...(memory.continuationSnapshot?.unresolvedTasks || []),
    ...(memory.continuationSnapshot?.pendingReminders || []),
    ...(memory.continuationSnapshot?.recentDecisions || []),
    ...(memory.continuationSnapshot?.followUps || []),
    ...(memory.continuationSnapshot?.importantContext || []),
    ...(memory.highlights || []),
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
    ...(memory.participants || []),
    ...(memory.extractedTasks || []),
    ...(memory.reminders || []),
    ...(memory.tags || []),
    ...memory.semanticObjects.map(so => so.task || ''),
    ...memory.semanticObjects.flatMap(so => so.participants || []),
  ].join(' ').toLowerCase();
}

function graphBoost(memory: ConversationMemory, graph: KnowledgeGraphSnapshot | undefined, queryTokens: string[]): number {
  if (!graph || queryTokens.length === 0) return 0;
  const linked = graph.linkedMemories.find(link => link.memoryId === memory.id);
  if (!linked) return 0;
  const entityNames = graph.entities
    .filter(entity => linked.entityIds.includes(entity.entityId))
    .flatMap(entity => [entity.canonicalName, ...entity.aliases])
    .join(' ')
    .toLowerCase();
  const overlap = queryTokens.filter(token => entityNames.includes(token)).length;
  const projectWeight = linked.projectEntityIds.length > 0 ? 8 : 0;
  return Math.min(overlap * 10 + projectWeight, 32);
}

function activeReminderTasks(reminders: ReminderTask[]): ReminderTask[] {
  return reminders.filter(
    reminder =>
      reminder.state === 'pending' ||
      reminder.state === 'scheduled' ||
      reminder.state === 'triggered'
  );
}

function chunkExcerpt(memory: ConversationMemory, queryTokens: string[], maxLength: number): string {
  const chunks = memory.conversationChunks || [];
  if (chunks.length > 0) {
    const ranked = chunks
      .map(chunk => {
        const text = [
          chunk.summary,
          ...chunk.highlights,
          ...chunk.tasks,
          ...chunk.reminders,
          ...chunk.topicHints,
        ].join(' ');
        const lower = text.toLowerCase();
        const overlap = queryTokens.filter(token => lower.includes(token)).length;
        return { chunk, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap || b.chunk.importanceScore - a.chunk.importanceScore);
    const best = ranked[0]?.chunk;
    if (best) {
      return clip(
        [best.summary, ...best.highlights.slice(0, 2), ...best.tasks.slice(0, 1), ...best.reminders.slice(0, 1)]
          .filter(Boolean)
          .join('; '),
        maxLength
      );
    }
  }

  const transcript = memory.semanticSummary || '';
  if (!transcript) return '';

  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  const matched = sentences.find(sentence => {
    const lower = sentence.toLowerCase();
    return queryTokens.some(token => lower.includes(token));
  });

  return clip(matched || sentences[0] || transcript, maxLength);
}

function assembleSnippet(
  memory: ConversationMemory,
  reminderTasks: ReminderTask[],
  queryTokens: string[],
  limits: ContextualRecallLimits
): string {
  const lines: string[] = [];
  if (memory.semanticSummary) lines.push(`Summary: ${clip(memory.semanticSummary, limits.maxSnippetLength)}`);
  if (memory.highlights?.length) {
    lines.push(`Highlights: ${memory.highlights.slice(0, 3).map(h => clip(h, 90)).join('; ')}`);
  }
  const continuation = memory.continuationSnapshot;
  if (continuation?.continuationSummary) {
    lines.push(`Continuation: ${clip(continuation.continuationSummary, limits.maxSnippetLength)}`);
  }
  const structured = memory.conversationIntelligence || [];
  const structuredLines = [
    ...structured.flatMap(item => item.importantPoints).map(point => `important: ${point}`),
    ...structured.flatMap(item => item.decisions).map(decision => `decision: ${decision}`),
    ...structured.flatMap(item => item.deadlines).map(deadline => `deadline: ${deadline}`),
    ...structured.flatMap(item => item.followUps).map(followUp => `follow-up: ${followUp}`),
    ...structured.flatMap(item => item.assignments).map(assignment => `${assignment.person}: ${assignment.responsibility}`),
  ].slice(0, limits.maxReminderCount);
  if (structuredLines.length) lines.push(`Structured: ${structuredLines.map(line => clip(line, 90)).join('; ')}`);
  const reminderLines = [
    ...reminderTasks.map(task => `${task.state}: ${task.title}`),
    ...(memory.reminders || []).map(reminder => `reminder: ${reminder}`),
    ...(memory.extractedTasks || []).map(task => `task: ${task}`),
  ].slice(0, limits.maxReminderCount);
  if (reminderLines.length) lines.push(`Tasks/Reminders: ${reminderLines.map(line => clip(line, 90)).join('; ')}`);

  const excerpt = chunkExcerpt(memory, queryTokens, limits.maxSnippetLength);
  if (excerpt) lines.push(`Chunk: ${excerpt}`);

  return clip(lines.join('\n'), limits.maxSnippetLength * 3);
}

export function buildContextualRecallPayload(input: UseContextualRecallInput): ContextualRecallPayload {
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) };
  const query = compact(input.query);
  const queryTokens = tokenize(query);
  const queryShape = detectQueryShape(query);
  const now = Date.now();
  const knowledgeGraph = input.knowledgeGraph || buildKnowledgeGraphSnapshot({
    memories: input.memories,
    reminders: input.reminders,
    query,
    limits: {
      maxContextCharacters: 460,
      maxProjects: 4,
      maxParticipants: 5,
      maxTopics: 6,
    },
  });
  const remindersBySession = input.reminders.reduce<Record<string, ReminderTask[]>>((acc, reminder) => {
    if (!acc[reminder.sourceSessionId]) acc[reminder.sourceSessionId] = [];
    acc[reminder.sourceSessionId].push(reminder);
    return acc;
  }, {});

  const candidates = [...input.memories]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limits.maxCandidateSessions);

  const matches = candidates
    .map(memory => {
      const searchText = buildSearchText(memory);
      const participantTokens = (memory.participants || []).map(p => p.toLowerCase());
      const linkedReminders = remindersBySession[memory.sessionId] || [];
      const activeLinkedReminders = activeReminderTasks(linkedReminders);
      const reasons: string[] = [];
      let score = 0;

      const overlap = queryTokens.filter(token => searchText.includes(token));
      if (overlap.length > 0) {
        score += overlap.length * 12;
        reasons.push(`keyword overlap: ${overlap.slice(0, 4).join(', ')}`);
      }

      const participantMatches = queryTokens.filter(token =>
        participantTokens.some(participant => participant.includes(token))
      );
      if (participantMatches.length > 0) {
        score += participantMatches.length * 25;
        reasons.push(`participant match: ${participantMatches.join(', ')}`);
      }

      const intelligence = memory.conversationIntelligence || [];
      const unresolvedCount = intelligence.reduce(
        (count, item) => count + item.actionItems.length + item.followUps.length + item.deadlines.length,
        0
      );
      if (unresolvedCount > 0) {
        score += Math.min(unresolvedCount * 6, 24);
        reasons.push('structured action intelligence');
      }

      const decisionCount = intelligence.reduce((count, item) => count + item.decisions.length, 0);
      if (decisionCount > 0) {
        score += Math.min(decisionCount * 8, 24);
        reasons.push('decision intelligence');
      }

      if (input.semanticExtraction && memory.semanticObjects.some(so => so.type === input.semanticExtraction?.type)) {
        score += 14;
        reasons.push(`semantic type: ${input.semanticExtraction.type}`);
      }

      if (linkedReminders.length > 0) {
        score += Math.min(linkedReminders.length * 8, 20);
        reasons.push('linked reminders');
      }

      if (queryShape.wantsPendingReminders && activeLinkedReminders.length > 0) {
        score += 24;
        reasons.push('pending reminder match');
      }

      if (queryShape.wantsMeeting && memory.sessionType === 'meeting') {
        score += 22;
        reasons.push('meeting session');
      }

      if (queryShape.wantsFollowUp && memory.sessionType === 'follow_up') {
        score += 18;
        reasons.push('follow-up session');
      }

      if (queryShape.wantsYesterday && isWithinDay(memory.createdAt, 1)) {
        score += 28;
        reasons.push('yesterday');
      }

      if (queryShape.wantsToday && isWithinDay(memory.createdAt, 0)) {
        score += 20;
        reasons.push('today');
      }

      const ageDays = Math.max(0, (now - memory.createdAt) / 86400000);
      const recencyScore = Math.max(0, 14 - Math.floor(ageDays));
      if (recencyScore > 0) {
        score += recencyScore;
        reasons.push('recent');
      }

      const importanceScore = Math.min(Math.round((memory.importanceScore || 0) / 10), 10);
      if (importanceScore > 0) {
        score += importanceScore;
        reasons.push(`importance ${memory.importanceScore}`);
      }

      if (memory.sessionType === 'reminder' && queryShape.wantsPendingReminders) {
        score += 16;
        reasons.push('reminder session');
      }

      const graphScore = graphBoost(memory, knowledgeGraph, queryTokens);
      if (graphScore > 0) {
        score += graphScore;
        reasons.push('knowledge graph link');
      }

      return {
        memory,
        score,
        reasons,
        reminders: activeLinkedReminders.slice(0, limits.maxReminderCount),
        snippet: '',
      };
    })
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
    .slice(0, limits.maxSessions)
    .map(match => ({
      ...match,
      snippet: assembleSnippet(match.memory, match.reminders, queryTokens, limits),
    }));

  const contextLines: string[] = [];
  for (const match of matches) {
    const date = new Date(match.memory.createdAt).toLocaleDateString();
    const next = [
      `Session: ${match.memory.sessionTitle || 'Conversation'} (${match.memory.sessionType}, ${date})`,
      match.snippet,
    ].filter(Boolean).join('\n');

    const proposed = [...contextLines, next].join('\n\n');
    if (proposed.length > limits.maxContextCharacters) break;
    contextLines.push(next);
  }

  if (knowledgeGraph.contextText) {
    const graphBlock = `Knowledge graph:\n${knowledgeGraph.contextText}`;
    const proposed = [...contextLines, graphBlock].join('\n\n');
    if (proposed.length <= limits.maxContextCharacters) {
      contextLines.push(graphBlock);
    }
  }

  const contextText = contextLines.length > 0 ? contextLines.join('\n\n') : 'No relevant contextual memories.';
  const injectedReminders = matches.reduce((count, match) => count + match.reminders.length, 0);

  return {
    contextText,
    matches,
    diagnostics: {
      query,
      retrievedSessions: matches.length,
      selectedSummaries: matches.map(match => match.memory.semanticSummary || match.memory.sessionTitle || 'Conversation'),
      contextSize: contextText.length,
      injectedReminders,
      graphContextSize: knowledgeGraph.contextText.length,
      rankingReasons: matches.map(match => ({
        sessionId: match.memory.sessionId,
        title: match.memory.sessionTitle || 'Conversation',
        score: match.score,
        reasons: match.reasons,
      })),
    },
  };
}

export function useContextualRecall(input: UseContextualRecallInput): ContextualRecallPayload {
  const cacheRef = useRef<{ key: string; payload: ContextualRecallPayload } | null>(null);
  const key = [
    input.query,
    input.semanticExtraction?.type || 'none',
    input.memories.map(memory => `${memory.id}:${memory.updatedAt}:${memory.importanceScore}`).join('|'),
    input.reminders.map(reminder => `${reminder.id}:${reminder.state}:${reminder.updatedAt}`).join('|'),
  ].join('::');

  return useMemo(() => {
    if (cacheRef.current?.key === key) {
      return cacheRef.current.payload;
    }
    const payload = buildContextualRecallPayload(input);
    cacheRef.current = { key, payload };
    return payload;
  }, [input, key]);
}
