import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';

const LOG_PREFIX = '[VoiceActivityDetection]';

/** Sample cadence — aligned with mic meter (~25 Hz), not per-frame React. */
export const VAD_SAMPLE_MS = 40;

/** UI sync cadence — avoids render storms. */
const VAD_UI_SYNC_MS = 200;

/** Brief finalize phase before returning to idle. */
const FINALIZE_HOLD_MS = 150;

/**
 * Must stay below silenceDurationMs so short conversational pauses
 * do not immediately enter long-silence countdown.
 */
const ENTER_SILENCE_PENDING_MS = 280;

export type VadState =
  | 'idle'
  | 'speech_detected'
  | 'recording'
  | 'silence_pending'
  | 'finalize';

/**
 * Bilingual-ready session hints for future continuous multilingual STT.
 * No manual language switching in validation — amplitude-only VAD.
 */
export type VadSessionLocaleHints = {
  readonly supportsCodeSwitching: true;
  readonly preferredLocales: readonly ['en-US', 'hi-IN'];
};

export const VAD_DEFAULT_LOCALE_HINTS: VadSessionLocaleHints = {
  supportsCodeSwitching: true,
  preferredLocales: ['en-US', 'hi-IN'],
};

export type VadConfig = {
  speechThreshold: number;
  sustainedSpeechMs: number;
  silenceThreshold: number;
  silenceDurationMs: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechThreshold: 0.12,
  sustainedSpeechMs: 120,
  silenceThreshold: 0.04,
  silenceDurationMs: 2200,
};

export type UseVoiceActivityDetectionOptions = {
  audioLevel: SharedValue<number>;
  /** When false, polling stops and internal state resets to idle. */
  enabled: boolean;
  config?: Partial<VadConfig>;
  onSpeechSessionStart?: () => void;
  onSpeechSessionFinalize?: () => void;
};

export type UseVoiceActivityDetectionReturn = {
  vadState: VadState;
  isSpeechDetected: boolean;
  /** Milliseconds until finalize when in silence_pending; null otherwise. */
  silenceRemainingMs: number | null;
  finalizeCount: number;
  sessionCount: number;
  lastDiagnostic: string;
  localeHints: VadSessionLocaleHints;
  reset: () => void;
};

