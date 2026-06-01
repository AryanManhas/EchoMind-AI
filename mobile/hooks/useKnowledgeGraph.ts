import { useMemo, useRef } from 'react';
import type { ConversationMemory } from './usePersistentMemory';
import type { ReminderTask } from './useReminderEngine';
import type { ConversationIntelligence } from './useConversationIntelligence';

export type KnowledgeEntityType =
  | 'person'
  | 'project'
  | 'task'
  | 'meeting'
  | 'goal'
  | 'topic'
  | 'reminder'
  | 'organization';

export type KnowledgeRelationshipType =
  | 'assigned_to'
  | 'collaborates_with'
  | 'related_to'
  | 'blocked_by'
  | 'depends_on'
  | 'discussed_in'
  | 'continues_from';

export type KnowledgeEntity = {
  entityId: string;
  entityType: KnowledgeEntityType;
  canonicalName: string;
  aliases: string[];
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeRelationship = {
  relationshipId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: KnowledgeRelationshipType;
  strengthScore: number;
  createdAt: number;
  updatedAt: number;
};

export type EntityLinkedMemory = {
  memoryId: string;
  sessionId: string;
  entityIds: string[];
  relationshipIds: string[];
  projectEntityIds: string[];
};

export type KnowledgeProjectTimeline = {
  projectId: string;
  title: string;
  aliases: string[];
  memoryIds: string[];
  sessionIds: string[];
  participants: string[];
  unresolvedTasks: string[];
  decisions: string[];
  reminders: string[];
  lastInteractionAt: number;
  continuityScore: number;
};

export type ParticipantIntelligence = {
  entityId: string;
  name: string;
  assignments: string[];
  projects: string[];
  meetings: string[];
  interactionCount: number;
  lastInteractionAt: number;
};

export type RecurringTopic = {
  entityId: string;
  name: string;
  mentionCount: number;
  sessionIds: string[];
  lastMentionedAt: number;
};

export type KnowledgeGraphSnapshot = {
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  linkedMemories: EntityLinkedMemory[];
  projectTimelines: KnowledgeProjectTimeline[];
  participants: ParticipantIntelligence[];
  recurringTopics: RecurringTopic[];
  contextText: string;
  prompts: string[];
  diagnostics: {
    entityCount: number;
    relationshipCount: number;
    projectCount: number;
    participantCount: number;
    recurringTopicCount: number;
    bounded: boolean;
  };
};

export type KnowledgeGraphInput = {
  memories: ConversationMemory[];
  reminders: ReminderTask[];
  query?: string;
  limits?: Partial<KnowledgeGraphLimits>;
};

export type KnowledgeGraphLimits = {
  maxEntities: number;
  maxRelationships: number;
  maxAliasesPerEntity: number;
  maxProjects: number;
  maxParticipants: number;
  maxTopics: number;
  maxContextCharacters: number;
  maxMemories: number;
};

type EntityCandidate = {
  type: KnowledgeEntityType;
  name: string;
  aliases?: string[];
  createdAt: number;
  updatedAt: number;
  memoryId: string;
  sessionId: string;
};

type RelationshipCandidate = {
  sourceName: string;
  sourceType: KnowledgeEntityType;
  targetName: string;
  targetType: KnowledgeEntityType;
  type: KnowledgeRelationshipType;
  weight: number;
  createdAt: number;
  updatedAt: number;
  memoryId: string;
  sessionId: string;
};

type GeminiKnowledgeNormalization = {
  entities?: Array<{ canonicalName?: unknown; aliases?: unknown }>;
  relationships?: Array<{ source?: unknown; target?: unknown; relationshipType?: unknown }>;
};

const DEFAULT_LIMITS: KnowledgeGraphLimits = {
  maxEntities: 180,
  maxRelationships: 320,
  maxAliasesPerEntity: 6,
  maxProjects: 8,
  maxParticipants: 10,
  maxTopics: 12,
  maxContextCharacters: 1100,
  maxMemories: 120,
};

const ENTITY_TYPE_PRIORITY: Record<KnowledgeEntityType, number> = {
  project: 0,
  person: 1,
  task: 2,
  reminder: 3,
  goal: 4,
  meeting: 5,
  organization: 6,
  topic: 7,
};

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'have',
  'need',
  'task',
  'tasks',
  'project',
  'discussion',
  'meeting',
  'general',
]);

