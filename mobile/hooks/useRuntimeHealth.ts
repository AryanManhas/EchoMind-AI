import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationChunk, ConversationChunkingDiagnostics } from './useConversationChunking';
import type { ContextualRecallPayload } from './useContextualRecall';
import type { ConversationContinuationResult } from './useConversationContinuation';
import type { KnowledgeGraphSnapshot } from './useKnowledgeGraph';
import type { ConversationMemory } from './usePersistentMemory';
import type { ProactiveAssistantSnapshot } from './useProactiveAssistant';
import type { ReminderTask } from './useReminderEngine';
import type { BackendSyncState } from './useBackendSync';

export type RuntimeHealthSnapshot = {
  snapshotId: string;
  createdAt: number;
  activeSessionCount: number;
  chunkCount: number;
  averageChunkSize: number;
  transcriptMemoryEstimate: number;
  promptTokenEstimate: number;
  contextualRecallSize: number;
  continuationDepth: number;
  graphEntityCount: number;
  graphRelationshipCount: number;
  proactiveSignalCount: number;
  activeReminderCount: number;
  websocketReconnectCount: number;
  syncQueueSize: number;
  memoryVaultSize: number;
  notificationRate: number;
  memoryHealthScore: number;
  performanceHealthScore: number;
  promptHealthScore: number;
  stabilityScore: number;
  warnings: string[];
  anomalies: string[];
  throttledSystems: string[];
};

export type RuntimeHealthInput = {
  activeSessionCount?: number;
  conversationChunks?: ConversationChunk[];
  chunkDiagnostics?: ConversationChunkingDiagnostics | null;
  liveTranscript?: string;
  promptSections?: Array<string | null | undefined>;
  contextualRecall?: ContextualRecallPayload | null;
  continuation?: ConversationContinuationResult | null;
  knowledgeGraph?: KnowledgeGraphSnapshot | null;
  proactive?: (ProactiveAssistantSnapshot & { dismissSignal?: (signalId: string) => Promise<void> }) | null;
  memories?: ConversationMemory[];
  reminders?: ReminderTask[];
  backendSync?: Partial<BackendSyncState> | null;
  websocketMetrics?: {
    reconnectCount?: number;
    queueLength?: number;
    droppedMessages?: number;
  } | null;
  lifecycleState?: string | null;
  streamState?: string | null;
  wakeWordState?: string | null;
  storageRecoveryWarning?: string | null;
  notificationHealth?: string | null;
  renderKey?: string | number | null;
  sampleIntervalMs?: number;
};

export type BoundedPromptResult = {
  text: string;
  tokenEstimate: number;
  truncatedSystems: string[];
};

const DEFAULT_SAMPLE_INTERVAL_MS = 1800;
const HISTORY_LIMIT = 24;
const TOKEN_CHARS = 4;

export const RUNTIME_HEALTH_LIMITS = {
  promptChars: 2800,
  hardPromptChars: 3600,
  contextualRecallChars: 1400,
  continuationChars: 1200,
  graphContextChars: 1100,
  transcriptChars: 24000,
  chunkCount: 40,
  vaultEntries: 180,
  graphEntities: 180,
  graphRelationships: 320,
  proactiveSignals: 18,
  notificationsPerHour: 4,
  reconnectStorm: 5,
  syncQueue: 120,
  renderSamplesPerMinute: 90,
};

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function estimateRuntimeTokens(text: string): number {
  return Math.ceil(compact(text).length / TOKEN_CHARS);
}

