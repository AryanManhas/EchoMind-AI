import { useState, useCallback } from 'react';
import { AppStateStatus } from 'react-native';

export type WakeWordState =
  | 'inactive'
  | 'initializing'
  | 'passive_listening'
  | 'detected'
  | 'handing_off'
  | 'suspended'
  | 'failed';

export interface UseWakeWordOptions {
  onWakeWordDetected: () => void;
  keyword?: string;
  sensitivity?: number;
}

export interface UseWakeWordReturn {
  state: WakeWordState;
  isPassiveListening: boolean;
  error: string | null;
  diagnostics: {
    lastStartedAt: number | null;
    lastStoppedAt: number | null;
    restartSuppressedCount: number;
    initFailedCount: number;
    nativeAvailable: boolean;
    appState: AppStateStatus;
    hasFrameListener: boolean;
  };
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export function useWakeWord({
  onWakeWordDetected,
}: UseWakeWordOptions): UseWakeWordReturn {
  const start = useCallback(async (): Promise<boolean> => {
    return false;
  }, []);

  const stop = useCallback(async () => {}, []);
  const cleanup = useCallback(async () => {}, []);

  return {
    state: 'inactive',
    isPassiveListening: false,
    error: null,
    diagnostics: {
      lastStartedAt: null,
      lastStoppedAt: null,
      restartSuppressedCount: 0,
      initFailedCount: 0,
      nativeAvailable: false,
      appState: 'active',
      hasFrameListener: false,
    },
    start,
    stop,
    cleanup,
  };
}

export default useWakeWord;
