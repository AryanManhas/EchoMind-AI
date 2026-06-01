'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  enqueue,
  dequeueNext,
  markComplete,
  markFailed,
  getPendingCount,
  getInFlightCount,
  recoverStaleInFlight,
  type SyncEventType,
  type SyncEvent,
} from '../lib/syncQueue';

// ─── Connection State Machine ─────────────────────────────────
//
//   disconnected ──► connecting ──► connected
//        ▲                              │
//        │                              ▼
//     offline ◄── degraded ◄── reconnecting
//
// Transitions:
//   disconnected → connecting  : initial connect or manual retry
//   connecting   → connected   : health check succeeds
//   connecting   → reconnecting: health check fails (transient)
//   connected    → reconnecting: health check fails after connected
//   reconnecting → connected   : health check recovers
//   reconnecting → degraded    : N consecutive failures
//   degraded     → connecting  : manual retry or backoff timer
//   degraded     → offline     : extended unreachable (>60s)
//   offline      → connecting  : network comes back (online event)
//   *            → disconnected: explicit disconnect

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded'
  | 'offline';

export interface BackendSyncState {
  connectionState: ConnectionState;
  backendHealth: 'healthy' | 'degraded' | 'unreachable';
  queuedSyncCount: number;
  pendingUploads: number;
  lastSuccessfulSync: number | null;
  reconnectAttempts: number;
  isOfflineMode: boolean;
  backendLatencyMs: number | null;
}

export interface UseBackendSyncReturn extends BackendSyncState {
  enqueueSync: (id: string, type: SyncEventType, payload: Record<string, unknown>) => Promise<boolean>;
  forceReconnect: () => void;
}

// ─── Constants ────────────────────────────────────────────────

const HEALTH_POLL_INTERVAL = 15_000;      // 15s between health checks
const DRAIN_INTERVAL = 10_000;            // 10s between drain attempts
const BACKOFF_BASE_MS = 1_000;            // Initial backoff
const BACKOFF_MAX_MS = 30_000;            // Cap at 30s
const DEGRADED_THRESHOLD = 3;             // Consecutive failures → degraded
const OFFLINE_THRESHOLD_MS = 60_000;      // 60s unreachable → offline
const BATCH_SIZE = 5;                     // Max events per drain cycle

function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';
  }
  return 'http://localhost:8080';
}

// ─── Backoff with jitter ──────────────────────────────────────

function calculateBackoff(attempt: number): number {
  const exponential = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  const jitter = exponential * 0.2 * Math.random(); // ±20% jitter
  return Math.floor(exponential + jitter);
}

// ─── Hook ─────────────────────────────────────────────────────