export function boundedText(text: string, maxChars: number): string {
  const clean = compact(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

export function assembleBoundedPromptSections(
  sections: Array<{ id: string; text: string | null | undefined; priority?: number }>,
  maxChars = RUNTIME_HEALTH_LIMITS.promptChars
): BoundedPromptResult {
  const ordered = [...sections]
    .filter(section => compact(section.text || '').length > 0)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  const accepted: string[] = [];
  const truncatedSystems: string[] = [];

  for (const section of ordered) {
    const text = compact(section.text || '');
    const proposed = [...accepted, text].join('\n\n');
    if (proposed.length <= maxChars) {
      accepted.push(text);
      continue;
    }

    const remaining = maxChars - accepted.join('\n\n').length - (accepted.length > 0 ? 2 : 0);
    if (remaining > 120) {
      accepted.push(boundedText(text, remaining));
    }
    truncatedSystems.push(section.id);
  }

  const text = accepted.join('\n\n');
  return {
    text,
    tokenEstimate: estimateRuntimeTokens(text),
    truncatedSystems,
  };
}

export function pruneKnowledgeGraphForRuntime(
  graph: KnowledgeGraphSnapshot,
  limits = RUNTIME_HEALTH_LIMITS
): KnowledgeGraphSnapshot {
  return {
    ...graph,
    entities: graph.entities.slice(0, limits.graphEntities),
    relationships: graph.relationships.slice(0, limits.graphRelationships),
    projectTimelines: graph.projectTimelines.slice(0, 8),
    participants: graph.participants.slice(0, 10),
    recurringTopics: graph.recurringTopics.slice(0, 12),
    contextText: boundedText(graph.contextText, limits.graphContextChars),
    prompts: graph.prompts.slice(0, 3),
    diagnostics: {
      ...graph.diagnostics,
      entityCount: Math.min(graph.diagnostics.entityCount, limits.graphEntities),
      relationshipCount: Math.min(graph.diagnostics.relationshipCount, limits.graphRelationships),
      bounded:
        graph.diagnostics.bounded ||
        graph.entities.length > limits.graphEntities ||
        graph.relationships.length > limits.graphRelationships,
    },
  };
}

function scoreFromUsage(value: number, warnAt: number, hardAt: number): number {
  if (value <= warnAt) return 100;
  if (value >= hardAt) return 25;
  const ratio = (value - warnAt) / Math.max(1, hardAt - warnAt);
  return Math.max(25, Math.round(100 - ratio * 75));
}

function uniqueCount<T>(values: T[]): number {
  return new Set(values).size;
}

function activeReminderCount(reminders: ReminderTask[]): number {
  return reminders.filter(task =>
    task.state === 'pending' ||
    task.state === 'scheduled' ||
    task.state === 'triggered'
  ).length;
}

function estimateMemoryFootprint(memories: ConversationMemory[], chunks: ConversationChunk[], liveTranscript: string): number {
  const vaultChars = memories.reduce((sum, memory) => {
    const chunkChars = (memory.conversationChunks || []).reduce((chunkSum, chunk) => chunkSum + chunk.transcript.length + chunk.summary.length, 0);
    return sum +
      memory.mergedTranscript.length +
      memory.semanticSummary.length +
      chunkChars +
      JSON.stringify(memory.continuationSnapshot || {}).length;
  }, 0);
  const liveChars = chunks.reduce((sum, chunk) => sum + chunk.transcript.length + chunk.summary.length, 0) + liveTranscript.length;
  return vaultChars + liveChars;
}

function recursiveRelationshipPressure(graph: KnowledgeGraphSnapshot | null | undefined): boolean {
  if (!graph) return false;
  const outgoing = new Map<string, string[]>();
  for (const relationship of graph.relationships) {
    outgoing.set(relationship.sourceEntityId, [
      ...(outgoing.get(relationship.sourceEntityId) || []),
      relationship.targetEntityId,
    ]);
  }

  for (const entity of graph.entities.slice(0, 60)) {
    const seen = new Set<string>();
    let frontier = [entity.entityId];
    for (let depth = 0; depth < 8; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        if (seen.has(id)) return true;
        seen.add(id);
        next.push(...(outgoing.get(id) || []));
      }
      frontier = next.slice(0, 80);
      if (frontier.length === 0) break;
    }
  }
  return false;
}

function buildRuntimeHealthSnapshot(input: RuntimeHealthInput, renderSamples: number[], notificationSamples: number[]): RuntimeHealthSnapshot {
  const now = Date.now();
  const chunks = input.conversationChunks || [];
  const memories = input.memories || [];
  const reminders = input.reminders || [];
  const knowledgeGraph = input.knowledgeGraph || null;
  const proactive = input.proactive || null;
  const contextualRecallSize = input.contextualRecall?.diagnostics.contextSize || input.contextualRecall?.contextText.length || 0;
  const continuationDepth = input.continuation?.relevantThreads.length || 0;
  const continuationSize = input.continuation?.diagnostics.contextSize || input.continuation?.contextText.length || 0;
  const graphContextSize = knowledgeGraph?.contextText.length || 0;
  const promptText = (input.promptSections || []).filter(Boolean).join('\n\n');
  const promptTokenEstimate = estimateRuntimeTokens(promptText);
  const transcriptMemoryEstimate = estimateMemoryFootprint(memories, chunks, input.liveTranscript || '');
  const chunkCount = chunks.length || input.chunkDiagnostics?.retainedChunkCount || 0;
  const averageChunkSize = chunkCount > 0
    ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.transcript.length, 0) / chunkCount)
    : 0;
  const graphEntityCount = knowledgeGraph?.diagnostics.entityCount || knowledgeGraph?.entities.length || 0;
  const graphRelationshipCount = knowledgeGraph?.diagnostics.relationshipCount || knowledgeGraph?.relationships.length || 0;
  const websocketReconnectCount = (input.websocketMetrics?.reconnectCount || 0) + (input.backendSync?.reconnectAttempts || 0);
  const syncQueueSize = input.backendSync?.queueSnapshot?.total || input.backendSync?.queuedSyncCount || input.websocketMetrics?.queueLength || 0;
  const proactiveSignalCount = proactive?.diagnostics.signalCount || proactive?.signals.length || 0;
  const notificationRate = notificationSamples.filter(sample => now - sample <= 3600000).length;

  const warnings: string[] = [];
  const anomalies: string[] = [];
  const throttledSystems: string[] = [];

  if (promptTokenEstimate > estimateRuntimeTokens(String('').padEnd(RUNTIME_HEALTH_LIMITS.promptChars))) {
    warnings.push('Prompt assembly is above the runtime budget.');
    throttledSystems.push('prompt');
  }
  if (promptText.length > RUNTIME_HEALTH_LIMITS.hardPromptChars) {
    anomalies.push('Runaway prompt growth detected.');
  }
  if (contextualRecallSize > RUNTIME_HEALTH_LIMITS.contextualRecallChars) {
    warnings.push('Contextual recall payload is oversized.');
    throttledSystems.push('recall');
  }
  if (continuationSize > RUNTIME_HEALTH_LIMITS.continuationChars) {
    warnings.push('Continuation payload is near the configured ceiling.');
    throttledSystems.push('continuation');
  }
  if (graphContextSize > RUNTIME_HEALTH_LIMITS.graphContextChars) {
    warnings.push('Knowledge graph injection is oversized.');
    throttledSystems.push('knowledge_graph');
  }
  if (chunkCount > RUNTIME_HEALTH_LIMITS.chunkCount) {
    warnings.push('Chunk retention is at the runtime limit.');
    throttledSystems.push('chunks');
  }
  if (chunks.length > 0 && uniqueCount(chunks.map(chunk => chunk.chunkId)) !== chunks.length) {
    anomalies.push('Duplicate chunk ids detected.');
  }
  if (chunks.length > 1 && uniqueCount(chunks.map(chunk => compact(chunk.summary).toLowerCase())) < chunks.length) {
    warnings.push('Duplicate chunk summaries detected.');
  }
  if (transcriptMemoryEstimate > RUNTIME_HEALTH_LIMITS.transcriptChars) {
    warnings.push('Transcript memory estimate is high.');
    throttledSystems.push('memory');
  }
  if (memories.length > RUNTIME_HEALTH_LIMITS.vaultEntries) {
    warnings.push('Memory vault retention is high.');
    throttledSystems.push('memory_vault');
  }
  if (graphEntityCount >= RUNTIME_HEALTH_LIMITS.graphEntities || graphRelationshipCount >= RUNTIME_HEALTH_LIMITS.graphRelationships) {
    warnings.push('Knowledge graph is at pruning bounds.');
    throttledSystems.push('knowledge_graph');
  }
  if (knowledgeGraph && uniqueCount(knowledgeGraph.entities.map(entity => `${entity.entityType}:${entity.canonicalName.toLowerCase()}`)) !== knowledgeGraph.entities.length) {
    anomalies.push('Duplicate knowledge graph entities detected.');
  }
  if (recursiveRelationshipPressure(knowledgeGraph)) {
    anomalies.push('Recursive relationship chain detected in knowledge graph.');
  }
  if (proactiveSignalCount > RUNTIME_HEALTH_LIMITS.proactiveSignals) {
    warnings.push('Proactive assistant signal count is high.');
    throttledSystems.push('proactive_assistant');
  }
  if (notificationRate > RUNTIME_HEALTH_LIMITS.notificationsPerHour) {
    anomalies.push('Notification frequency exceeds cooldown expectations.');
    throttledSystems.push('notifications');
  }
  const isGracefulOffline = input.backendSync?.connectionState === 'local_mode' || input.backendSync?.connectionState === 'suspended';

  if (websocketReconnectCount >= RUNTIME_HEALTH_LIMITS.reconnectStorm && !isGracefulOffline) {
    anomalies.push('Reconnect storm detected.');
    throttledSystems.push('websocket');
  }
  if (syncQueueSize > RUNTIME_HEALTH_LIMITS.syncQueue) {
    warnings.push('Sync queue is approaching retention bounds.');
    throttledSystems.push('sync_queue');
  }
  if (input.backendSync?.queueSnapshot?.inFlight && input.backendSync.queueSnapshot.inFlight > input.backendSync.queueSnapshot.pending + 5 && !isGracefulOffline) {
    anomalies.push('Stale sync loop suspected.');
  }
  if (renderSamples.length > RUNTIME_HEALTH_LIMITS.renderSamplesPerMinute) {
    warnings.push('Render update rate is high for diagnostics.');
    throttledSystems.push('diagnostics_render');
  }
  if (input.lifecycleState && /failed|timeout|error/i.test(input.lifecycleState)) {
    warnings.push(`Lifecycle anomaly: ${input.lifecycleState}.`);
  }
  if (input.streamState && /failed|timeout|cancelled/i.test(input.streamState)) {
    warnings.push(`Stream lifecycle: ${input.streamState}.`);
  }
  if (input.wakeWordState && /failed|suspended/i.test(input.wakeWordState)) {
    warnings.push(`Wake-word lifecycle: ${input.wakeWordState}.`);
  }
  if (input.storageRecoveryWarning) {
    warnings.push(input.storageRecoveryWarning);
    throttledSystems.push('storage');
  }
  if (input.notificationHealth && /recovered|restored|warning|failed/i.test(input.notificationHealth)) {
    warnings.push(input.notificationHealth);
    throttledSystems.push('notifications');
  }

  const memoryHealthScore = Math.min(
    scoreFromUsage(transcriptMemoryEstimate, RUNTIME_HEALTH_LIMITS.transcriptChars, RUNTIME_HEALTH_LIMITS.transcriptChars * 1.8),
    scoreFromUsage(memories.length, RUNTIME_HEALTH_LIMITS.vaultEntries, RUNTIME_HEALTH_LIMITS.vaultEntries * 1.5),
    scoreFromUsage(chunkCount, RUNTIME_HEALTH_LIMITS.chunkCount, RUNTIME_HEALTH_LIMITS.chunkCount * 1.5)
  );
  const promptHealthScore = Math.min(
    scoreFromUsage(promptText.length, RUNTIME_HEALTH_LIMITS.promptChars, RUNTIME_HEALTH_LIMITS.hardPromptChars),
    scoreFromUsage(contextualRecallSize + continuationSize + graphContextSize, 2800, 4200)
  );
  const performanceHealthScore = Math.min(
    scoreFromUsage(renderSamples.length, RUNTIME_HEALTH_LIMITS.renderSamplesPerMinute, RUNTIME_HEALTH_LIMITS.renderSamplesPerMinute * 1.5),
    scoreFromUsage(syncQueueSize, RUNTIME_HEALTH_LIMITS.syncQueue, RUNTIME_HEALTH_LIMITS.syncQueue * 1.5),
    scoreFromUsage(proactiveSignalCount, RUNTIME_HEALTH_LIMITS.proactiveSignals, RUNTIME_HEALTH_LIMITS.proactiveSignals * 1.5)
  );
  const stabilityScore = Math.min(
    isGracefulOffline ? 100 : scoreFromUsage(websocketReconnectCount, RUNTIME_HEALTH_LIMITS.reconnectStorm, RUNTIME_HEALTH_LIMITS.reconnectStorm * 2),
    anomalies.length > 0 ? 70 - anomalies.length * 10 : 100
  );

  return {
    snapshotId: `runtime-${now.toString(36)}`,
    createdAt: now,
    activeSessionCount: input.activeSessionCount || 0,
    chunkCount,
    averageChunkSize,
    transcriptMemoryEstimate,
    promptTokenEstimate,
    contextualRecallSize,
    continuationDepth,
    graphEntityCount,
    graphRelationshipCount,
    proactiveSignalCount,
    activeReminderCount: activeReminderCount(reminders),
    websocketReconnectCount,
    syncQueueSize,
    memoryVaultSize: memories.length,
    notificationRate,
    memoryHealthScore,
    performanceHealthScore,
    promptHealthScore,
    stabilityScore: Math.max(0, stabilityScore),
    warnings: Array.from(new Set(warnings)).slice(0, 10),
    anomalies: Array.from(new Set(anomalies)).slice(0, 10),
    throttledSystems: Array.from(new Set(throttledSystems)).slice(0, 8),
  };
}

