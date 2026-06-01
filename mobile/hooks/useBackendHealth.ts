import { useCallback, useEffect, useRef, useState } from 'react';
import ENV from '../lib/env';
import { TransportManager } from '../lib/transport';

export type BackendHealthState = 'healthy' | 'degraded' | 'unreachable';

export type BackendHealthSnapshot = {
  backendHealth: BackendHealthState;
  backendLatencyMs: number | null;
  lastHealthCheckAt: number | null;
};

const HEALTH_TIMEOUT_MS = 5_000;

export function useBackendHealth() {
  const [snapshot, setSnapshot] = useState<BackendHealthSnapshot>({
    backendHealth: 'unreachable',
    backendLatencyMs: null,
    lastHealthCheckAt: null,
  });
  const snapshotRef = useRef(snapshot);
  const activeCheckRef = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const checkBackendHealth = useCallback(async (): Promise<BackendHealthSnapshot> => {
    if (activeCheckRef.current) return snapshotRef.current;
    activeCheckRef.current = true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      const apiUrl = TransportManager.getApiUrl() || ENV.API_URL;
      const response = await fetch(`${apiUrl}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const status = data?.data?.status || data?.status;
      const next: BackendHealthSnapshot = {
        backendHealth: status === 'degraded' ? 'degraded' : 'healthy',
        backendLatencyMs: Date.now() - startedAt,
        lastHealthCheckAt: Date.now(),
      };
      setSnapshot(next);
      return next;
    } catch {
      clearTimeout(timer);
      const next: BackendHealthSnapshot = {
        backendHealth: 'unreachable',
        backendLatencyMs: null,
        lastHealthCheckAt: Date.now(),
      };
      setSnapshot(next);
      return next;
    } finally {
      activeCheckRef.current = false;
    }
  }, []);

  return {
    ...snapshot,
    checkBackendHealth,
  };
}
