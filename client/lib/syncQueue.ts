/**
 * EchoMind Sync Queue — Durable IndexedDB-backed sync event queue.
 *
 * Uses a SEPARATE database ('EchoMindSync') from the memory vault
 * to avoid version conflicts with persistence.ts.
 *
 * Design rules:
 * - Idempotent: duplicate event IDs are silently rejected
 * - Retry-safe: max 5 retries, then dead-lettered
 * - Ordered: events drain in FIFO (createdAt) order
 * - Offline-safe: fully local, no network dependency
 */

const SYNC_DB_NAME = 'EchoMindSync';
const SYNC_STORE = 'sync_queue';
const SYNC_DB_VERSION = 1;
const MAX_RETRIES = 5;

// ─── Types ────────────────────────────────────────────────────

export type SyncEventType = 'memory' | 'reminder' | 'semantic';
export type SyncEventStatus = 'pending' | 'in_flight' | 'completed' | 'dead_letter';

export interface SyncEvent {
  id: string;                 // Idempotent event ID (e.g., `sync_memory_${memoryId}`)
  type: SyncEventType;
  payload: Record<string, unknown>;
  createdAt: number;          // Unix timestamp ms
  retryCount: number;
  status: SyncEventStatus;
  lastAttemptAt: number | null;
  error: string | null;
}

// ─── Database ─────────────────────────────────────────────────

let dbInstance: IDBDatabase | null = null;

function openSyncDB(): Promise<IDBDatabase> {
  if (dbInstance && dbInstance.name === SYNC_DB_NAME) {
    return Promise.resolve(dbInstance);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle unexpected close (e.g., browser storage pressure)
      dbInstance.onclose = () => { dbInstance = null; };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        const store = db.createObjectStore(SYNC_STORE, { keyPath: 'id' });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_created', 'createdAt', { unique: false });
      }
    };
  });
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Enqueue a sync event. Silently skips if an event with the same ID exists.
 * Returns true if enqueued, false if duplicate.
 */
export async function enqueue(
  id: string,
  type: SyncEventType,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const db = await openSyncDB();

  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);

    // Check for duplicate first
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        // Duplicate — skip silently
        resolve(false);
        return;
      }

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

      const putReq = store.put(event);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Get the next pending event (oldest first) and mark it as in_flight.
 * Returns null if queue is empty.
 */
export async function dequeueNext(): Promise<SyncEvent | null> {
  const db = await openSyncDB();

  return new Promise<SyncEvent | null>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    const index = store.index('by_status');

    const cursor = index.openCursor(IDBKeyRange.only('pending'));

    cursor.onsuccess = () => {
      const result = cursor.result;
      if (!result) {
        resolve(null);
        return;
      }

      const event = result.value as SyncEvent;
      event.status = 'in_flight';
      event.lastAttemptAt = Date.now();

      const updateReq = result.update(event);
      updateReq.onsuccess = () => resolve(event);
      updateReq.onerror = () => reject(updateReq.error);
    };

    cursor.onerror = () => reject(cursor.error);
  });
}

/**
 * Mark an event as successfully synced (removes from queue).
 */
export async function markComplete(id: string): Promise<void> {
  const db = await openSyncDB();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Mark an event as failed. Increments retry count.
 * If retries exceed MAX_RETRIES, moves to dead_letter status.
 */
export async function markFailed(id: string, error: string): Promise<void> {
  const db = await openSyncDB();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const event = getReq.result as SyncEvent | undefined;
      if (!event) {
        resolve();
        return;
      }

      event.retryCount += 1;
      event.error = error;
      event.lastAttemptAt = Date.now();

      if (event.retryCount >= MAX_RETRIES) {
        event.status = 'dead_letter';
      } else {
        event.status = 'pending'; // Back to pending for retry
      }

      const putReq = store.put(event);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Get count of pending events (not including in_flight or dead_letter).
 */
export async function getPendingCount(): Promise<number> {
  const db = await openSyncDB();

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const index = store.index('by_status');
    const countReq = index.count(IDBKeyRange.only('pending'));

    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Get count of in_flight events (currently being synced).
 */
export async function getInFlightCount(): Promise<number> {
  const db = await openSyncDB();

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const index = store.index('by_status');
    const countReq = index.count(IDBKeyRange.only('in_flight'));

    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Get total count of all events in the queue (all statuses).
 */
export async function getTotalCount(): Promise<number> {
  const db = await openSyncDB();

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const countReq = store.count();

    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Reset any stale in_flight events back to pending.
 * Call on startup to recover from crashes mid-sync.
 */
export async function recoverStaleInFlight(): Promise<number> {
  const db = await openSyncDB();

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    const index = store.index('by_status');
    const cursor = index.openCursor(IDBKeyRange.only('in_flight'));
    let recovered = 0;

    cursor.onsuccess = () => {
      const result = cursor.result;
      if (!result) {
        resolve(recovered);
        return;
      }

      const event = result.value as SyncEvent;
      event.status = 'pending';
      result.update(event);
      recovered++;
      result.continue();
    };

    cursor.onerror = () => reject(cursor.error);
  });
}
