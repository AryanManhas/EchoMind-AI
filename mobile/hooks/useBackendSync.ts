import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import ENV from '../lib/env';
import type { ConversationMemory } from './usePersistentMemory';
import type { ReminderTask } from './useReminderEngine';
import { useBackendHealth, type BackendHealthState } from './useBackendHealth';
import {
  dequeueSyncBatch,
  enqueueSyncEvent,
  getSyncQueueSnapshot,
  markSyncComplete,
  markSyncFailed,
  recoverStaleSyncEvents,
  type SyncEvent,
  type SyncEventType,
  type SyncQueueSnapshot,
} from './useSyncQueue';
import { TransportManager } from '../lib/transport';

export type BackendSyncConnectionState =
  | 'disconnected'
  | 'initializing'
  | 'connected'
  | 'local_mode'
  | 'sync_available'
  | 'reconnecting'
  | 'suspended';

export type BackendSyncState = {
  connectionState: BackendSyncConnectionState;
  backendHealth: BackendHealthState;
  queuedSyncCount: number;
  pendingUploads: number;
  reconnectAttempts: number;
  backendLatencyMs: number | null;
  lastSuccessfulSync: number | null;
  lastSyncTimestamp: number | null;
  isOfflineMode: boolean;
  queueSnapshot: SyncQueueSnapshot;
};

export type UseBackendSyncInput = {
  memories?: ConversationMemory[];
  reminders?: ReminderTask[];
  authToken?: string | null;
};

export type UseBackendSyncReturn = BackendSyncState & {
  enqueueSync: (id: string, type: SyncEventType, payload: Record<string, unknown>) => Promise<boolean>;
  enqueueFinalizedMemory: (memory: ConversationMemory) => Promise<boolean>;
  enqueueFinalizedReminder: (reminder: ReminderTask) => Promise<boolean>;
  forceReconnect: () => void;
  replayQueue: () => Promise<void>;
};

const HEALTH_POLL_MS = 20_000;
const DEGRADED_HEALTH_POLL_MS = 45_000;
const REPLAY_INTERVAL_MS = 12_000;
const DEGRADED_REPLAY_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const REPLAY_BATCH_SIZE = 5;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const OFFLINE_THRESHOLD_MS = 90_000;
const MAX_RECONNECT_ATTEMPTS = 8;
const FORCE_RECONNECT_COOLDOWN_MS = 5000;

let syncOwnerActive = false;

function calculateBackoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
}