function logTransition(from: VadState, to: VadState): void {
  if (__DEV__) {
    console.log(`${LOG_PREFIX} ${from} → ${to}`);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Amplitude + timing VAD controller — no STT, websocket, or transcript timing.
 * Drives isolated validation lifecycle: speech start → recording → silence → finalize.
 */
export function useVoiceActivityDetection(
  options: UseVoiceActivityDetectionOptions
): UseVoiceActivityDetectionReturn {
  const { audioLevel, enabled, config: configOverride } = options;

  const configRef = useRef<VadConfig>({
    ...DEFAULT_VAD_CONFIG,
    ...configOverride,
  });
  configRef.current = { ...DEFAULT_VAD_CONFIG, ...configOverride };

  const onSessionStartRef = useRef(options.onSpeechSessionStart);
  const onSessionFinalizeRef = useRef(options.onSpeechSessionFinalize);
  onSessionStartRef.current = options.onSpeechSessionStart;
  onSessionFinalizeRef.current = options.onSpeechSessionFinalize;

  const stateRef = useRef<VadState>('idle');
  const speechAboveSinceRef = useRef(0);
  const quietBelowSinceRef = useRef(0);
  const silencePendingSinceRef = useRef(0);
  const finalizeSinceRef = useRef(0);
  const sessionCountRef = useRef(0);
  const finalizeCountRef = useRef(0);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDiagnosticRef = useRef('idle');

  const [vadState, setVadState] = useState<VadState>('idle');
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [silenceRemainingMs, setSilenceRemainingMs] = useState<number | null>(
    null
  );
  const [finalizeCount, setFinalizeCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastDiagnostic, setLastDiagnostic] = useState('idle');

  const setDiagnostic = useCallback((message: string) => {
    if (lastDiagnosticRef.current === message) return;
    lastDiagnosticRef.current = message;
    setLastDiagnostic(message);
    if (__DEV__) {
      console.log(`${LOG_PREFIX} ${message}`);
    }
  }, []);

  const resetTimers = useCallback(() => {
    speechAboveSinceRef.current = 0;
    quietBelowSinceRef.current = 0;
    silencePendingSinceRef.current = 0;
    finalizeSinceRef.current = 0;
  }, []);

  const transition = useCallback(
    (next: VadState) => {
      const prev = stateRef.current;
      if (prev === next) return;
      stateRef.current = next;
      logTransition(prev, next);
      setDiagnostic(`state ${next}`);
    },
    [setDiagnostic]
  );

  const hardResetToIdle = useCallback(() => {
    resetTimers();
    stateRef.current = 'idle';
    setDiagnostic('reset — idle');
  }, [resetTimers, setDiagnostic]);

  const reset = useCallback(() => {
    hardResetToIdle();
    sessionCountRef.current = 0;
    finalizeCountRef.current = 0;
    setSessionCount(0);
    setFinalizeCount(0);
    setSilenceRemainingMs(null);
    setIsSpeechDetected(false);
    setVadState('idle');
  }, [hardResetToIdle]);

  const processSample = useCallback(
    (level: number, now: number) => {
      const cfg = configRef.current;
      const clamped = clamp01(level);
      const state = stateRef.current;

      switch (state) {
        case 'idle': {
          if (clamped > cfg.speechThreshold) {
            if (speechAboveSinceRef.current === 0) {
              speechAboveSinceRef.current = now;
            }
            if (now - speechAboveSinceRef.current >= cfg.sustainedSpeechMs) {
              speechAboveSinceRef.current = 0;
              quietBelowSinceRef.current = 0;
              sessionCountRef.current += 1;
              transition('speech_detected');
              onSessionStartRef.current?.();
            }
          } else {
            speechAboveSinceRef.current = 0;
          }
          break;
        }

        case 'speech_detected': {
          if (clamped > cfg.speechThreshold) {
            transition('recording');
            quietBelowSinceRef.current = 0;
          } else {
            transition('idle');
            resetTimers();
          }
          break;
        }

        case 'recording': {
          if (clamped < cfg.silenceThreshold) {
            if (quietBelowSinceRef.current === 0) {
              quietBelowSinceRef.current = now;
            }
            if (
              now - quietBelowSinceRef.current >= ENTER_SILENCE_PENDING_MS
            ) {
              silencePendingSinceRef.current = now;
              quietBelowSinceRef.current = 0;
              transition('silence_pending');
            }
          } else {
            quietBelowSinceRef.current = 0;
          }
          break;
        }

        case 'silence_pending': {
          if (clamped >= cfg.speechThreshold) {
            silencePendingSinceRef.current = 0;
            transition('recording');
            break;
          }

          const pendingSince = silencePendingSinceRef.current;
          if (pendingSince === 0) {
            silencePendingSinceRef.current = now;
            break;
          }

          if (now - pendingSince >= cfg.silenceDurationMs) {
            finalizeCountRef.current += 1;
            finalizeSinceRef.current = now;
            transition('finalize');
            onSessionFinalizeRef.current?.();
          }
          break;
        }

        case 'finalize': {
          if (now - finalizeSinceRef.current >= FINALIZE_HOLD_MS) {
            resetTimers();
            transition('idle');
          }
          break;
        }

        default:
          break;
      }
    },
    [resetTimers, transition]
  );

  const syncUiFromRefs = useCallback(() => {
    const state = stateRef.current;
    const cfg = configRef.current;

    setVadState((prev) => (prev === state ? prev : state));

    const speechActive = state !== 'idle';
    setIsSpeechDetected((prev) => (prev === speechActive ? prev : speechActive));

    let remaining: number | null = null;
    if (state === 'silence_pending' && silencePendingSinceRef.current > 0) {
      const elapsed = Date.now() - silencePendingSinceRef.current;
      remaining = Math.max(0, cfg.silenceDurationMs - elapsed);
    }
    setSilenceRemainingMs((prev) => {
      if (prev === remaining) return prev;
      if (
        prev != null &&
        remaining != null &&
        Math.abs(prev - remaining) < 80
      ) {
        return prev;
      }
      return remaining;
    });

    const sessions = sessionCountRef.current;
    setSessionCount((prev) => (prev === sessions ? prev : sessions));

    const finalizes = finalizeCountRef.current;
    setFinalizeCount((prev) => (prev === finalizes ? prev : finalizes));
  }, []);

  const clearSampleInterval = useCallback(() => {
    if (sampleIntervalRef.current) {
      clearInterval(sampleIntervalRef.current);
      sampleIntervalRef.current = null;
    }
  }, []);

  const clearUiSyncInterval = useCallback(() => {
    if (uiSyncIntervalRef.current) {
      clearInterval(uiSyncIntervalRef.current);
      uiSyncIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearSampleInterval();
      clearUiSyncInterval();
      hardResetToIdle();
      setVadState('idle');
      setIsSpeechDetected(false);
      setSilenceRemainingMs(null);
      return;
    }

    setDiagnostic('armed — sampling audioLevel');
    hardResetToIdle();
    setVadState('idle');

    sampleIntervalRef.current = setInterval(() => {
      processSample(audioLevel.value, Date.now());
    }, VAD_SAMPLE_MS);

    uiSyncIntervalRef.current = setInterval(syncUiFromRefs, VAD_UI_SYNC_MS);

    return () => {
      clearSampleInterval();
      clearUiSyncInterval();
      hardResetToIdle();
      setDiagnostic('disarmed — idle');
    };
  }, [
    audioLevel,
    clearSampleInterval,
    clearUiSyncInterval,
    enabled,
    hardResetToIdle,
    processSample,
    setDiagnostic,
    syncUiFromRefs,
  ]);

  return {
    vadState,
    isSpeechDetected,
    silenceRemainingMs,
    finalizeCount,
    sessionCount,
    lastDiagnostic,
    localeHints: VAD_DEFAULT_LOCALE_HINTS,
    reset,
  };
}

/** Map VAD states to existing OrbVisualizer capture states (validation only). */
export function vadStateToOrbCapture(
  vadState: VadState,
  armed = false
): 'idle' | 'speech_detected' | 'passive_listening' | 'recording' | 'processing' {
  switch (vadState) {
    case 'idle':
      return armed ? 'passive_listening' : 'idle';
    case 'speech_detected':
      return 'speech_detected';
    case 'recording':
    case 'silence_pending':
      return 'recording';
    case 'finalize':
      return 'processing';
    default:
      return 'idle';
  }
}
