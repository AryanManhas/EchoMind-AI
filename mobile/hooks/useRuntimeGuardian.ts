import { useState, useEffect, useRef, useCallback } from 'react';
import { useRuntimeHealth, type RuntimeHealthInput, type RuntimeHealthSnapshot } from './useRuntimeHealth';

export type RuntimeMode = 'healthy' | 'degraded' | 'safe_mode' | 'recovering';

export interface RuntimeGuardianState {
  mode: RuntimeMode;
  snapshot: RuntimeHealthSnapshot;
  warningHistory: string[];
  throttles: {
    shouldPauseStreaming: boolean;
    shouldThrottleProactive: boolean;
    shouldDeferBackgroundSync: boolean;
    shouldPauseMicrophone: boolean;
  };
  recoverSubsystems: () => void;
}

const DEGRADATION_THRESHOLD = 50; // stabilityScore below this triggers degraded mode
const SAFE_MODE_THRESHOLD = 25; // stabilityScore below this triggers safe mode
const AUTO_RECOVERY_DELAY_MS = 3 * 60 * 1000; // 3 minutes

export function useRuntimeGuardian(input: RuntimeHealthInput): RuntimeGuardianState {
  const { snapshot, warningHistory } = useRuntimeHealth(input);
  
  const [mode, setMode] = useState<RuntimeMode>('healthy');
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active Anomaly Supervision
  useEffect(() => {
    if (mode === 'recovering') return; // Don't aggressively degrade if we are currently attempting recovery

    const score = snapshot.stabilityScore;
    let nextMode: RuntimeMode = mode;

    if (score <= SAFE_MODE_THRESHOLD || snapshot.anomalies.length >= 3) {
      nextMode = 'safe_mode';
    } else if (score <= DEGRADATION_THRESHOLD || snapshot.warnings.length >= 5) {
      nextMode = 'degraded';
    } else if (mode === 'degraded' && score >= 80) {
      nextMode = 'healthy'; // natural recovery
    }

    if (nextMode !== mode) {
      if (__DEV__) console.log(`[RuntimeGuardian] Transitioning to ${nextMode} (Score: ${score})`);
      setMode(nextMode);

      if (nextMode === 'safe_mode') {
        // Schedule auto-recovery attempt
        if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = setTimeout(() => {
          if (__DEV__) console.log('[RuntimeGuardian] Attempting auto-recovery from safe_mode');
          setMode('recovering');
          
          // Give it 15 seconds to stabilize, then re-evaluate
          setTimeout(() => setMode('healthy'), 15000);
        }, AUTO_RECOVERY_DELAY_MS);
      }
    }
  }, [snapshot.stabilityScore, snapshot.anomalies.length, snapshot.warnings.length, mode]);

  // Clean up timer
  useEffect(() => {
    return () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    };
  }, []);

  const recoverSubsystems = useCallback(() => {
    if (__DEV__) console.log('[RuntimeGuardian] Force recovering subsystems');
    setMode('recovering');
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    
    // Give it 5 seconds to clear out bad state before returning to healthy assessment
    setTimeout(() => {
      setMode('healthy');
    }, 5000);
  }, []);

  const isDegradedOrWorse = mode === 'degraded' || mode === 'safe_mode';
  const isSafeMode = mode === 'safe_mode';

  const throttles = {
    shouldPauseStreaming: isDegradedOrWorse || snapshot.throttledSystems.includes('prompt') || snapshot.throttledSystems.includes('memory'),
    shouldThrottleProactive: isDegradedOrWorse || snapshot.throttledSystems.includes('proactive_assistant'),
    shouldDeferBackgroundSync: isSafeMode || snapshot.throttledSystems.includes('sync_queue') || snapshot.throttledSystems.includes('websocket'),
    shouldPauseMicrophone: isSafeMode || snapshot.anomalies.some(a => a.toLowerCase().includes('runaway')),
  };

  return {
    mode,
    snapshot,
    warningHistory,
    throttles,
    recoverSubsystems,
  };
}