export function useRuntimeHealth(input: RuntimeHealthInput) {
  const renderSamplesRef = useRef<number[]>([]);
  const notificationSamplesRef = useRef<number[]>([]);
  const warningHistoryRef = useRef<string[]>([]);
  const lastSnapshotAtRef = useRef(0);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const candidate = useMemo(() => {
    const now = Date.now();
    renderSamplesRef.current = [...renderSamplesRef.current, now].filter(sample => now - sample <= 60000).slice(-160);

    const topSignal = input.proactive?.topSignals?.[0];
    if (topSignal && topSignal.priority >= 75 && topSignal.actionable && !topSignal.dismissed) {
      const previous = notificationSamplesRef.current[notificationSamplesRef.current.length - 1] || 0;
      if (now - previous > 1000) {
        notificationSamplesRef.current = [...notificationSamplesRef.current, now].filter(sample => now - sample <= 3600000).slice(-24);
      }
    }

    return buildRuntimeHealthSnapshot(input, renderSamplesRef.current, notificationSamplesRef.current);
  }, [
    input.activeSessionCount,
    input.backendSync,
    input.chunkDiagnostics,
    input.contextualRecall,
    input.continuation,
    input.conversationChunks,
    input.knowledgeGraph,
    input.lifecycleState,
    input.liveTranscript,
    input.memories,
    input.notificationHealth,
    input.proactive,
    input.promptSections,
    input.reminders,
    input.renderKey,
    input.storageRecoveryWarning,
    input.streamState,
    input.wakeWordState,
    input.websocketMetrics,
  ]);

  const [snapshot, setSnapshot] = useState(candidate);
  const sampleIntervalMs = input.sampleIntervalMs || DEFAULT_SAMPLE_INTERVAL_MS;

  useEffect(() => {
    const now = Date.now();
    const applySnapshot = () => {
      lastSnapshotAtRef.current = Date.now();
      setSnapshot(candidate);
      if (candidate.warnings.length > 0 || candidate.anomalies.length > 0) {
        warningHistoryRef.current = [
          ...warningHistoryRef.current,
          ...candidate.warnings,
          ...candidate.anomalies,
        ].slice(-HISTORY_LIMIT);
      }
    };

    if (now - lastSnapshotAtRef.current >= sampleIntervalMs) {
      applySnapshot();
      return;
    }

    if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    updateTimerRef.current = setTimeout(applySnapshot, sampleIntervalMs - (now - lastSnapshotAtRef.current));
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
    };
  }, [candidate, sampleIntervalMs]);

  return {
    snapshot,
    warningHistory: warningHistoryRef.current,
    guards: {
      assembleBoundedPromptSections,
      boundedText,
      pruneKnowledgeGraphForRuntime,
    },
  };
}
