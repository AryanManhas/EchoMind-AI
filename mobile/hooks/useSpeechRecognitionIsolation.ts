import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  isRecognitionAvailable,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

const LOG_PREFIX = '[SpeechRecognitionIsolation]';

/** Throttle partial transcript React updates — avoids render storms. */
const PARTIAL_UI_THROTTLE_MS = 150;

const DEFAULT_LOCALE = 'en-US';

export type SpeechPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'undetermined';

function logDiagnostic(message: string): void {
  if (__DEV__) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

export type UseSpeechRecognitionIsolationReturn = {
  isRecognizing: boolean;
  permissionStatus: SpeechPermissionStatus;
  partialTranscript: string;
  finalTranscript: string;
  /** Combined view: finalized lines + current partial. */
  displayTranscript: string;
  lastDiagnostic: string;
  errorMessage: string | null;
  requestPermission: () => Promise<boolean>;
  startRecognition: () => Promise<boolean>;
  stopRecognition: () => Promise<void>;
  clearTranscript: () => void;
};

/**
 * Isolated on-device STT for validation only.
 * No websocket, AI, memory engine, or backend uploads.
 */
export function useSpeechRecognitionIsolation(): UseSpeechRecognitionIsolationReturn {
  const sessionActiveRef = useRef(false);
  const isStartingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const finalsRef = useRef<string[]>([]);
  const partialRef = useRef('');
  const lastPartialUiEmitRef = useRef(0);
  const partialThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isRecognizing, setIsRecognizing] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<SpeechPermissionStatus>('unknown');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [lastDiagnostic, setLastDiagnostic] = useState('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastDiagnosticRef = useRef('idle');

  const setDiagnostic = useCallback((message: string) => {
    if (lastDiagnosticRef.current === message) return;
    lastDiagnosticRef.current = message;
    setLastDiagnostic(message);
    logDiagnostic(message);
  }, []);

  const rebuildFinalDisplay = useCallback(() => {
    setFinalTranscript(finalsRef.current.join(' '));
  }, []);

  const flushPartialToUi = useCallback(() => {
    setPartialTranscript(partialRef.current);
    lastPartialUiEmitRef.current = Date.now();
  }, []);

  const schedulePartialUiUpdate = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastPartialUiEmitRef.current;
    if (elapsed >= PARTIAL_UI_THROTTLE_MS) {
      flushPartialToUi();
      return;
    }
    if (partialThrottleTimerRef.current) return;
    partialThrottleTimerRef.current = setTimeout(() => {
      partialThrottleTimerRef.current = null;
      flushPartialToUi();
      setDiagnostic('partial transcript received');
    }, PARTIAL_UI_THROTTLE_MS - elapsed);
  }, [flushPartialToUi, setDiagnostic]);

  const clearPartialThrottleTimer = useCallback(() => {
    if (partialThrottleTimerRef.current) {
      clearTimeout(partialThrottleTimerRef.current);
      partialThrottleTimerRef.current = null;
    }
  }, []);

  const clearTranscript = useCallback(() => {
    finalsRef.current = [];
    partialRef.current = '';
    setPartialTranscript('');
    setFinalTranscript('');
    setErrorMessage(null);
    setDiagnostic('transcript cleared');
  }, [setDiagnostic]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { granted, status } =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      const next: SpeechPermissionStatus = granted
        ? 'granted'
        : status === 'denied'
          ? 'denied'
          : 'undetermined';
      setPermissionStatus(next);
      setDiagnostic(`permission ${next}`);
      return granted;
    } catch (error) {
      setPermissionStatus('denied');
      setDiagnostic('permission request failed');
      console.warn(LOG_PREFIX, error);
      return false;
    }
  }, [setDiagnostic]);

  const stopRecognition = useCallback(async () => {
    if (!sessionActiveRef.current && !isRecognizing) {
      return;
    }
    if (isStoppingRef.current) {
      return;
    }

    isStoppingRef.current = true;
    setDiagnostic('recognition stop requested');

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      sessionActiveRef.current = false;
      if (isRecognizing) {
        setIsRecognizing(false);
      }
      clearPartialThrottleTimer();
      flushPartialToUi();
      setDiagnostic('recognition stopped — cleanup completed');
      isStoppingRef.current = false;
    }
  }, [clearPartialThrottleTimer, flushPartialToUi, isRecognizing, setDiagnostic]);

  const startRecognition = useCallback(async (): Promise<boolean> => {
    if (isStartingRef.current || sessionActiveRef.current) {
      setDiagnostic('recognition start skipped — already active');
      return false;
    }

    isStartingRef.current = true;
    setDiagnostic('recognition start requested');
    setErrorMessage(null);

    try {
      const available = isRecognitionAvailable();
      if (!available) {
        setErrorMessage('Speech recognition is not available on this device.');
        setDiagnostic('recognition start aborted — unavailable');
        return false;
      }

      const granted = await requestPermission();
      if (!granted) {
        setErrorMessage('Microphone / speech permission denied.');
        setDiagnostic('recognition start aborted — permission denied');
        return false;
      }

      finalsRef.current = [];
      partialRef.current = '';
      setPartialTranscript('');
      setFinalTranscript('');

      sessionActiveRef.current = true;

      ExpoSpeechRecognitionModule.start({
        lang: DEFAULT_LOCALE,
        interimResults: true,
        continuous: true,
      });

      return true;
    } catch (error) {
      sessionActiveRef.current = false;
      setIsRecognizing(false);
      const message =
        error instanceof Error ? error.message : 'Failed to start recognition';
      setErrorMessage(message);
      setDiagnostic('recognition start failed');
      console.warn(LOG_PREFIX, error);
      return false;
    } finally {
      isStartingRef.current = false;
    }
  }, [requestPermission, setDiagnostic]);

  useSpeechRecognitionEvent('start', () => {
    if (!sessionActiveRef.current) return;
    setIsRecognizing(true);
    setDiagnostic('recognition started');
  });

  useSpeechRecognitionEvent('end', () => {
    sessionActiveRef.current = false;
    isStoppingRef.current = false;
    setIsRecognizing(false);
    clearPartialThrottleTimer();
    flushPartialToUi();
    setDiagnostic('recognition stopped — cleanup completed');
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!sessionActiveRef.current) return;

    const result = event.results[0];
    if (!result?.transcript) return;

    if (event.isFinal) {
      clearPartialThrottleTimer();
      const text = result.transcript.trim();
      if (text.length > 0) {
        finalsRef.current.push(text);
        rebuildFinalDisplay();
        partialRef.current = '';
        setPartialTranscript('');
        setDiagnostic(`final transcript received (${text.length} chars)`);
      }
      return;
    }

    partialRef.current = result.transcript;
    schedulePartialUiUpdate();
  });

  useSpeechRecognitionEvent('error', (event) => {
    sessionActiveRef.current = false;
    isStoppingRef.current = false;
    setIsRecognizing(false);
    clearPartialThrottleTimer();

    const message =
      event.message || event.error || 'Speech recognition error';
    setErrorMessage(message);
    setDiagnostic(`recognition error: ${message}`);
  });

  useEffect(() => {
    return () => {
      logDiagnostic('unmount — aborting recognition');
      clearPartialThrottleTimer();
      sessionActiveRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // Already torn down
        }
      }
    };
  }, [clearPartialThrottleTimer]);

  const displayTranscript = [
    finalTranscript,
    partialTranscript ? `[…] ${partialTranscript}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    isRecognizing,
    permissionStatus,
    partialTranscript,
    finalTranscript,
    displayTranscript,
    lastDiagnostic,
    errorMessage,
    requestPermission,
    startRecognition,
    stopRecognition,
    clearTranscript,
  };
}
