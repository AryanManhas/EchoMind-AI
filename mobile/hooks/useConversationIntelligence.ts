import { useCallback, useMemo, useRef, useState } from 'react';
import type { ConversationChunk } from './useConversationChunking';

export type ConversationAssignment = {
  person: string;
  responsibility: string;
};

export type ConversationIntelligence = {
  intelligenceId: string;
  sessionId: string;
  chunkId: string;
  createdAt: number;
  tasks: string[];
  reminders: string[];
  deadlines: string[];
  meetings: string[];
  participants: string[];
  decisions: string[];
  followUps: string[];
  importantPoints: string[];
  discussedTopics: string[];
  actionItems: string[];
  assignments: ConversationAssignment[];
  meetingSummary?: string;
  importanceScore: number;
  urgencyScore: number;
  confidenceScore: number;
};

export type ConversationIntelligenceConfig = {
  maxItemsPerField: number;
  maxGeminiInputChars: number;
  geminiTimeoutMs: number;
};

export type UseConversationIntelligenceReturn = {
  intelligence: ConversationIntelligence[];
  intelligenceByChunkId: Record<string, ConversationIntelligence>;
  diagnostics: {
    chunkCount: number;
    intelligenceCount: number;
    totalTasks: number;
    totalDeadlines: number;
    totalAssignments: number;
  };
  refreshIntelligence: () => ConversationIntelligence[];
  enhanceChunkWithGemini: (chunk: ConversationChunk) => Promise<ConversationIntelligence | null>;
};

