import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SYNC_QUEUE_KEY = '@EchoMind:SyncQueue';
const MAX_QUEUE_SIZE = 200;
const MAX_RETRIES = 5;
const STALE_IN_FLIGHT_MS = 60_000;

export type SyncEventType = 'memory' | 'reminder' | 'semantic' | 'vault_session';
export type SyncEventStatus = 'pending' | 'in_flight' | 'dead_letter';

export type SyncEvent = {
  id: string;
  type: SyncEventType;
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
  status: SyncEventStatus;
  lastAttemptAt: number | null;
  error: string | null;
};

export type SyncQueueSnapshot = {
  total: number;
  pending: number;
  inFlight: number;
  deadLetter: number;
};

function sortQueue(queue: SyncEvent[]): SyncEvent[] {
  return [...queue].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

async function readQueue(): Promise<SyncEvent[]> {
  const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortQueue(parsed) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: SyncEvent[]): Promise<void> {
  const bounded = sortQueue(queue).slice(-MAX_QUEUE_SIZE);
  await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(bounded));
}

function snapshot(queue: SyncEvent[]): SyncQueueSnapshot {
  return {
    total: queue.length,
    pending: queue.filter(event => event.status === 'pending').length,
    inFlight: queue.filter(event => event.status === 'in_flight').length,
    deadLetter: queue.filter(event => event.status === 'dead_letter').length,
  };
}

export async function enqueueSyncEvent(
  id: string,
  type: SyncEventType,
  payload: Record<string, unknown>
): Promise<boolean> {
  const queue = await readQueue();
  if (queue.some(event => event.id === id)) return false;

  const event: SyncEvent = {
    id,
    type,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
    status: 'pending',
    lastAttemptAt: null,
    error: null,
  };

  await writeQueue([...queue, event]);
  return true;
}

export async function recoverStaleSyncEvents(): Promise<number> {
  const now = Date.now();
  const queue = await readQueue();
  let recovered = 0;
  const updated = queue.map(event => {
    if (
      event.status === 'in_flight' &&
      event.lastAttemptAt &&
      now - event.lastAttemptAt > STALE_IN_FLIGHT_MS
    ) {
      recovered += 1;
      return { ...event, status: 'pending' as SyncEventStatus };
    }
    return event;
  });
  if (recovered > 0) await writeQueue(updated);
  return recovered;
}

export async function dequeueSyncBatch(limit: number): Promise<SyncEvent[]> {
  const queue = await readQueue();
  const pending = sortQueue(queue)
    .filter(event => event.status === 'pending' && event.retryCount < MAX_RETRIES)
    .slice(0, limit);
  if (pending.length === 0) return [];

  const pendingIds = new Set(pending.map(event => event.id));
  const now = Date.now();
  const updated = queue.map(event =>
    pendingIds.has(event.id)
      ? { ...event, status: 'in_flight' as SyncEventStatus, lastAttemptAt: now }
      : event
  );
  await writeQueue(updated);
  return pending.map(event => ({ ...event, status: 'in_flight', lastAttemptAt: now }));
}

export async function markSyncComplete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const queue = await readQueue();
  await writeQueue(queue.filter(event => !idSet.has(event.id)));
}

export async function markSyncFailed(id: string, error: string): Promise<void> {
  const queue = await readQueue();
  const updated = queue.map(event => {
    if (event.id !== id) return event;
    const retryCount = event.retryCount + 1;
    return {
      ...event,
      retryCount,
      error,
      lastAttemptAt: Date.now(),
      status: retryCount >= MAX_RETRIES ? 'dead_letter' as SyncEventStatus : 'pending' as SyncEventStatus,
    };
  });
  await writeQueue(updated);
}

export async function getSyncQueueSnapshot(): Promise<SyncQueueSnapshot> {
  return snapshot(await readQueue());
}

export function useSyncQueue() {
  const [queueSnapshot, setQueueSnapshot] = useState<SyncQueueSnapshot>({
    total: 0,
    pending: 0,
    inFlight: 0,
    deadLetter: 0,
  });

  const refreshQueueSnapshot = useCallback(async () => {
    setQueueSnapshot(await getSyncQueueSnapshot());
  }, []);

  const enqueue = useCallback(async (
    id: string,
    type: SyncEventType,
    payload: Record<string, unknown>
  ) => {
    const didEnqueue = await enqueueSyncEvent(id, type, payload);
    await refreshQueueSnapshot();
    return didEnqueue;
  }, [refreshQueueSnapshot]);

  useEffect(() => {
    void refreshQueueSnapshot();
  }, [refreshQueueSnapshot]);

  return {
    queueSnapshot,
    enqueue,
    refreshQueueSnapshot,
  };
}