export function useBackendSync(): UseBackendSyncReturn {
  // ── State ──
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [backendHealth, setBackendHealth] = useState<'healthy' | 'degraded' | 'unreachable'>('unreachable');
  const [queuedSyncCount, setQueuedSyncCount] = useState(0);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<number | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [backendLatencyMs, setBackendLatencyMs] = useState<number | null>(null);

  // ── Refs for mutable state inside intervals ──
  const consecutiveFailuresRef = useRef(0);
  const lastHealthSuccessRef = useRef<number | null>(null);
  const ownerRef = useRef(false);       // Single-owner guard
  const drainActiveRef = useRef(false);  // Prevent concurrent drains
  const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const isOfflineMode = connectionState === 'offline' || connectionState === 'disconnected';

  // ── Safe state setters (only if mounted) ──
  const safeSetState = useCallback((setter: React.Dispatch<React.SetStateAction<any>>, value: React.SetStateAction<any>) => {
    if (mountedRef.current) setter(value);
  }, []);

  // ── Health Check ──
  const checkHealth = useCallback(async (): Promise<boolean> => {
    const url = `${getBackendUrl()}/api/health`;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeout);
      const latency = Date.now() - start;

      if (!res.ok) {
        throw new Error(`Health check returned ${res.status}`);
      }

      const data = await res.json();

      safeSetState(setBackendLatencyMs, latency);
      consecutiveFailuresRef.current = 0;
      lastHealthSuccessRef.current = Date.now();

      // Determine backend health from response
      const serverStatus = data?.data?.status || data?.status || 'healthy';
      if (serverStatus === 'degraded') {
        safeSetState(setBackendHealth, 'degraded');
      } else {
        safeSetState(setBackendHealth, 'healthy');
      }

      // Transition to connected
      safeSetState(setConnectionState, 'connected');
      safeSetState(setReconnectAttempts, 0);

      return true;
    } catch {
      consecutiveFailuresRef.current += 1;
      safeSetState(setBackendLatencyMs, null);

      const timeSinceLastSuccess = lastHealthSuccessRef.current
        ? Date.now() - lastHealthSuccessRef.current
        : Infinity;

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        safeSetState(setConnectionState, 'offline');
        safeSetState(setBackendHealth, 'unreachable');
      } else if (timeSinceLastSuccess > OFFLINE_THRESHOLD_MS && consecutiveFailuresRef.current > DEGRADED_THRESHOLD) {
        safeSetState(setConnectionState, 'offline');
        safeSetState(setBackendHealth, 'unreachable');
      } else if (consecutiveFailuresRef.current >= DEGRADED_THRESHOLD) {
        safeSetState(setConnectionState, 'degraded');
        safeSetState(setBackendHealth, 'unreachable');
      } else {
        safeSetState(setConnectionState, 'reconnecting');
        safeSetState(setBackendHealth, 'unreachable');
      }

      safeSetState(setReconnectAttempts, (prev: number) => prev + 1);
      return false;
    }
  }, [safeSetState]);

  // ── Queue Drain ──
  const drainQueue = useCallback(async () => {
    if (drainActiveRef.current) return;
    if (connectionState !== 'connected') return;

    drainActiveRef.current = true;
    const url = `${getBackendUrl()}/api/sync/batch`;

    try {
      // Drain up to BATCH_SIZE events
      const events: SyncEvent[] = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const event = await dequeueNext();
        if (!event) break;
        events.push(event);
      }

      if (events.length === 0) return;

      safeSetState(setPendingUploads, events.length);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: events.map(e => ({
            id: e.id,
            type: e.type,
            payload: e.payload,
            createdAt: e.createdAt,
          })),
        }),
      });

      clearTimeout(timeout);

      if (res.ok) {
        const result = await res.json();
        const results = result?.results || [];

        for (const event of events) {
          const eventResult = results.find((r: { id: string; success: boolean }) => r.id === event.id);
          if (eventResult?.success !== false) {
            await markComplete(event.id);
          } else {
            await markFailed(event.id, eventResult?.error || 'Server rejected');
          }
        }

        safeSetState(setLastSuccessfulSync, Date.now());
      } else {
        // Batch failed — mark all as failed for retry
        for (const event of events) {
          await markFailed(event.id, `HTTP ${res.status}`);
        }
      }
    } catch (err: unknown) {
      // Network error — events are already in_flight, will be recovered on next startup
      console.warn('[BackendSync] Drain failed:', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      drainActiveRef.current = false;
      safeSetState(setPendingUploads, 0);

      // Update counts
      const pending = await getPendingCount().catch(() => 0);
      const inflight = await getInFlightCount().catch(() => 0);
      safeSetState(setQueuedSyncCount, pending + inflight);
    }
  }, [connectionState, safeSetState]);

  // ── Enqueue Public API ──
  const enqueueSync = useCallback(async (
    id: string,
    type: SyncEventType,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    const result = await enqueue(id, type, payload);

    // Update count
    const pending = await getPendingCount().catch(() => 0);
    const inflight = await getInFlightCount().catch(() => 0);
    safeSetState(setQueuedSyncCount, pending + inflight);

    return result;
  }, [safeSetState]);

  // ── Force Reconnect ──
  const forceReconnect = useCallback(() => {
    consecutiveFailuresRef.current = 0;
    safeSetState(setConnectionState, 'connecting');
    safeSetState(setReconnectAttempts, 0);
    checkHealth();
  }, [checkHealth, safeSetState]);

  // ── Lifecycle: Health polling + drain loop + online/offline ──
  useEffect(() => {
    if (ownerRef.current) return; // Single owner guard
    ownerRef.current = true;
    mountedRef.current = true;

    // Recover stale in-flight events from previous session
    recoverStaleInFlight().catch(() => {});

    // Initial health check
    safeSetState(setConnectionState, 'connecting');
    checkHealth();

    // Health poll loop
    const startHealthPoll = () => {
      healthTimerRef.current = setInterval(() => {
        checkHealth();
      }, HEALTH_POLL_INTERVAL);
    };
    startHealthPoll();

    // Drain loop
    const startDrainLoop = () => {
      drainTimerRef.current = setInterval(() => {
        drainQueue();
      }, DRAIN_INTERVAL);
    };
    startDrainLoop();

    // Online/offline listeners
    const handleOnline = () => {
      consecutiveFailuresRef.current = 0;
      safeSetState(setConnectionState, 'connecting');
      checkHealth();
    };

    const handleOffline = () => {
      safeSetState(setConnectionState, 'offline');
      safeSetState(setBackendHealth, 'unreachable');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial queue count
    getPendingCount()
      .then(count => safeSetState(setQueuedSyncCount, count))
      .catch(() => {});

    return () => {
      mountedRef.current = false;
      ownerRef.current = false;

      if (healthTimerRef.current) clearInterval(healthTimerRef.current);
      if (drainTimerRef.current) clearInterval(drainTimerRef.current);
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);

      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connectionState,
    backendHealth,
    queuedSyncCount,
    pendingUploads,
    lastSuccessfulSync,
    reconnectAttempts,
    isOfflineMode,
    backendLatencyMs,
    enqueueSync,
    forceReconnect,
  };
}