function memoryPayload(memory: ConversationMemory): Record<string, unknown> {
  return {
    id: memory.id,
    sessionId: memory.sessionId,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    finalizedAt: memory.finalizedAt,
    sessionTitle: memory.sessionTitle,
    semanticSummary: memory.semanticSummary,
    highlights: memory.highlights,
    continuationSnapshot: {
      snapshotId: memory.continuationSnapshot.snapshotId,
      threadId: memory.continuationSnapshot.threadId,
      sessionId: memory.continuationSnapshot.sessionId,
      createdAt: memory.continuationSnapshot.createdAt,
      updatedAt: memory.continuationSnapshot.updatedAt,
      activeTopics: memory.continuationSnapshot.activeTopics,
      unresolvedTasks: memory.continuationSnapshot.unresolvedTasks,
      pendingReminders: memory.continuationSnapshot.pendingReminders,
      recentDecisions: memory.continuationSnapshot.recentDecisions,
      participants: memory.continuationSnapshot.participants,
      followUps: memory.continuationSnapshot.followUps,
      importantContext: memory.continuationSnapshot.importantContext,
      continuationSummary: memory.continuationSnapshot.continuationSummary,
      emotionalToneHint: memory.continuationSnapshot.emotionalToneHint,
      lastInteractionAt: memory.continuationSnapshot.lastInteractionAt,
      continuationScore: memory.continuationSnapshot.continuationScore,
      urgencyScore: memory.continuationSnapshot.urgencyScore,
      relevanceScore: memory.continuationSnapshot.relevanceScore,
    },
    conversationIntelligence: memory.conversationIntelligence.map(item => ({
      intelligenceId: item.intelligenceId,
      sessionId: item.sessionId,
      chunkId: item.chunkId,
      createdAt: item.createdAt,
      tasks: item.tasks,
      reminders: item.reminders,
      deadlines: item.deadlines,
      meetings: item.meetings,
      participants: item.participants,
      decisions: item.decisions,
      followUps: item.followUps,
      importantPoints: item.importantPoints,
      discussedTopics: item.discussedTopics,
      actionItems: item.actionItems,
      assignments: item.assignments,
      importanceScore: item.importanceScore,
      urgencyScore: item.urgencyScore,
      confidenceScore: item.confidenceScore,
    })),
    conversationChunks: memory.conversationChunks.map(chunk => ({
      chunkId: chunk.chunkId,
      sessionId: chunk.sessionId,
      createdAt: chunk.createdAt,
      finalizedAt: chunk.finalizedAt,
      summary: chunk.summary,
      highlights: chunk.highlights,
      tasks: chunk.tasks,
      reminders: chunk.reminders,
      participants: chunk.participants,
      topicHints: chunk.topicHints,
      tokenEstimate: chunk.tokenEstimate,
      importanceScore: chunk.importanceScore,
    })),
    reminders: memory.reminders,
    extractedTasks: memory.extractedTasks,
    participants: memory.participants,
    tags: memory.tags,
    duration: memory.duration,
    importanceScore: memory.importanceScore,
    sessionType: memory.sessionType,
    sourceReminderIds: memory.sourceReminderIds,
    isArchived: !!memory.isArchived,
    isDeleted: !!memory.isDeleted,
  };
}

function reminderPayload(reminder: ReminderTask): Record<string, unknown> {
  return {
    id: reminder.id,
    sourceSessionId: reminder.sourceSessionId,
    semanticObjectId: reminder.semanticObjectId,
    type: reminder.type,
    title: reminder.title,
    description: reminder.description,
    scheduledFor: reminder.scheduledFor,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
    state: reminder.state,
    confidence: reminder.confidence,
    metadata: reminder.metadata,
  };
}