const DEFAULT_CONFIG: ConversationIntelligenceConfig = {
  maxItemsPerField: 8,
  maxGeminiInputChars: 1600,
  geminiTimeoutMs: 8000,
};

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const TASK_PATTERN = /\b(?:todo|to-do|need to|needs to|must|have to|action item|i'll|i will|we need to|we'll|we will|should\s+(?:complete|finish|submit|review|finalize|prepare|send|call|deploy|deliver))\b/i;
const REMINDER_PATTERN = /\b(?:remind me|remember to|set a reminder|don't forget)\b/i;
const DEADLINE_PATTERN = /\b(?:deadline|due|by|before|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|eod|end of day)\b/i;
const MEETING_PATTERN = /\b(?:meeting|meet|call|sync|standup|review|demo|presentation)\b/i;
const DECISION_PATTERN = /\b(?:decided|decision|we will|we'll|approved|finalized|agreed|locked|chosen)\b/i;
const FOLLOW_UP_PATTERN = /\b(?:follow up|follow-up|circle back|check back|revisit|next step|pending)\b/i;
const IMPORTANT_PATTERN = /\b(?:important|urgent|critical|blocked|blocker|risk|deadline|decision|commitment|must|asap|key)\b/i;
const ASSIGNMENT_PATTERN = /\b([A-Z][a-z]+|I|We)\s+(?:will|shall|must|needs?\s+to|has\s+to|have\s+to|should\s+(?:complete|finish|submit|review|finalize|prepare|send|call|deploy|deliver)|prepare(?:s)?|deploy(?:s)?|build(?:s)?|create(?:s)?|finish(?:es)?|lead(?:s)?)\s+([^.!?]{3,120})/g;
const PARTICIPANT_PATTERN = /\b(?:with|for|by|from|call|meeting with|sync with|ask|tell)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
const DATE_PHRASE_PATTERN = /\b(?:today|tomorrow|tonight|next\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|eod|end of day|by\s+evening|within\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?)|weekly\s+review|before\s+[a-zA-Z]+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by\s+[A-Z]?[a-z]+day|by\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b/gi;
const PROJECT_PATTERN = /\b([A-Z][A-Za-z0-9]*(?:\s+(?:AI|App|API|Backend|Frontend|Presentation|Project|Deployment|Launch|Dashboard|Vault|Memory)){1,2})\b/g;

type GeminiShape = {
  tasks?: unknown;
  deadlines?: unknown;
  participants?: unknown;
  important_points?: unknown;
  follow_ups?: unknown;
  action_items?: unknown;
  decisions?: unknown;
  meeting_summary?: unknown;
};

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, maxLength = 160): string {
  const clean = compact(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trim()}...`;
}

function unique(values: Array<string | undefined | null>, limit: number): string[] {
  return Array.from(new Set(values.map(value => compact(value || '')).filter(Boolean))).slice(0, limit);
}

function sentences(text: string): string[] {
  return compact(text)
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function matchingSentences(text: string, pattern: RegExp, limit: number): string[] {
  return unique(sentences(text).filter(sentence => pattern.test(sentence)).map(sentence => clip(sentence)), limit);
}

function extractParticipants(text: string, chunk: ConversationChunk, limit: number): string[] {
  const participants = [...chunk.participants];
  for (const match of text.matchAll(PARTICIPANT_PATTERN)) {
    if (match[1]) participants.push(match[1]);
  }
  for (const assignment of extractAssignments(text, limit)) {
    if (assignment.person !== 'I' && assignment.person !== 'We' && assignment.person !== 'Aryan') participants.push(assignment.person);
  }
  return unique(participants, limit);
}

function extractDatePhrases(text: string, limit: number): string[] {
  return unique(Array.from(text.matchAll(DATE_PHRASE_PATTERN)).map(match => match[0]), limit);
}

function extractAssignments(text: string, limit: number): ConversationAssignment[] {
  const assignments: ConversationAssignment[] = [];
  for (const match of text.matchAll(ASSIGNMENT_PATTERN)) {
    let person = compact(match[1] || '');
    if (person.toLowerCase() === 'i' || person.toLowerCase() === 'we') {
      person = 'Aryan';
    }
    const responsibility = clip(match[2] || '', 140);
    if (person && responsibility) assignments.push({ person, responsibility });
  }
  const seen = new Set<string>();
  return assignments.filter(item => {
    const key = `${item.person}:${item.responsibility}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function extractTopics(text: string, chunk: ConversationChunk, limit: number): string[] {
  const projects = Array.from(text.matchAll(PROJECT_PATTERN)).map(match => match[1]);
  return unique([...chunk.topicHints, ...projects], limit);
}

function scoreUrgency(text: string, deadlines: string[], reminders: string[]): number {
  let score = deadlines.length * 18 + reminders.length * 14;
  if (/\b(urgent|asap|today|tonight|deadline|blocked|critical)\b/i.test(text)) score += 30;
  if (/\b(tomorrow|eod|end of day)\b/i.test(text)) score += 18;
  return Math.min(score, 100);
}

function scoreConfidence(chunk: ConversationChunk, intelligence: Pick<ConversationIntelligence, 'tasks' | 'deadlines' | 'participants' | 'decisions' | 'importantPoints' | 'assignments'>): number {
  let score = 58;
  if (chunk.transcript.length > 40) score += 8;
  score += Math.min(intelligence.tasks.length + intelligence.deadlines.length + intelligence.decisions.length, 5) * 5;
  score += Math.min(intelligence.participants.length + intelligence.assignments.length, 4) * 4;
  if (intelligence.importantPoints.length > 0) score += 6;
  return Math.min(score, 96);
}

function normalizeGeminiArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.filter(item => typeof item === 'string').map(item => clip(item, 160)), limit);
}

function mergeStringFields(base: string[], next: string[], limit: number): string[] {
  return unique([...base, ...next], limit);
}