const PROJECT_TERMS = [
  'deployment',
  'backend',
  'frontend',
  'presentation',
  'stabilization',
  'launch',
  'release',
  'dashboard',
  'vault',
  'memory',
  'echo',
  'echomind',
  'api',
  'mobile',
];

const PROJECT_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: 'EchoMind deployment',
    aliases: ['echomind deployment', 'deployment project', 'backend deployment', 'deployment flow'],
  },
  {
    canonical: 'Backend stabilization',
    aliases: ['backend stabilization', 'backend', 'api stabilization', 'server stabilization'],
  },
  {
    canonical: 'AI presentation',
    aliases: ['ai presentation', 'presentation slides', 'slides', 'deck'],
  },
];

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, maxLength = 150): string {
  const clean = compact(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function titleCase(text: string): string {
  return compact(text)
    .split(' ')
    .map(word => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ');
}

function normalizeAlias(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalAlias(value: string, type: KnowledgeEntityType): string {
  const normalized = normalizeAlias(value);
  const aliasMatch = PROJECT_ALIASES.find(item =>
    item.aliases.some(alias => normalizeAlias(alias) === normalized)
  );
  if (type === 'project' && aliasMatch) return aliasMatch.canonical;

  if (type === 'project') {
    if (normalized === 'backend' || normalized === 'backend deployment') return 'Backend stabilization';
    if (normalized === 'deployment project' || normalized === 'deployment') return 'EchoMind deployment';
  }

  return titleCase(normalized || value);
}

function slug(value: string): string {
  return normalizeAlias(value).replace(/\s+/g, '-').slice(0, 64) || 'unknown';
}

function entityIdFor(type: KnowledgeEntityType, canonicalName: string): string {
  return `kg:${type}:${slug(canonicalName)}`;
}

function relationshipIdFor(
  sourceEntityId: string,
  targetEntityId: string,
  type: KnowledgeRelationshipType
): string {
  return `kr:${type}:${sourceEntityId.replace(/^kg:/, '')}:${targetEntityId.replace(/^kg:/, '')}`.slice(0, 180);
}

function unique(values: Array<string | undefined | null>, limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = compact(value || '');
    if (!clean) continue;
    const key = normalizeAlias(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= limit) break;
  }
  return output;
}

function tokens(text: string): string[] {
  return Array.from(
    new Set(
      normalizeAlias(text)
        .split(' ')
        .filter(token => token.length > 2 && !STOP_WORDS.has(token))
    )
  );
}

function intelligenceOf(memory: ConversationMemory): ConversationIntelligence[] {
  return memory.conversationIntelligence || [];
}

function allTopicHints(memory: ConversationMemory): string[] {
  return unique([
    ...(memory.tags || []),
    ...(memory.continuationSnapshot?.activeTopics || []),
    ...intelligenceOf(memory).flatMap(item => item.discussedTopics),
    ...(memory.conversationChunks || []).flatMap(chunk => chunk.topicHints),
  ], 20);
}

function allParticipants(memory: ConversationMemory): string[] {
  return unique([
    ...(memory.participants || []),
    ...(memory.continuationSnapshot?.participants || []),
    ...intelligenceOf(memory).flatMap(item => item.participants),
    ...intelligenceOf(memory).flatMap(item => item.assignments.map(assignment => assignment.person)),
    ...memory.semanticObjects.flatMap(object => object.participants || []),
  ], 20);
}

function allTasks(memory: ConversationMemory): string[] {
  return unique([
    ...(memory.extractedTasks || []),
    ...(memory.continuationSnapshot?.unresolvedTasks || []),
    ...intelligenceOf(memory).flatMap(item => [...item.tasks, ...item.actionItems, ...item.followUps]),
  ], 20);
}

function allReminders(memory: ConversationMemory, reminders: ReminderTask[]): string[] {
  const linked = reminders
    .filter(reminder => reminder.sourceSessionId === memory.sessionId)
    .filter(reminder => reminder.state === 'pending' || reminder.state === 'scheduled' || reminder.state === 'triggered')
    .map(reminder => reminder.title);
  return unique([
    ...(memory.reminders || []),
    ...(memory.continuationSnapshot?.pendingReminders || []),
    ...intelligenceOf(memory).flatMap(item => item.reminders),
    ...linked,
  ], 20);
}

function allDecisions(memory: ConversationMemory): string[] {
  return unique([
    ...(memory.continuationSnapshot?.recentDecisions || []),
    ...intelligenceOf(memory).flatMap(item => item.decisions),
  ], 20);
}

function detectProjectNames(memory: ConversationMemory): string[] {
  const source = [
    memory.sessionTitle,
    memory.semanticSummary,
    ...(memory.highlights || []),
    ...allTopicHints(memory),
  ].join(' ');
  const lower = normalizeAlias(source);
  const explicit = PROJECT_ALIASES
    .filter(item => item.aliases.some(alias => lower.includes(normalizeAlias(alias))))
    .map(item => item.canonical);
  const termHits = PROJECT_TERMS.filter(term => lower.includes(term));
  const inferred: string[] = [];

  if (lower.includes('echomind') && (lower.includes('deploy') || lower.includes('release'))) {
    inferred.push('EchoMind deployment');
  }
  if (lower.includes('backend') && (lower.includes('stabil') || lower.includes('deploy') || lower.includes('api'))) {
    inferred.push('Backend stabilization');
  }
  if (lower.includes('presentation') || lower.includes('slides') || lower.includes('deck')) {
    inferred.push('AI presentation');
  }
  if (termHits.length >= 2) {
    inferred.push(titleCase(termHits.slice(0, 2).join(' ')));
  }

  return unique([...explicit, ...inferred], 4);
}

function detectGoalNames(memory: ConversationMemory): string[] {
  const goalLines = [
    ...intelligenceOf(memory).flatMap(item => [...item.importantPoints, ...item.actionItems]),
    ...(memory.continuationSnapshot?.importantContext || []),
  ];
  return unique(
    goalLines
      .filter(line => /\b(goal|objective|plan|prepare|finish|complete|ship|launch|stabilize|deploy)\b/i.test(line))
      .map(line => clip(line, 100)),
    6
  );
}

function extractEntityCandidates(memory: ConversationMemory, reminders: ReminderTask[]): EntityCandidate[] {
  const createdAt = memory.createdAt;
  const updatedAt = memory.updatedAt || memory.finalizedAt || createdAt;
  const base = { createdAt, updatedAt, memoryId: memory.id, sessionId: memory.sessionId };
  const candidates: EntityCandidate[] = [];

  for (const person of allParticipants(memory)) candidates.push({ ...base, type: 'person', name: person });
  for (const project of detectProjectNames(memory)) candidates.push({ ...base, type: 'project', name: project });
  for (const task of allTasks(memory)) candidates.push({ ...base, type: 'task', name: task });
  for (const reminder of allReminders(memory, reminders)) candidates.push({ ...base, type: 'reminder', name: reminder });
  for (const goal of detectGoalNames(memory)) candidates.push({ ...base, type: 'goal', name: goal });
  for (const topic of allTopicHints(memory)) candidates.push({ ...base, type: 'topic', name: topic });
  if (memory.sessionType === 'meeting' || intelligenceOf(memory).some(item => item.meetings.length > 0)) {
    candidates.push({
      ...base,
      type: 'meeting',
      name: memory.sessionTitle || `Meeting ${new Date(createdAt).toLocaleDateString()}`,
    });
  }

  return candidates;
}

function chooseProject(memory: ConversationMemory): string | null {
  return detectProjectNames(memory)[0] || null;
}

function extractRelationshipCandidates(memory: ConversationMemory, reminders: ReminderTask[]): RelationshipCandidate[] {
  const createdAt = memory.createdAt;
  const updatedAt = memory.updatedAt || memory.finalizedAt || createdAt;
  const base = { createdAt, updatedAt, memoryId: memory.id, sessionId: memory.sessionId };
  const relationships: RelationshipCandidate[] = [];
  const project = chooseProject(memory);
  const participants = allParticipants(memory);
  const tasks = allTasks(memory);
  const reminderNames = allReminders(memory, reminders);
  const topics = allTopicHints(memory);
  const meetingName = memory.sessionType === 'meeting' ? memory.sessionTitle || `Meeting ${new Date(createdAt).toLocaleDateString()}` : null;

  for (const assignment of intelligenceOf(memory).flatMap(item => item.assignments)) {
    relationships.push({
      ...base,
      sourceName: assignment.responsibility,
      sourceType: 'task',
      targetName: assignment.person,
      targetType: 'person',
      type: 'assigned_to',
      weight: 24,
    });
  }

  for (const person of participants) {
    if (project) {
      relationships.push({
        ...base,
        sourceName: person,
        sourceType: 'person',
        targetName: project,
        targetType: 'project',
        type: 'collaborates_with',
        weight: 18,
      });
    }
    if (meetingName) {
      relationships.push({
        ...base,
        sourceName: person,
        sourceType: 'person',
        targetName: meetingName,
        targetType: 'meeting',
        type: 'discussed_in',
        weight: 12,
      });
    }
  }

  for (const task of tasks) {
    if (project) {
      relationships.push({
        ...base,
        sourceName: task,
        sourceType: 'task',
        targetName: project,
        targetType: 'project',
        type: 'depends_on',
        weight: 14,
      });
    }
    for (const reminder of reminderNames.slice(0, 3)) {
      relationships.push({
        ...base,
        sourceName: reminder,
        sourceType: 'reminder',
        targetName: task,
        targetType: 'task',
        type: 'related_to',
        weight: 10,
      });
    }
  }

  for (const topic of topics.slice(0, 5)) {
    if (project) {
      relationships.push({
        ...base,
        sourceName: topic,
        sourceType: 'topic',
        targetName: project,
        targetType: 'project',
        type: 'related_to',
        weight: 9,
      });
    }
    if (meetingName) {
      relationships.push({
        ...base,
        sourceName: topic,
        sourceType: 'topic',
        targetName: meetingName,
        targetType: 'meeting',
        type: 'discussed_in',
        weight: 8,
      });
    }
  }

  if (memory.continuationSnapshot?.threadId && project) {
    relationships.push({
      ...base,
      sourceName: memory.continuationSnapshot.threadId,
      sourceType: 'topic',
      targetName: project,
      targetType: 'project',
      type: 'continues_from',
      weight: 18,
    });
  }

  return relationships;
}

function entitySort(a: KnowledgeEntity, b: KnowledgeEntity): number {
  return ENTITY_TYPE_PRIORITY[a.entityType] - ENTITY_TYPE_PRIORITY[b.entityType] ||
    b.updatedAt - a.updatedAt ||
    a.canonicalName.localeCompare(b.canonicalName);
}

function buildEntities(
  candidates: EntityCandidate[],
  limits: KnowledgeGraphLimits
): { entities: KnowledgeEntity[]; keyToId: Map<string, string> } {
  const entitiesByKey = new Map<string, KnowledgeEntity>();
  const keyToId = new Map<string, string>();

  for (const candidate of candidates) {
    const canonicalName = canonicalAlias(candidate.name, candidate.type);
    const key = `${candidate.type}:${normalizeAlias(canonicalName)}`;
    const aliases = unique([candidate.name, canonicalName, ...(candidate.aliases || [])], limits.maxAliasesPerEntity);
    const existing = entitiesByKey.get(key);
    if (existing) {
      existing.aliases = unique([...existing.aliases, ...aliases], limits.maxAliasesPerEntity);
      existing.createdAt = Math.min(existing.createdAt, candidate.createdAt);
      existing.updatedAt = Math.max(existing.updatedAt, candidate.updatedAt);
    } else {
      const entityId = entityIdFor(candidate.type, canonicalName);
      entitiesByKey.set(key, {
        entityId,
        entityType: candidate.type,
        canonicalName,
        aliases,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      });
      for (const alias of aliases) keyToId.set(`${candidate.type}:${normalizeAlias(alias)}`, entityId);
      keyToId.set(key, entityId);
    }
  }

  const entities = Array.from(entitiesByKey.values()).sort(entitySort).slice(0, limits.maxEntities);
  const boundedIds = new Set(entities.map(entity => entity.entityId));
  for (const [key, id] of Array.from(keyToId.entries())) {
    if (!boundedIds.has(id)) keyToId.delete(key);
  }
  return { entities, keyToId };
}

function resolveEntityId(keyToId: Map<string, string>, type: KnowledgeEntityType, name: string): string | null {
  const canonicalName = canonicalAlias(name, type);
  return keyToId.get(`${type}:${normalizeAlias(canonicalName)}`) || keyToId.get(`${type}:${normalizeAlias(name)}`) || null;
}

function buildRelationships(
  candidates: RelationshipCandidate[],
  keyToId: Map<string, string>,
  limits: KnowledgeGraphLimits
): KnowledgeRelationship[] {
  const relationshipsById = new Map<string, KnowledgeRelationship>();
  for (const candidate of candidates) {
    const sourceEntityId = resolveEntityId(keyToId, candidate.sourceType, candidate.sourceName);
    const targetEntityId = resolveEntityId(keyToId, candidate.targetType, candidate.targetName);
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) continue;
    const relationshipId = relationshipIdFor(sourceEntityId, targetEntityId, candidate.type);
    const existing = relationshipsById.get(relationshipId);
    if (existing) {
      existing.strengthScore = Math.min(100, existing.strengthScore + candidate.weight);
      existing.createdAt = Math.min(existing.createdAt, candidate.createdAt);
      existing.updatedAt = Math.max(existing.updatedAt, candidate.updatedAt);
    } else {
      relationshipsById.set(relationshipId, {
        relationshipId,
        sourceEntityId,
        targetEntityId,
        relationshipType: candidate.type,
        strengthScore: Math.min(100, candidate.weight),
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      });
    }
  }
  return Array.from(relationshipsById.values())
    .sort((a, b) => b.strengthScore - a.strengthScore || b.updatedAt - a.updatedAt)
    .slice(0, limits.maxRelationships);
}

function buildLinkedMemories(
  memories: ConversationMemory[],
  entityCandidates: EntityCandidate[],
  relationshipCandidates: RelationshipCandidate[],
  keyToId: Map<string, string>
): EntityLinkedMemory[] {
  return memories.map(memory => {
    const entityIds = unique(
      entityCandidates
        .filter(candidate => candidate.memoryId === memory.id)
        .map(candidate => resolveEntityId(keyToId, candidate.type, candidate.name) || ''),
      30
    );
    const projectEntityIds = unique(
      entityCandidates
        .filter(candidate => candidate.memoryId === memory.id && candidate.type === 'project')
        .map(candidate => resolveEntityId(keyToId, candidate.type, candidate.name) || ''),
      8
    );
    const relationshipIds = unique(
      relationshipCandidates
        .filter(candidate => candidate.memoryId === memory.id)
        .map(candidate => {
          const sourceEntityId = resolveEntityId(keyToId, candidate.sourceType, candidate.sourceName);
          const targetEntityId = resolveEntityId(keyToId, candidate.targetType, candidate.targetName);
          return sourceEntityId && targetEntityId ? relationshipIdFor(sourceEntityId, targetEntityId, candidate.type) : '';
        }),
      40
    );
    return {
      memoryId: memory.id,
      sessionId: memory.sessionId,
      entityIds,
      relationshipIds,
      projectEntityIds,
    };
  });
}

function buildProjectTimelines(
  entities: KnowledgeEntity[],
  linkedMemories: EntityLinkedMemory[],
  memories: ConversationMemory[],
  limits: KnowledgeGraphLimits
): KnowledgeProjectTimeline[] {
  const memoriesById = new Map(memories.map(memory => [memory.id, memory]));
  return entities
    .filter(entity => entity.entityType === 'project')
    .map(entity => {
      const links = linkedMemories.filter(link => link.projectEntityIds.includes(entity.entityId));
      const projectMemories = links
        .map(link => memoriesById.get(link.memoryId))
        .filter((memory): memory is ConversationMemory => Boolean(memory))
        .sort((a, b) => (b.finalizedAt || b.updatedAt) - (a.finalizedAt || a.updatedAt));
      const participants = unique(projectMemories.flatMap(allParticipants), 8);
      const unresolvedTasks = unique(projectMemories.flatMap(memory => memory.continuationSnapshot?.unresolvedTasks || allTasks(memory)), 8);
      const decisions = unique(projectMemories.flatMap(allDecisions), 6);
      const reminders = unique(projectMemories.flatMap(memory => memory.continuationSnapshot?.pendingReminders || memory.reminders || []), 6);
      const lastInteractionAt = Math.max(...projectMemories.map(memory => memory.finalizedAt || memory.updatedAt || memory.createdAt), entity.updatedAt);
      return {
        projectId: entity.entityId,
        title: entity.canonicalName,
        aliases: entity.aliases,
        memoryIds: projectMemories.map(memory => memory.id).slice(0, 16),
        sessionIds: projectMemories.map(memory => memory.sessionId).slice(0, 16),
        participants,
        unresolvedTasks,
        decisions,
        reminders,
        lastInteractionAt,
        continuityScore: Math.min(projectMemories.length * 12 + unresolvedTasks.length * 10 + reminders.length * 8 + decisions.length * 6, 100),
      };
    })
    .filter(project => project.memoryIds.length > 0)
    .sort((a, b) => b.continuityScore - a.continuityScore || b.lastInteractionAt - a.lastInteractionAt)
    .slice(0, limits.maxProjects);
}

function buildParticipants(
  entities: KnowledgeEntity[],
  relationships: KnowledgeRelationship[],
  projectTimelines: KnowledgeProjectTimeline[],
  memories: ConversationMemory[],
  limits: KnowledgeGraphLimits
): ParticipantIntelligence[] {
  const personEntities = entities.filter(entity => entity.entityType === 'person');
  return personEntities
    .map(entity => {
      const lowerAliases = entity.aliases.map(normalizeAlias);
      const relatedMemories = memories.filter(memory =>
        allParticipants(memory).some(person => lowerAliases.includes(normalizeAlias(person)))
      );
      const assignments = unique(
        relatedMemories.flatMap(memory =>
          intelligenceOf(memory)
            .flatMap(item => item.assignments)
            .filter(assignment => lowerAliases.includes(normalizeAlias(assignment.person)))
            .map(assignment => assignment.responsibility)
        ),
        8
      );
      const projects = projectTimelines
        .filter(project => project.participants.some(person => lowerAliases.includes(normalizeAlias(person))))
        .map(project => project.title)
        .slice(0, 6);
      const meetings = unique(
        relatedMemories
          .filter(memory => memory.sessionType === 'meeting')
          .map(memory => memory.sessionTitle || memory.semanticSummary),
        5
      );
      const interactionCount = relatedMemories.length +
        relationships.filter(rel => rel.sourceEntityId === entity.entityId || rel.targetEntityId === entity.entityId).length;
      const lastInteractionAt = Math.max(...relatedMemories.map(memory => memory.finalizedAt || memory.updatedAt || memory.createdAt), entity.updatedAt);
      return {
        entityId: entity.entityId,
        name: entity.canonicalName,
        assignments,
        projects,
        meetings,
        interactionCount,
        lastInteractionAt,
      };
    })
    .filter(person => person.interactionCount > 0)
    .sort((a, b) => b.interactionCount - a.interactionCount || b.lastInteractionAt - a.lastInteractionAt)
    .slice(0, limits.maxParticipants);
}

function buildRecurringTopics(
  entities: KnowledgeEntity[],
  linkedMemories: EntityLinkedMemory[],
  memories: ConversationMemory[],
  limits: KnowledgeGraphLimits
): RecurringTopic[] {
  const memoriesById = new Map(memories.map(memory => [memory.id, memory]));
  return entities
    .filter(entity => entity.entityType === 'topic')
    .map(entity => {
      const links = linkedMemories.filter(link => link.entityIds.includes(entity.entityId));
      const linked = links
        .map(link => memoriesById.get(link.memoryId))
        .filter((memory): memory is ConversationMemory => Boolean(memory));
      return {
        entityId: entity.entityId,
        name: entity.canonicalName,
        mentionCount: linked.length,
        sessionIds: linked.map(memory => memory.sessionId).slice(0, 10),
        lastMentionedAt: Math.max(...linked.map(memory => memory.finalizedAt || memory.updatedAt || memory.createdAt), entity.updatedAt),
      };
    })
    .filter(topic => topic.mentionCount >= 2)
    .sort((a, b) => b.mentionCount - a.mentionCount || b.lastMentionedAt - a.lastMentionedAt)
    .slice(0, limits.maxTopics);
}

function queryRelevance(query: string | undefined, text: string): number {
  if (!query) return 0;
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;
  const lower = normalizeAlias(text);
  return queryTokens.filter(token => lower.includes(token)).length;
}

export function buildKnowledgeGraphContext(
  graph: Pick<KnowledgeGraphSnapshot, 'projectTimelines' | 'participants' | 'recurringTopics'>,
  query?: string,
  maxCharacters = DEFAULT_LIMITS.maxContextCharacters
): string {
  const projects = [...graph.projectTimelines]
    .sort((a, b) => queryRelevance(query, [a.title, ...a.aliases, ...a.unresolvedTasks].join(' ')) * -40 || b.continuityScore - a.continuityScore)
    .slice(0, 4);
  const people = [...graph.participants]
    .sort((a, b) => queryRelevance(query, [a.name, ...a.projects, ...a.assignments].join(' ')) * -30 || b.interactionCount - a.interactionCount)
    .slice(0, 5);
  const topics = [...graph.recurringTopics]
    .sort((a, b) => queryRelevance(query, a.name) * -20 || b.mentionCount - a.mentionCount)
    .slice(0, 6);

  const blocks: string[] = [];
  for (const project of projects) {
    blocks.push([
      `Project: ${project.title}`,
      project.unresolvedTasks.length ? `Unresolved: ${project.unresolvedTasks.slice(0, 3).map(item => clip(item, 90)).join('; ')}` : '',
      project.decisions.length ? `Decisions: ${project.decisions.slice(0, 2).map(item => clip(item, 90)).join('; ')}` : '',
      project.participants.length ? `People: ${project.participants.slice(0, 4).join(', ')}` : '',
    ].filter(Boolean).join('\n'));
  }
  if (people.length > 0) {
    blocks.push(`Participants: ${people.map(person => {
      const assignment = person.assignments[0] ? ` (${clip(person.assignments[0], 48)})` : '';
      return `${person.name}${assignment}`;
    }).join('; ')}`);
  }
  if (topics.length > 0) {
    blocks.push(`Recurring topics: ${topics.map(topic => `${topic.name} x${topic.mentionCount}`).join(', ')}`);
  }

  const context = blocks.filter(Boolean).join('\n\n');
  return context.length > maxCharacters ? `${context.slice(0, Math.max(0, maxCharacters - 3)).trim()}...` : context;
}

function buildPrompts(projects: KnowledgeProjectTimeline[], participants: ParticipantIntelligence[]): string[] {
  const prompts: string[] = [];
  const activeProject = projects.find(project => project.unresolvedTasks.length > 0 || project.reminders.length > 0);
  if (activeProject) {
    prompts.push(`Resume ${activeProject.title} project?`);
    if (activeProject.unresolvedTasks.length > 0) {
      prompts.push(`${activeProject.unresolvedTasks.length} unresolved ${activeProject.title.toLowerCase()} item${activeProject.unresolvedTasks.length === 1 ? '' : 's'} remain.`);
    }
  }
  const assignedPerson = participants.find(person => person.assignments.length > 0);
  if (assignedPerson) {
    prompts.push(`${assignedPerson.name} is still linked to ${clip(assignedPerson.assignments[0], 54)}.`);
  }
  return prompts.slice(0, 3);
}

export function buildKnowledgeGraphSnapshot(input: KnowledgeGraphInput): KnowledgeGraphSnapshot {
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) };
  const memories = [...input.memories]
    .sort((a, b) => (b.finalizedAt || b.updatedAt) - (a.finalizedAt || a.updatedAt))
    .slice(0, limits.maxMemories);
  const entityCandidates = memories.flatMap(memory => extractEntityCandidates(memory, input.reminders));
  const relationshipCandidates = memories.flatMap(memory => extractRelationshipCandidates(memory, input.reminders));
  const { entities, keyToId } = buildEntities(entityCandidates, limits);
  const relationships = buildRelationships(relationshipCandidates, keyToId, limits);
  const linkedMemories = buildLinkedMemories(memories, entityCandidates, relationshipCandidates, keyToId);
  const projectTimelines = buildProjectTimelines(entities, linkedMemories, memories, limits);
  const participants = buildParticipants(entities, relationships, projectTimelines, memories, limits);
  const recurringTopics = buildRecurringTopics(entities, linkedMemories, memories, limits);
  const contextText = buildKnowledgeGraphContext({ projectTimelines, participants, recurringTopics }, input.query, limits.maxContextCharacters);
  const prompts = buildPrompts(projectTimelines, participants);

  return {
    entities,
    relationships,
    linkedMemories,
    projectTimelines,
    participants,
    recurringTopics,
    contextText,
    prompts,
    diagnostics: {
      entityCount: entities.length,
      relationshipCount: relationships.length,
      projectCount: projectTimelines.length,
      participantCount: participants.length,
      recurringTopicCount: recurringTopics.length,
      bounded: entityCandidates.length > entities.length || relationshipCandidates.length > relationships.length,
    },
  };
}