async function postSyncBatch(events: SyncEvent[], signal: AbortSignal): Promise<{ id: string; success: boolean; error?: string }[]> {
  const apiUrl = TransportManager.getApiUrl() || ENV.API_URL;
  const response = await fetch(`${apiUrl}/api/sync/batch`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      events: events.map(event => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : events.map(event => ({ id: event.id, success: true }));
}

export function useBackendSync(input: UseBackendSyncInput = {}): UseBackendSyncReturn {
  const { memories = [], reminders = [], authToken = 'temp-auth-token' } = input;
  const health = useBackendHealth();
  const backendHealth = health.backendHealth;
  const backendLatencyMs = health.backendLatencyMs;
  const checkBackendHealth = health.checkBackendHealth;
  const [connectionState, setConnectionState] = useState<BackendSyncConnectionState>('disconnected');
  const [queueSnapshot, setQueueSnapshot] = useState<SyncQueueSnapshot>({
    total: 0,
    pending: 0,
    inFlight: 0,
    deadLetter: 0,
  });
  const [pendingUploads, setPendingUploads] = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<number | null>(null);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const appActiveRef = useRef(true);
  const ownerRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayActiveRef = useRef(false);
  const connectActiveRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const lastForceReconnectAtRef = useRef(0);
  const lastHealthSuccessRef = useRef<number | null>(null);
  const reconnectSessionIdRef = useRef<number>(0);
  const syncedMemoryVersionsRef = useRef<Map<string, number>>(new Map());
  const syncedReminderIdsRef = useRef<Set<string>>(new Set());

  const isOfflineMode = connectionState === 'local_mode' || connectionState === 'suspended';

  const refreshQueueSnapshot = useCallback(async () => {
    const next = await getSyncQueueSnapshot();
    if (mountedRef.current) setQueueSnapshot(next);
  }, []);

  const enqueueSync = useCallback(async (
    id: string,
    type: SyncEventType,
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    const didEnqueue = await enqueueSyncEvent(id, type, payload);
    await refreshQueueSnapshot();
    return didEnqueue;
  }, [refreshQueueSnapshot]);

  const enqueueFinalizedMemory = useCallback(async (memory: ConversationMemory) => {
    const syncVersion = memory.updatedAt || memory.finalizedAt || 0;
    const previousVersion = syncedMemoryVersionsRef.current.get(memory.id) || 0;
    if (!memory.finalizedAt || previousVersion >= syncVersion) return false;
    syncedMemoryVersionsRef.current.set(memory.id, syncVersion);
    const didEnqueue = await enqueueSync(`memory:${memory.id}`, 'memory', memoryPayload(memory));
    await enqueueSync(`vault_session:${memory.sessionId}`, 'vault_session', memoryPayload(memory));
    if (memory.semanticSummary) {
      await enqueueSync(`semantic:${memory.id}`, 'semantic', {
        id: memory.id,
        sessionId: memory.sessionId,
        semanticSummary: memory.semanticSummary,
        highlights: memory.highlights,
        sessionType: memory.sessionType,
        importanceScore: memory.importanceScore,
      });
    }
    return didEnqueue;
  }, [enqueueSync]);

  const enqueueFinalizedReminder = useCallback(async (reminder: ReminderTask) => {
    if (!reminder.id || syncedReminderIdsRef.current.has(reminder.id)) return false;
    syncedReminderIdsRef.current.add(reminder.id);
    return enqueueSync(`reminder:${reminder.id}`, 'reminder', reminderPayload(reminder));
  }, [enqueueSync]);

  const clearSocketTimers = useCallback(() => {
    if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
    if (heartbeatTimeoutRef.current) clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimerRef.current = null;
    heartbeatTimeoutRef.current = null;
  }, []);

  const clearLifecycleTimers = useCallback(() => {
    if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    healthTimerRef.current = null;
    replayTimerRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

  const closeSocket = useCallback(() => {
    clearSocketTimers();
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      try {
        socketRef.current.close();
      } catch {
        // no-op
      }
      socketRef.current = null;
    }
  }, [clearSocketTimers]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !appActiveRef.current) return;
    if (reconnectTimerRef.current) return;
    const attempts = reconnectAttemptsRef.current + 1;
    const sessionId = ++reconnectSessionIdRef.current;
    if (attempts > MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
      setReconnectAttempts(MAX_RECONNECT_ATTEMPTS);
      setConnectionState('local_mode');
      return;
    }
    reconnectAttemptsRef.current = attempts;
    const delay = calculateBackoff(attempts);
    setReconnectAttempts(attempts);
    setConnectionState(attempts > 3 ? 'sync_available' : 'reconnecting');
    reconnectTimerRef.current = setTimeout(() => {
      if (reconnectSessionIdRef.current !== sessionId) return;
      reconnectTimerRef.current = null;
      connectActiveRef.current = false;
      void checkBackendHealth();
    }, delay);
  }, [checkBackendHealth]);

  const startHeartbeat = useCallback(() => {
    clearSocketTimers();
    const sendHeartbeat = () => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ type: 'PING' }));
      } catch {
        scheduleReconnect();
        return;
      }
      heartbeatTimeoutRef.current = setTimeout(() => {
        closeSocket();
        scheduleReconnect();
      }, HEARTBEAT_TIMEOUT_MS);
      heartbeatTimerRef.current = setTimeout(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    };
    heartbeatTimerRef.current = setTimeout(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }, [clearSocketTimers, closeSocket, scheduleReconnect]);

  const connectSocket = useCallback(() => {
    if (!appActiveRef.current || connectActiveRef.current) return;
    if (!authToken) {
      setConnectionState('sync_available');
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) return;

    connectActiveRef.current = true;
    setConnectionState(prev => prev === 'connected' ? prev : 'reconnecting');
    closeSocket();

    try {
      const wsUrl = TransportManager.getWsUrl() || ENV.WS_URL;
      const delimiter = wsUrl.includes('?') ? '&' : '?';
      const socket = new WebSocket(`${wsUrl}${delimiter}token=${encodeURIComponent(authToken)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (!mountedRef.current) return;
        connectActiveRef.current = false;
        setConnectionState(backendHealth === 'degraded' ? 'sync_available' : 'connected');
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
        startHeartbeat();
      };

      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'PONG' && heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = null;
          }
        } catch {
          // Ignore non-sync socket messages. Runtime sockets own live traffic.
        }
      };

      socket.onerror = () => {
        connectActiveRef.current = false;
      };

      socket.onclose = () => {
        connectActiveRef.current = false;
        clearSocketTimers();
        if (appActiveRef.current && mountedRef.current) {
          scheduleReconnect();
        }
      };
    } catch {
      connectActiveRef.current = false;
      scheduleReconnect();
    }
  }, [authToken, backendHealth, clearSocketTimers, closeSocket, scheduleReconnect, startHeartbeat]);

  const replayQueue = useCallback(async () => {
    if (replayActiveRef.current) return;
    if (!appActiveRef.current) return;
    if (backendHealth === 'unreachable') return;

    replayActiveRef.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let batch: SyncEvent[] = [];

    try {
      batch = await dequeueSyncBatch(REPLAY_BATCH_SIZE);
      if (batch.length === 0) return;
      setPendingUploads(batch.length);
      const results = await postSyncBatch(batch, controller.signal);
      const completed: string[] = [];
      for (const event of batch) {
        const result = results.find(item => item.id === event.id);
        if (result?.success !== false) {
          completed.push(event.id);
        } else {
          await markSyncFailed(event.id, result?.error || 'Server rejected sync event');
        }
      }
      await markSyncComplete(completed);
      if (completed.length > 0) {
        const now = Date.now();
        setLastSuccessfulSync(now);
        setLastSyncTimestamp(now);
      }
    } catch (error) {
      for (const event of batch) {
        await markSyncFailed(event.id, error instanceof Error ? error.message : 'Replay failed');
      }
    } finally {
      clearTimeout(timeout);
      replayActiveRef.current = false;
      setPendingUploads(0);
      await recoverStaleSyncEvents();
      await refreshQueueSnapshot();
    }
  }, [backendHealth, refreshQueueSnapshot]);

  const forceReconnect = useCallback(() => {
    const now = Date.now();
    if (now - lastForceReconnectAtRef.current < FORCE_RECONNECT_COOLDOWN_MS) return;
    lastForceReconnectAtRef.current = now;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectSessionIdRef.current++;
    consecutiveFailuresRef.current = 0;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setConnectionState('initializing');
    void checkBackendHealth().then(snapshot => {
      if (snapshot.backendHealth !== 'unreachable') {
        connectSocket();
        void replayQueue();
      }
    });
  }, [checkBackendHealth, connectSocket, replayQueue]);

  useEffect(() => {
    memories.forEach(memory => {
      void enqueueFinalizedMemory(memory);
    });
  }, [enqueueFinalizedMemory, memories]);

  useEffect(() => {
    reminders.forEach(reminder => {
      void enqueueFinalizedReminder(reminder);
    });
  }, [enqueueFinalizedReminder, reminders]);

  useEffect(() => {
    mountedRef.current = true;
    if (syncOwnerActive) {
      return () => {
        mountedRef.current = false;
      };
    }
    syncOwnerActive = true;
    ownerRef.current = true;

    void recoverStaleSyncEvents().then(refreshQueueSnapshot);
    setConnectionState('initializing');
    void checkBackendHealth();

    const handleAppState = (nextAppState: AppStateStatus) => {
      if (nextAppState.match(/inactive|background/)) {
        appActiveRef.current = false;
        closeSocket();
        reconnectSessionIdRef.current++;
        setConnectionState('suspended');
        clearLifecycleTimers();
      } else if (nextAppState === 'active') {
        appActiveRef.current = true;
        forceReconnect();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      mountedRef.current = false;
      if (ownerRef.current) {
        syncOwnerActive = false;
        ownerRef.current = false;
      }
      subscription.remove();
      closeSocket();
      clearLifecycleTimers();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ownerRef.current || !appActiveRef.current) return;
    if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
    const interval = backendHealth === 'degraded' ? DEGRADED_HEALTH_POLL_MS : HEALTH_POLL_MS;
    const runHealthTick = async () => {
      try {
        const snapshot = await checkBackendHealth();
        if (!mountedRef.current || !ownerRef.current || !appActiveRef.current) return;
        if (snapshot.backendHealth === 'unreachable') {
          consecutiveFailuresRef.current += 1;
          const lastSuccess = lastHealthSuccessRef.current;
          const staleFor = lastSuccess ? Date.now() - lastSuccess : Infinity;
          setConnectionState(staleFor > OFFLINE_THRESHOLD_MS ? 'local_mode' : 'reconnecting');
          scheduleReconnect();
        } else {
          consecutiveFailuresRef.current = 0;
          lastHealthSuccessRef.current = Date.now();
          setConnectionState((prev) => {
            if (prev === 'local_mode') return 'sync_available';
            return snapshot.backendHealth === 'degraded' ? 'sync_available' : 'connected';
          });
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            connectSocket();
          }
          void replayQueue();
        }
      } finally {
        if (mountedRef.current && ownerRef.current && appActiveRef.current) {
          const nextInterval = connectionState === 'local_mode' || connectionState === 'suspended'
            ? Math.max(DEGRADED_HEALTH_POLL_MS, interval)
            : interval;
          healthTimerRef.current = setTimeout(runHealthTick, nextInterval);
        }
      }
    };
    healthTimerRef.current = setTimeout(runHealthTick, interval);
  }, [backendHealth, checkBackendHealth, connectSocket, connectionState, replayQueue, scheduleReconnect]);

  useEffect(() => {
    if (!ownerRef.current || !appActiveRef.current) return;
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    const interval = backendHealth === 'degraded' ? DEGRADED_REPLAY_INTERVAL_MS : REPLAY_INTERVAL_MS;
    const runReplayTick = async () => {
      try {
        await replayQueue();
      } finally {
        if (mountedRef.current && ownerRef.current && appActiveRef.current) {
          replayTimerRef.current = setTimeout(runReplayTick, interval);
        }
      }
    };
    replayTimerRef.current = setTimeout(runReplayTick, interval);
  }, [backendHealth, queueSnapshot.pending, replayQueue]);

  const state = useMemo<BackendSyncState>(() => ({
    connectionState,
    backendHealth,
    queuedSyncCount: queueSnapshot.pending + queueSnapshot.inFlight,
    pendingUploads,
    reconnectAttempts,
    backendLatencyMs,
    lastSuccessfulSync,
    lastSyncTimestamp,
    isOfflineMode,
    queueSnapshot,
  }), [
    connectionState,
    backendHealth,
    backendLatencyMs,
    isOfflineMode,
    lastSuccessfulSync,
    lastSyncTimestamp,
    pendingUploads,
    queueSnapshot,
    reconnectAttempts,
  ]);

  return {
    ...state,
    enqueueSync,
    enqueueFinalizedMemory,
    enqueueFinalizedReminder,
    forceReconnect,
    replayQueue,
  };
}