function parseGeminiJson(text: string): GeminiShape | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractConversationIntelligence(
  chunk: ConversationChunk,
  configInput: Partial<ConversationIntelligenceConfig> = {}
): ConversationIntelligence {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  const text = [chunk.summary, chunk.transcript].filter(Boolean).join('. ');
  const tasks = mergeStringFields(chunk.tasks, matchingSentences(text, TASK_PATTERN, config.maxItemsPerField), config.maxItemsPerField);
  const reminders = mergeStringFields(chunk.reminders, matchingSentences(text, REMINDER_PATTERN, config.maxItemsPerField), config.maxItemsPerField);
  const deadlines = mergeStringFields(extractDatePhrases(text, config.maxItemsPerField), matchingSentences(text, DEADLINE_PATTERN, config.maxItemsPerField), config.maxItemsPerField);
  const meetings = matchingSentences(text, MEETING_PATTERN, config.maxItemsPerField);
  const decisions = matchingSentences(text, DECISION_PATTERN, config.maxItemsPerField);
  const followUps = matchingSentences(text, FOLLOW_UP_PATTERN, config.maxItemsPerField);
  const importantPoints = mergeStringFields(chunk.highlights, matchingSentences(text, IMPORTANT_PATTERN, config.maxItemsPerField), config.maxItemsPerField);
  const actionItems = mergeStringFields(tasks, matchingSentences(text, /\b(?:action item|next step|we need to|i'll|i will)\b/i, config.maxItemsPerField), config.maxItemsPerField);
  const assignments = extractAssignments(text, config.maxItemsPerField);
  const participants = extractParticipants(text, chunk, config.maxItemsPerField);
  const discussedTopics = extractTopics(text, chunk, config.maxItemsPerField);

  const partial = {
    tasks,
    deadlines,
    participants,
    decisions,
    importantPoints,
    assignments,
  };

  const meetingSummary = (() => {
    const isMeeting = text.toLowerCase().includes('meeting') || text.toLowerCase().includes('sync') || text.toLowerCase().includes('call') || participants.length > 0;
    if (isMeeting) {
      const pNames = participants.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ');
      const participantClause = pNames ? `Discussion with ${pNames}.` : 'Project sync meeting.';
      const decisionClause = decisions.length > 0 ? ` Decided: ${decisions[0].replace(/^(let's |we should |we will |to )*/i, '').trim()}` : '';
      const taskClause = actionItems.length > 0 ? ` Key tasks include: ${actionItems[0].replace(/^(let's |we should |we will |to )*/i, '').trim()}` : '';
      return `${participantClause}${decisionClause}${taskClause}`;
    }
    return undefined;
  })();

  return {
    intelligenceId: `${chunk.chunkId}:intel`,
    sessionId: chunk.sessionId,
    chunkId: chunk.chunkId,
    createdAt: chunk.finalizedAt || chunk.createdAt,
    tasks,
    reminders,
    deadlines,
    meetings,
    participants,
    decisions,
    followUps,
    importantPoints,
    discussedTopics,
    actionItems,
    assignments,
    meetingSummary,
    importanceScore: Math.min(chunk.importanceScore + importantPoints.length * 5 + decisions.length * 8 + assignments.length * 6, 100),
    urgencyScore: scoreUrgency(text, deadlines, reminders),
    confidenceScore: scoreConfidence(chunk, partial),
  };
}

export function mergeGeminiEnhancement(
  base: ConversationIntelligence,
  parsed: GeminiShape | null,
  maxItemsPerField = DEFAULT_CONFIG.maxItemsPerField
): ConversationIntelligence {
  if (!parsed) return base;
  const tasks = mergeStringFields(base.tasks, normalizeGeminiArray(parsed.tasks, maxItemsPerField), maxItemsPerField);
  const deadlines = mergeStringFields(base.deadlines, normalizeGeminiArray(parsed.deadlines, maxItemsPerField), maxItemsPerField);
  const participants = mergeStringFields(base.participants, normalizeGeminiArray(parsed.participants, maxItemsPerField), maxItemsPerField);
  const importantPoints = mergeStringFields(base.importantPoints, normalizeGeminiArray(parsed.important_points, maxItemsPerField), maxItemsPerField);
  const followUps = mergeStringFields(base.followUps, normalizeGeminiArray(parsed.follow_ups, maxItemsPerField), maxItemsPerField);
  const actionItems = mergeStringFields(base.actionItems, normalizeGeminiArray(parsed.action_items, maxItemsPerField), maxItemsPerField);
  const decisions = mergeStringFields(base.decisions, normalizeGeminiArray(parsed.decisions, maxItemsPerField), maxItemsPerField);
  
  let meetingSummary = base.meetingSummary;
  if (typeof parsed.meeting_summary === 'string' && parsed.meeting_summary.trim()) {
    meetingSummary = parsed.meeting_summary.trim();
  }

  return {
    ...base,
    tasks,
    deadlines,
    participants,
    importantPoints,
    followUps,
    actionItems,
    decisions,
    meetingSummary,
    importanceScore: Math.min(base.importanceScore + importantPoints.length * 2 + decisions.length * 3, 100),
    urgencyScore: Math.max(base.urgencyScore, scoreUrgency([...deadlines, ...actionItems].join(' '), deadlines, base.reminders)),
    confidenceScore: Math.min(base.confidenceScore + 4, 98),
  };
}

export async function enhanceConversationIntelligenceWithGemini(
  chunk: ConversationChunk,
  base: ConversationIntelligence,
  configInput: Partial<ConversationIntelligenceConfig> = {}
): Promise<ConversationIntelligence | null> {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  if (!GEMINI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('conversation_intelligence_timeout'), config.geminiTimeoutMs);
  const boundedText = clip([chunk.summary, chunk.transcript].join('\n'), config.maxGeminiInputChars);
  const prompt = [
    'Return ONLY strict JSON with keys:',
    '{"tasks":[],"deadlines":[],"participants":[],"important_points":[],"follow_ups":[],"action_items":[],"decisions":[],"meeting_summary":""}',
    'No markdown. No prose. Use short strings. Extract only explicit information.',
    'STRICT RULES:',
    '- deadlines: MUST ONLY contain concise temporal expressions (e.g., "Next Monday", "Friday evening", "Oct 12"). NO full sentences, context, or action items.',
    '- participants: MUST ONLY contain proper noun human names. NO dates, times, or days of the week.',
    '- action_items: Ensure any task context or descriptive action item text goes here, NOT in deadlines.',
    'For meeting_summary, if this looks like a meeting, provide a brief 1-2 sentence summary.',
    `Chunk:\n${boundedText}`,
  ].join('\n');

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 360,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return mergeGeminiEnhancement(base, parseGeminiJson(text), config.maxItemsPerField);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function useConversationIntelligence(
  chunks: ConversationChunk[],
  configInput: Partial<ConversationIntelligenceConfig> = {}
): UseConversationIntelligenceReturn {
  const configRef = useRef({ ...DEFAULT_CONFIG, ...configInput });
  configRef.current = { ...configRef.current, ...configInput };
  const [revision, setRevision] = useState(0);

  const refreshIntelligence = useCallback(() => {
    setRevision(value => value + 1);
    return chunks.map(chunk => extractConversationIntelligence(chunk, configRef.current));
  }, [chunks]);

  const intelligence = useMemo(() => {
    void revision;
    return chunks.map(chunk => extractConversationIntelligence(chunk, configRef.current));
  }, [chunks, revision]);

  const intelligenceByChunkId = useMemo(() => {
    return intelligence.reduce<Record<string, ConversationIntelligence>>((acc, item) => {
      acc[item.chunkId] = item;
      return acc;
    }, {});
  }, [intelligence]);

  const enhanceChunkWithGemini = useCallback(async (chunk: ConversationChunk) => {
    const base = intelligenceByChunkId[chunk.chunkId] || extractConversationIntelligence(chunk, configRef.current);
    return enhanceConversationIntelligenceWithGemini(chunk, base, configRef.current);
  }, [intelligenceByChunkId]);

  return {
    intelligence,
    intelligenceByChunkId,
    diagnostics: {
      chunkCount: chunks.length,
      intelligenceCount: intelligence.length,
      totalTasks: intelligence.reduce((sum, item) => sum + item.tasks.length + item.actionItems.length, 0),
      totalDeadlines: intelligence.reduce((sum, item) => sum + item.deadlines.length, 0),
      totalAssignments: intelligence.reduce((sum, item) => sum + item.assignments.length, 0),
    },
    refreshIntelligence,
    enhanceChunkWithGemini,
  };
}