function parseGeminiJson(text: string): GeminiKnowledgeNormalization | null {
  try {
    const parsed = JSON.parse(text.trim());
    return parsed && typeof parsed === 'object' ? parsed as GeminiKnowledgeNormalization : null;
  } catch {
    return null;
  }
}

export async function enhanceKnowledgeGraphWithGemini(
  graph: KnowledgeGraphSnapshot,
  inputText: string,
  timeoutMs = 3500
): Promise<GeminiKnowledgeNormalization | null> {
  if (!GEMINI_API_KEY || !inputText.trim()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('knowledge_graph_timeout'), timeoutMs);
  const allowedEntities = graph.entities.slice(0, 40).map(entity => ({
    entityId: entity.entityId,
    entityType: entity.entityType,
    canonicalName: entity.canonicalName,
    aliases: entity.aliases.slice(0, 3),
  }));
  const prompt = [
    'Return ONLY strict JSON.',
    'You may normalize names or clarify relationships ONLY among allowed entities.',
    'Do not invent entities. Do not add prose.',
    '{"entities":[{"canonicalName":"","aliases":[]}],"relationships":[{"source":"","target":"","relationshipType":"related_to"}]}',
    `Allowed entities: ${JSON.stringify(allowedEntities)}`,
    `Text: ${clip(inputText, 1200)}`,
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
          maxOutputTokens: 260,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return null;
    return parseGeminiJson(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function useKnowledgeGraph(input: KnowledgeGraphInput): KnowledgeGraphSnapshot {
  const cacheRef = useRef<{ key: string; snapshot: KnowledgeGraphSnapshot } | null>(null);
  const key = [
    input.query || '',
    input.memories.map(memory => `${memory.id}:${memory.updatedAt}:${memory.continuationSnapshot?.updatedAt || 0}`).join('|'),
    input.reminders.map(reminder => `${reminder.id}:${reminder.state}:${reminder.updatedAt}`).join('|'),
  ].join('::');

  return useMemo(() => {
    if (cacheRef.current?.key === key) return cacheRef.current.snapshot;
    const snapshot = buildKnowledgeGraphSnapshot(input);
    cacheRef.current = { key, snapshot };
    return snapshot;
  }, [input, key]);
}
