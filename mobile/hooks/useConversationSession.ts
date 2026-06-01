import { useCallback, useEffect, useRef, useState } from 'react';
import type { VadState } from './useVoiceActivityDetection';
import {
  VAD_DEFAULT_LOCALE_HINTS,
  type VadSessionLocaleHints,
} from './useVoiceActivityDetection';

const LOG_PREFIX = '[ConversationSession]';

/** UI sync — avoids render storms. */
const SESSION_UI_SYNC_MS = 200;

/** Long silence ends capture (pause-aware; short pauses reset activity). */
export const CONVERSATION_SILENCE_FINALIZE_MS = 2200;

/** Enter silence_pending before finalize (mirrors VAD short-pause tolerance). */
const ENTER_SILENCE_PENDING_MS = 280;

const SILENCE_WATCH_MS = 250;

/** Brief finalized state before returning to passive_listening. */
const FINALIZED_HOLD_MS = 200;

export type ConversationSessionState =
  | 'passive_listening'
  | 'speech_detected'
  | 'capturing'
  | 'silence_pending'
  | 'finalizing'
  | 'finalized';

export type ConversationSession = {
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  finalizedAt: number | null;
  state: ConversationSessionState;
  partialTranscript: string;
  finalizedTranscript: string;
  mergedTranscript: string;
  utteranceCount: number;
  silenceTransitions: number;
  localeHints: VadSessionLocaleHints;
};

export type ConversationSessionSnapshot = ConversationSession & {
  durationMs: number;
};

export type ConversationAudioCommands = {
  startRecognition: () => Promise<boolean>;
  stopRecognition: () => Promise<void>;
  startMetering: () => Promise<boolean>;
  stopMetering: () => Promise<void>;
};

export type UseConversationSessionReturn = {
  armed: boolean;
  currentSession: ConversationSessionSnapshot | null;
  completedSessionCount: number;
  lastDiagnostic: string;
  arm: () => void;
  disarm: () => void;
  handleVadTransition: (
    from: VadState,
    to: VadState
  ) => Promise<void>;
  ingestPartial: (text: string) => void;
  ingestFinalDelta: (fullFinalTranscript: string) => void;
  resetCurrentSession: () => void;
};

function logDiagnostic(message: string): void {
  if (__DEV__) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function createSessionId(): string {
  return `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimText(text: string): string {
  return text.trim();
}

/** Preserve natural spacing for bilingual/code-switch phrases. */
function mergeChunks(chunks: readonly string[]): string {
  return chunks
    .map((c) => trimText(c))
    .filter((c) => c.length > 0)
    .join(' ');
}

function isDuplicateChunk(chunks: readonly string[], next: string): boolean {
  const t = trimText(next);
  if (!t) return true;
  const last = chunks[chunks.length - 1];
  if (!last) return false;
  
  const lastLower = trimText(last).toLowerCase();
  const tLower = t.toLowerCase();
  
  if (lastLower === tLower) return true;
  if (lastLower.endsWith(tLower)) return true;
  if (lastLower.includes(tLower)) return true;
  
  return false;
}

function buildSessionSnapshot(
  data: ConversationSession,
  now: number
): ConversationSessionSnapshot {
  return {
    ...data,
    durationMs: (data.finalizedAt ?? now) - data.startedAt,
  };
}

type InternalSession = ConversationSession & {
  finalChunks: string[];
  lastPartialIngest: string;
  lastActivityAt: number;
  lastFinalTranscriptSeen: string;
};

function createInternalSession(now: number): InternalSession {
  const sessionId = createSessionId();
  return {
    sessionId,
    startedAt: now,
    updatedAt: now,
    finalizedAt: null,
    state: 'passive_listening',
    partialTranscript: '',
    finalizedTranscript: '',
    mergedTranscript: '',
    utteranceCount: 0,
    silenceTransitions: 0,
    localeHints: VAD_DEFAULT_LOCALE_HINTS,
    finalChunks: [],
    lastPartialIngest: '',
    lastActivityAt: now,
    lastFinalTranscriptSeen: '',
  };
}

/**
 * Local conversational session orchestration — no websocket, AI, or backend.
 * Pairs with unified audio + amplitude VAD on the validation route only.
 */
export function useConversationSession(
  audio: ConversationAudioCommands
): UseConversationSessionReturn {
  const audioRef = useRef(audio);
  audioRef.current = audio;

  const armedRef = useRef(false);
  const sessionRef = useRef<InternalSession | null>(null);
  const isFinalizingRef = useRef(false);
  const isStartingCaptureRef = useRef(false);
  const silenceWatchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDiagnosticRef = useRef('idle');
  const completedCountRef = useRef(0);
  const mountedRef = useRef(true);

  const [armed, setArmed] = useState(false);
  const [currentSession, setCurrentSession] =
    useState<ConversationSessionSnapshot | null>(null);
  const [completedSessionCount, setCompletedSessionCount] = useState(0);
  const [lastDiagnostic, setLastDiagnostic] = useState('idle');

  const setDiagnostic = useCallback((message: string) => {
    if (lastDiagnosticRef.current === message) return;
    lastDiagnosticRef.current = message;
    setLastDiagnostic(message);
    logDiagnostic(message);
  }, []);

  const syncUi = useCallback(() => {
    const s = sessionRef.current;
    const now = Date.now();
    const snapshot = s ? buildSessionSnapshot(s, now) : null;
    setCurrentSession((prev) => {
      if (!snapshot && !prev) return prev;
      if (!snapshot) return null;
      if (
        prev &&
        prev.sessionId === snapshot.sessionId &&
        prev.state === snapshot.state &&
        prev.partialTranscript === snapshot.partialTranscript &&
        prev.mergedTranscript === snapshot.mergedTranscript &&
        prev.utteranceCount === snapshot.utteranceCount &&
        prev.silenceTransitions === snapshot.silenceTransitions
      ) {
        return prev;
      }
      return snapshot;
    });
    setCompletedSessionCount((prev) =>
      prev === completedCountRef.current ? prev : completedCountRef.current
    );
  }, []);

  const clearSilenceWatch = useCallback(() => {
    if (silenceWatchRef.current) {
      clearInterval(silenceWatchRef.current);
      silenceWatchRef.current = null;
    }
  }, []);

  const clearFinalizedTimer = useCallback(() => {
    if (finalizedTimerRef.current) {
      clearTimeout(finalizedTimerRef.current);
      finalizedTimerRef.current = null;
    }
  }, []);

  const transitionSession = useCallback(
    (next: ConversationSessionState) => {
      const s = sessionRef.current;
      if (!s || s.state === next) return;
      const prev = s.state;
      s.state = next;
      s.updatedAt = Date.now();
      setDiagnostic(`${prev} → ${next} (${s.sessionId})`);
      syncUi();
    },
    [setDiagnostic, syncUi]
  );

  const touchActivity = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.lastActivityAt = Date.now();
    if (s.state === 'silence_pending') {
      transitionSession('capturing');
    }
  }, [transitionSession]);

  const rebuildMerged = useCallback((s: InternalSession) => {
    const partial = trimText(s.partialTranscript);
    const finals = mergeChunks(s.finalChunks);
    s.finalizedTranscript = finals;
    
    if (partial && finals) {
      const fLower = finals.toLowerCase();
      const pLower = partial.toLowerCase();
      if (fLower.endsWith(pLower)) {
        s.mergedTranscript = finals;
      } else {
        s.mergedTranscript = `${finals} ${partial}`;
      }
    } else {
      s.mergedTranscript = partial || finals;
    }
    s.updatedAt = Date.now();
  }, []);

  const returnToPassiveListening = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || !armedRef.current) return;

    clearSilenceWatch();
    try {
      await audioRef.current.stopRecognition();
      await audioRef.current.startMetering();
    } catch (e) {
      logDiagnostic(`returnToPassiveListening error: ${e}`);
    }

    sessionRef.current = createInternalSession(Date.now());
    setDiagnostic('passive_listening — ready for next session');
    syncUi();
  }, [clearSilenceWatch, setDiagnostic, syncUi]);

  const startSilenceWatch = useCallback(() => {
    clearSilenceWatch();
    silenceWatchRef.current = setInterval(() => {
      const s = sessionRef.current;
      if (!s || !armedRef.current || isFinalizingRef.current) return;

      if (s.state !== 'capturing' && s.state !== 'silence_pending') {
        return;
      }

      const elapsed = Date.now() - s.lastActivityAt;

      // Inactivity cleanup safeguard (15s hard reset)
      if (elapsed >= 15000) {
        setDiagnostic('inactivity cleanup');
        void returnToPassiveListening();
        return;
      }

      if (s.state === 'capturing' && elapsed >= ENTER_SILENCE_PENDING_MS) {
        s.silenceTransitions += 1;
        transitionSession('silence_pending');
      }

      if (elapsed >= CONVERSATION_SILENCE_FINALIZE_MS) {
        void finalizeSessionRef.current();
      }
    }, SILENCE_WATCH_MS);
  }, [clearSilenceWatch, transitionSession, returnToPassiveListening, setDiagnostic]);



  const finalizeSessionRef = useRef<() => Promise<void>>(async () => {});

  const finalizeSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || isFinalizingRef.current) return;
    if (s.state === 'finalized' || s.state === 'passive_listening') return;
    if (s.finalizedAt !== null) return;

    isFinalizingRef.current = true;
    clearSilenceWatch();
    transitionSession('finalizing');

    if (trimText(s.partialTranscript)) {
      const tail = trimText(s.partialTranscript);
      if (!isDuplicateChunk(s.finalChunks, tail)) {
        s.finalChunks.push(tail);
        s.utteranceCount += 1;
      }
      s.partialTranscript = '';
    }

    rebuildMerged(s);

    try {
      await audioRef.current.stopRecognition();
    } catch (e) {
      logDiagnostic(`stopRecognition error: ${e}`);
    } finally {
      s.finalizedAt = Date.now();
      s.updatedAt = s.finalizedAt;
      s.partialTranscript = '';
      rebuildMerged(s);
      completedCountRef.current += 1;
      transitionSession('finalized');
      setDiagnostic(`finalized · ${s.mergedTranscript.length} chars`);

      clearFinalizedTimer();
      finalizedTimerRef.current = setTimeout(() => {
        isFinalizingRef.current = false;
        if (!armedRef.current || !mountedRef.current) return;
        void returnToPassiveListening();
      }, FINALIZED_HOLD_MS);
    }
  }, [
    clearFinalizedTimer,
    clearSilenceWatch,
    rebuildMerged,
    returnToPassiveListening,
    setDiagnostic,
    transitionSession,
  ]);

  finalizeSessionRef.current = finalizeSession;

  const beginCaptureFromVad = useCallback(async () => {
    if (isStartingCaptureRef.current || isFinalizingRef.current) return;
    isStartingCaptureRef.current = true;

    try {
      const now = Date.now();
      if (
        !sessionRef.current ||
        sessionRef.current.state === 'finalized' ||
        sessionRef.current.state === 'passive_listening'
      ) {
        sessionRef.current = createInternalSession(now);
      }

      const s = sessionRef.current;
      transitionSession('speech_detected');

      const started = await audioRef.current.startRecognition();
      if (!started) {
        setDiagnostic('capture aborted — recognition failed');
        transitionSession('passive_listening');
        await audioRef.current.startMetering();
        return;
      }

      s.lastActivityAt = Date.now();
      transitionSession('capturing');
      startSilenceWatch();
      setDiagnostic('capturing — recognition active');
    } finally {
      isStartingCaptureRef.current = false;
    }
  }, [setDiagnostic, startSilenceWatch, transitionSession]);

  const handleVadTransition = useCallback(
    async (from: VadState, to: VadState) => {
      if (!armedRef.current) return;

      if (to === 'speech_detected' && from !== 'speech_detected') {
        const s = sessionRef.current;
        if (
          !s ||
          s.state === 'passive_listening' ||
          s.state === 'finalized'
        ) {
          if (s?.state === 'finalized') {
            sessionRef.current = createInternalSession(Date.now());
          }
          await beginCaptureFromVad();
        }
      }
    },
    [beginCaptureFromVad]
  );

  const ingestPartial = useCallback(
    (text: string) => {
      const s = sessionRef.current;
      if (!s || s.state !== 'capturing' && s.state !== 'silence_pending') {
        return;
      }

      const next = trimText(text);
      if (next === s.lastPartialIngest) return;

      s.lastPartialIngest = next;
      s.partialTranscript = next;
      touchActivity();
      rebuildMerged(s);
      syncUi();
    },
    [rebuildMerged, syncUi, touchActivity]
  );

  const ingestFinalDelta = useCallback(
    (fullFinalTranscript: string) => {
      const s = sessionRef.current;
      if (!s || s.state !== 'capturing' && s.state !== 'silence_pending') {
        return;
      }

      const prevSeen = s.lastFinalTranscriptSeen;
      if (fullFinalTranscript === prevSeen) return;

      let delta = fullFinalTranscript;
      if (
        prevSeen.length > 0 &&
        fullFinalTranscript.startsWith(prevSeen)
      ) {
        delta = trimText(fullFinalTranscript.slice(prevSeen.length));
      }

      s.lastFinalTranscriptSeen = fullFinalTranscript;

      if (delta && !isDuplicateChunk(s.finalChunks, delta)) {
        s.finalChunks.push(delta);
        s.utteranceCount += 1;
        s.partialTranscript = '';
        s.lastPartialIngest = '';
        touchActivity();
        rebuildMerged(s);
        syncUi();
      }
    },
    [rebuildMerged, syncUi, touchActivity]
  );

  const arm = useCallback(() => {
    armedRef.current = true;
    setArmed(true);
    sessionRef.current = createInternalSession(Date.now());
    setDiagnostic('armed — passive_listening');
    syncUi();

    if (!uiSyncRef.current) {
      uiSyncRef.current = setInterval(syncUi, SESSION_UI_SYNC_MS);
    }
  }, [setDiagnostic, syncUi]);

  const disarm = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
    clearSilenceWatch();
    clearFinalizedTimer();
    isFinalizingRef.current = false;
    isStartingCaptureRef.current = false;
    sessionRef.current = null;
    setDiagnostic('disarmed');
    setCurrentSession(null);
    syncUi();
  }, [clearFinalizedTimer, clearSilenceWatch, setDiagnostic, syncUi]);

  const resetCurrentSession = useCallback(() => {
    if (!armedRef.current) return;
    sessionRef.current = createInternalSession(Date.now());
    setDiagnostic('session reset');
    syncUi();
  }, [setDiagnostic, syncUi]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSilenceWatch();
      clearFinalizedTimer();
      if (uiSyncRef.current) {
        clearInterval(uiSyncRef.current);
        uiSyncRef.current = null;
      }
    };
  }, [clearFinalizedTimer, clearSilenceWatch]);

  return {
    armed,
    currentSession,
    completedSessionCount,
    lastDiagnostic,
    arm,
    disarm,
    handleVadTransition,
    ingestPartial,
    ingestFinalDelta,
    resetCurrentSession,
  };
}

/** Map conversation session state to orb capture (validation). */
export function conversationStateToOrbCapture(
  state: ConversationSessionState
): 'passive_listening' | 'speech_detected' | 'recording' | 'processing' | 'idle' {
  switch (state) {
    case 'passive_listening':
      return 'passive_listening';
    case 'speech_detected':
      return 'speech_detected';
    case 'capturing':
    case 'silence_pending':
      return 'recording';
    case 'finalizing':
    case 'finalized':
      return 'processing';
    default:
      return 'idle';
  }
}
