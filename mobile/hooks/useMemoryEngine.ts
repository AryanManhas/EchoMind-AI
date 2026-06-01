import { useState, useCallback, useRef, useEffect } from 'react';
import { Vibration } from 'react-native';
import { EchoMindSocket } from '../lib/socket';
import { TransportManager } from '../lib/transport';
import ENV from '../lib/env';
import {
  getVoiceSettings,
  isPassiveListeningAllowed,
} from '../lib/voiceSettings';
import { type MobileLanguage } from '../lib/languageDetection';
import { type SharedValue } from 'react-native-reanimated';
import type { VoiceCaptureState, CaptureMode, VoiceState } from './useEchoMindVoice';
import { useConversationChunking } from './useConversationChunking';
import { useConversationIntelligence } from './useConversationIntelligence';
import {
  buildDisplayTranscript,
  reconcileTranscriptSegment,
} from '../lib/transcriptReconciliation';
import { findActivationPhrase } from './useTranscriptActivation';

const SAVED_DISPLAY_DURATION_MS = 2500;
const AUTO_RESTART_DELAY_MS = 500;
const SPEECH_DEBOUNCE_MS = 300;
const MAX_VISIBLE_SENTENCES = 12;
const MAX_COMMITTED_TRANSCRIPT_SEGMENTS = 24;
const MAX_COMMITTED_TRANSCRIPT_CHARS = 1800;
const TRANSCRIPT_UI_THROTTLE_MS = 120;

function getAdaptiveSilenceTimeout(text: string, baseTimeoutMs: number): number {
  const cleanText = text.trim().toLowerCase();
  if (!cleanText) return baseTimeoutMs;

  // 1. Check if ends with punctuation indicating pause
  const endsWithPausePunctuation = /[,:\-–—]$|\.\.\.$/.test(cleanText);

  // 2. Check if ends with a conjunction
  const conjunctions = [
    'and', 'or', 'but', 'so', 'because', 'then', 'if', 'although', 
    'while', 'unless', 'since', 'for', 'yet', 'nor', 'with', 'about', 'like'
  ];
  const words = cleanText.split(/\s+/);
  const lastWord = words[words.length - 1];
  const endsWithConjunction = conjunctions.includes(lastWord);

  // 3. Check if it's very short (under 3 words), give a slightly longer tolerance
  const isVeryShort = words.length < 3;

  if (endsWithConjunction || endsWithPausePunctuation) {
    // Add continuation grace period (1.5 seconds)
    return baseTimeoutMs + 1500;
  } else if (isVeryShort) {
    // Slight grace period for short utterances (500ms)
    return baseTimeoutMs + 500;
  }

  return baseTimeoutMs;
}

export interface UseMemoryEngineProps {
  audioLevel: SharedValue<number>;
  audioLevelRef: React.MutableRefObject<number>;
  setAudioLevel: (level: number) => void;
  startSTTRef: React.MutableRefObject<() => Promise<boolean>>;
  stopSTTRef: React.MutableRefObject<() => void>;
  startMeetingRecording: () => Promise<boolean>;
  stopMeetingRecording: () => Promise<string | null>;
}

export function useMemoryEngine({
  audioLevel,
  audioLevelRef,
  setAudioLevel,
  startSTTRef,
  stopSTTRef,
  startMeetingRecording: startMeetingRecordingProp,
  stopMeetingRecording: stopMeetingRecordingProp,
}: UseMemoryEngineProps) {
  const [state, setState] = useState<VoiceState>({
    captureState: 'idle',
    captureMode: null,
    sentences: [],
    partialTranscript: '',
    activePartialTranscript: '',
    committedTranscriptSegments: [],
    rollingTranscript: '',
    conversationChunks: [],
    conversationIntelligence: [],
    topicGroups: [],
    chunkDiagnostics: null,
    error: null,
    sessionCount: 0,
    detectedLanguage: 'en',
    sttLocale: 'en-US',
    isUploading: false,
    sessionId: '',
  });

  const lastActiveAtRef = useRef<number>(Date.now());

  // Timers owned solely by useMemoryEngine
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRestartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRecoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRenderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const isSpeechActiveRef = useRef(false);
  const captureStateRef = useRef<VoiceCaptureState>('idle');
  const captureModeRef = useRef<CaptureMode | null>(null);
  const committedTranscriptSegmentsRef = useRef<string[]>([]);
  const activePartialTranscriptRef = useRef('');
  const lastTranscriptRenderAtRef = useRef(0);
  const chunking = useConversationChunking({
    windowMs: 3 * 60 * 1000,
    silenceBoundaryMs: getVoiceSettings().silenceTimeoutMs,
    maxLiveTranscriptChars: 1800,
    maxRollingSegments: 24,
    maxChunkTranscriptChars: 3600,
    maxRetainedChunks: 40,
  });
  const {
    resetChunks,
    markSilenceBoundary,
    finalizeOpenChunk,
    ingestFinalTranscript,
  } = chunking;
  const intelligence = useConversationIntelligence(chunking.chunkHistory);

  // Sync refs with state
  useEffect(() => {
    captureStateRef.current = state.captureState;
    captureModeRef.current = state.captureMode;
  }, [state.captureState, state.captureMode]);

  const vibrate = useCallback((pattern: number | number[] = 30) => {
    const settings = getVoiceSettings();
    if (settings.vibrationFeedback) {
      Vibration.vibrate(pattern);
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (speechDebounceTimer.current) clearTimeout(speechDebounceTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    if (autoRestartTimer.current) clearTimeout(autoRestartTimer.current);
    if (errorRecoveryTimer.current) clearTimeout(errorRecoveryTimer.current);
    if (transcriptRenderTimer.current) clearTimeout(transcriptRenderTimer.current);
    silenceTimer.current = null;
    speechDebounceTimer.current = null;
    savedTimer.current = null;
    autoRestartTimer.current = null;
    errorRecoveryTimer.current = null;
    transcriptRenderTimer.current = null;
  }, []);

  const transcriptOptions = {
    maxSegments: MAX_COMMITTED_TRANSCRIPT_SEGMENTS,
    maxChars: MAX_COMMITTED_TRANSCRIPT_CHARS,
  };

  const getTranscriptStatePatch = useCallback(() => ({
    activePartialTranscript: activePartialTranscriptRef.current,
    committedTranscriptSegments: committedTranscriptSegmentsRef.current,
    partialTranscript: buildDisplayTranscript(
      committedTranscriptSegmentsRef.current,
      activePartialTranscriptRef.current,
      transcriptOptions
    ),
  }), []);

  const emitTranscriptState = useCallback((force = false) => {
    const flush = () => {
      transcriptRenderTimer.current = null;
      lastTranscriptRenderAtRef.current = Date.now();
      setState(s => ({ ...s, ...getTranscriptStatePatch() }));
    };

    if (force) {
      if (transcriptRenderTimer.current) clearTimeout(transcriptRenderTimer.current);
      flush();
      return;
    }

    const elapsed = Date.now() - lastTranscriptRenderAtRef.current;
    if (elapsed >= TRANSCRIPT_UI_THROTTLE_MS) {
      flush();
      return;
    }

    if (!transcriptRenderTimer.current) {
      transcriptRenderTimer.current = setTimeout(flush, TRANSCRIPT_UI_THROTTLE_MS - elapsed);
    }
  }, [getTranscriptStatePatch]);

  const resetTranscriptReconciliation = useCallback(() => {
    committedTranscriptSegmentsRef.current = [];
    activePartialTranscriptRef.current = '';
    emitTranscriptState(true);
  }, [emitTranscriptState]);

  const reconcileCommittedTranscript = useCallback((text: string) => {
    const result = reconcileTranscriptSegment(
      committedTranscriptSegmentsRef.current,
      text,
      transcriptOptions
    );
    committedTranscriptSegmentsRef.current = result.segments;
    activePartialTranscriptRef.current = '';
    emitTranscriptState(true);
    return result;
  }, [emitTranscriptState]);

  const commitActivePartialTranscript = useCallback(() => {
    const partial = activePartialTranscriptRef.current.trim();
    if (!partial) {
      emitTranscriptState(true);
      return null;
    }
    return reconcileCommittedTranscript(partial);
  }, [emitTranscriptState, reconcileCommittedTranscript]);

  // Sync setters to pass to useTranscriptSync
  const setCaptureState = useCallback((captureState: VoiceCaptureState) => {
    setState(s => ({ ...s, captureState }));
  }, []);

  const setCaptureMode = useCallback((captureMode: CaptureMode | null) => {
    setState(s => ({ ...s, captureMode }));
  }, []);

  const setSentences = useCallback((sentences: React.SetStateAction<string[]>) => {
    setState(s => ({
      ...s,
      sentences: typeof sentences === 'function' ? sentences(s.sentences) : sentences,
    }));
  }, []);

  const setPartialTranscript = useCallback((partialTranscript: string) => {
    activePartialTranscriptRef.current = partialTranscript;
    emitTranscriptState();
  }, [emitTranscriptState]);

  const setError = useCallback((error: string | null) => {
    setState(s => ({ ...s, error }));
  }, []);

  const setSttLocale = useCallback((sttLocale: string) => {
    setState(s => ({ ...s, sttLocale }));
  }, []);

  const setDetectedLanguage = useCallback((detectedLanguage: MobileLanguage) => {
    setState(s => ({ ...s, detectedLanguage }));
  }, []);

  // ─── WebSocket Event Handling ─────────────────────────────────────────────
  useEffect(() => {
    const socket = EchoMindSocket.getInstance();

    const onMemorySaved = (data: any) => {
      lastActiveAtRef.current = Date.now();
      setState(s => ({
        ...s,
        captureState: 'saved',
        sessionCount: s.sessionCount + 1,
        detectedLanguage: data?.data?.language || s.detectedLanguage,
      }));
      vibrate([0, 50, 100, 50]);

      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        const mode = captureModeRef.current;
        if (mode === 'auto' || mode === 'manual_passive') {
          resetTranscriptReconciliation();
          setState(s => ({ ...s, captureState: 'passive_listening', sentences: [], ...getTranscriptStatePatch() }));
          // Do not reset chunks immediately to allow follow-up session continuation
          startSTTRef.current().catch(() => {});
        } else {
          resetTranscriptReconciliation();
          setState(s => ({ ...s, captureState: 'idle', captureMode: null }));
          // Do not reset chunks immediately to allow follow-up session continuation
        }
      }, SAVED_DISPLAY_DURATION_MS);
    };

    const onQueryResult = () => {
      setState(s => ({ ...s, captureState: 'idle' }));
    };

    const onError = (data: any) => {
      setState(s => ({
        ...s,
        captureState: 'error',
        error: data?.message || 'Backend processing error',
      }));
    };

    socket.on('MEMORY_SAVED', onMemorySaved);
    socket.on('QUERY_RESULT', onQueryResult);
    socket.on('ERROR', onError);

    return () => {
      socket.off('MEMORY_SAVED', onMemorySaved);
      socket.off('QUERY_RESULT', onQueryResult);
      socket.off('ERROR', onError);
    };
  }, [getTranscriptStatePatch, resetChunks, resetTranscriptReconciliation, vibrate, startSTTRef]);

  // ─── Audio Upload ─────────────────────────────────────────────────────────
  const uploadAudio = useCallback(async (uri: string) => {
    setState(s => ({ ...s, isUploading: true, captureState: 'processing' }));
    
    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'recording.m4a';
      
      // @ts-ignore
      formData.append('audio', {
        uri,
        name: filename,
        type: 'audio/m4a',
      });
      
      formData.append('title', `Meeting ${new Date().toLocaleString()}`);
      formData.append('sourceType', 'meeting');

      const token = EchoMindSocket.getInstance().getAuthToken();
      const apiUrl = TransportManager.getApiUrl() || ENV.API_URL;

      const response = await fetch(`${apiUrl}/api/memories/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      if (__DEV__) console.log('Upload success:', result);
      
      setState(s => ({
        ...s,
        isUploading: false,
        captureState: 'saved',
        sessionCount: s.sessionCount + 1,
      }));

      vibrate([0, 50, 100, 50]);

      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        setState(s => ({ ...s, captureState: 'idle', captureMode: null }));
      }, SAVED_DISPLAY_DURATION_MS);

    } catch (error: any) {
      if (__DEV__) console.error('Upload error:', error);
      setState(s => ({
        ...s,
        isUploading: false,
        captureState: 'error',
        error: error.message || 'Failed to upload recording',
      }));
    }
  }, [vibrate]);

  // ─── STT Event Callback Handlers ──────────────────────────────────────────
  const handleSTTStart = useCallback(() => {
    const mode = captureModeRef.current;
    
    // Check if the session has timed out (10 minutes)
    const timeSinceLastActive = Date.now() - lastActiveAtRef.current;
    if (timeSinceLastActive > 10 * 60 * 1000) {
      resetChunks();
    }
    lastActiveAtRef.current = Date.now();

    resetTranscriptReconciliation();
    if (mode === 'manual_instant') {
      setState(s => ({
        ...s,
        captureState: 'recording',
        error: null,
        sentences: [],
        ...getTranscriptStatePatch(),
      }));
      vibrate(50);
    } else if (mode === 'auto' || mode === 'manual_passive' || mode === 'activation_window') {
      setState(s => ({
        ...s,
        captureState: 'passive_listening',
        error: null,
        sentences: [],
        ...getTranscriptStatePatch(),
      }));
    }
  }, [getTranscriptStatePatch, resetTranscriptReconciliation, vibrate, resetChunks]);

  const handleSTTEnd = useCallback((fullText: string | null) => {
    const currentState = captureStateRef.current;
    const mode = captureModeRef.current;

    if (currentState === 'recording' || currentState === 'speech_detected') {
      if (fullText && mode !== 'activation_window') {
        finalizeOpenChunk('capture_end');
        activePartialTranscriptRef.current = '';
        
        // Auto-restart STT if it ended unexpectedly (e.g. OS limits) and we're in an auto mode
        if (mode === 'auto' || mode === 'manual_passive') {
          if (autoRestartTimer.current) clearTimeout(autoRestartTimer.current);
          autoRestartTimer.current = setTimeout(() => {
            if (captureModeRef.current) {
              startSTTRef.current().catch(() => {});
            }
          }, 300); // Quick restart
          
          setState(s => ({
            ...s,
            captureState: 'passive_listening',
            ...getTranscriptStatePatch(),
          }));
        } else {
          setState(s => ({
            ...s,
            captureState: 'idle',
            captureMode: null,
            ...getTranscriptStatePatch(),
          }));
        }
        if (mode === 'auto' || mode === 'manual_passive') {
          if (autoRestartTimer.current) clearTimeout(autoRestartTimer.current);
          markSilenceBoundary();
          autoRestartTimer.current = setTimeout(() => {
            if (captureModeRef.current) {
              startSTTRef.current().catch(() => {});
            }
          }, AUTO_RESTART_DELAY_MS);
        } else {
          resetTranscriptReconciliation();
          setState(s => ({ ...s, captureState: 'idle', captureMode: null, ...getTranscriptStatePatch() }));
        }
      }
    } else {
      activePartialTranscriptRef.current = '';
      setState(s => ({ ...s, captureState: 'idle', ...getTranscriptStatePatch() }));
      finalizeOpenChunk('capture_end');
    }
    isSpeechActiveRef.current = false;
  }, [finalizeOpenChunk, getTranscriptStatePatch, markSilenceBoundary, vibrate, startSTTRef]);

  const handleSTTResult = useCallback((text: string, isFinal: boolean) => {
    lastActiveAtRef.current = Date.now();
    const currentState = captureStateRef.current;
    const mode = captureModeRef.current;
    const settings = getVoiceSettings();

    if (isFinal) {
      if (text.length > 0) {
        const previousSegments = committedTranscriptSegmentsRef.current;
        const previousLast = previousSegments[previousSegments.length - 1] || '';
        const reconciliation = reconcileCommittedTranscript(text);
        if (reconciliation.addedText && mode !== 'activation_window') {
          ingestFinalTranscript(reconciliation.addedText);
        }
        const latestCommitted = reconciliation.segments[reconciliation.segments.length - 1] || '';
        const shouldReplaceLatestSentence =
          !!previousLast &&
          reconciliation.segments.length === previousSegments.length &&
          latestCommitted !== previousLast;
        setState(s => ({
          ...s,
          captureState: mode === 'activation_window' ? 'passive_listening' : 'recording',
          sentences: reconciliation.changed
            ? [
                ...(shouldReplaceLatestSentence ? s.sentences.slice(0, -1) : s.sentences),
                latestCommitted,
              ].filter(Boolean).slice(-MAX_VISIBLE_SENTENCES)
            : s.sentences,
          ...getTranscriptStatePatch(),
        }));

        if (mode !== 'manual_instant') {
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          const baseTimeout = settings.silenceTimeoutMs;
          const adaptiveTimeout = getAdaptiveSilenceTimeout(text, baseTimeout);
          silenceTimer.current = setTimeout(() => {
            const committed = commitActivePartialTranscript();
            if (committed?.addedText && mode !== 'activation_window') {
              ingestFinalTranscript(committed.addedText);
            }
            if (mode !== 'activation_window') {
              finalizeOpenChunk('silence_boundary');
            }
            // Continuous Duplex: Do not stop STT on silence boundary
            // stopSTTRef.current();
          }, adaptiveTimeout);
        }
      }
    } else {
      const currentPartial = text;
      activePartialTranscriptRef.current = currentPartial;
      emitTranscriptState();
      
      if (
        (currentState === 'passive_listening' || currentState === 'speech_detected') &&
        currentPartial.trim().length > 0
      ) {
        if (!isSpeechActiveRef.current) {
          isSpeechActiveRef.current = true;
          if (speechDebounceTimer.current) clearTimeout(speechDebounceTimer.current);
          speechDebounceTimer.current = setTimeout(() => {
            setState(s => ({ ...s, captureState: mode === 'activation_window' ? 'passive_listening' : 'recording' }));
            vibrate(40);
          }, SPEECH_DEBOUNCE_MS);

          setState(s => ({ ...s, captureState: 'speech_detected' }));
        }
      }

      if (mode !== 'manual_instant') {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        const baseTimeout = settings.silenceTimeoutMs;
        const adaptiveTimeout = getAdaptiveSilenceTimeout(currentPartial, baseTimeout);
        silenceTimer.current = setTimeout(() => {
          const previousSegments = committedTranscriptSegmentsRef.current;
          const previousLast = previousSegments[previousSegments.length - 1] || '';
          const committed = commitActivePartialTranscript();
          if (committed?.addedText && mode !== 'activation_window') {
            ingestFinalTranscript(committed.addedText);
            const latestCommitted = committed.segments[committed.segments.length - 1] || '';
            const shouldReplaceLatestSentence =
              !!previousLast &&
              committed.segments.length === previousSegments.length &&
              latestCommitted !== previousLast;
            setState(s => ({
              ...s,
              sentences: [
                ...(shouldReplaceLatestSentence ? s.sentences.slice(0, -1) : s.sentences),
                latestCommitted,
              ].filter(Boolean).slice(-MAX_VISIBLE_SENTENCES),
              ...getTranscriptStatePatch(),
            }));
          }
          if (mode !== 'activation_window') {
            finalizeOpenChunk('silence_boundary');
          }
          // Continuous Duplex: Do not stop STT on silence boundary
          // stopSTTRef.current();
        }, adaptiveTimeout);
      }
    }
  }, [
    commitActivePartialTranscript,
    emitTranscriptState,
    finalizeOpenChunk,
    getTranscriptStatePatch,
    ingestFinalTranscript,
    reconcileCommittedTranscript,
    vibrate,
    stopSTTRef,
  ]);

  const handleSTTError = useCallback((errorMsg: string, code: string) => {
    clearAllTimers();
    const mode = captureModeRef.current;

    if (
      code === 'no-speech' &&
      (mode === 'auto' || mode === 'manual_passive')
    ) {
      if (autoRestartTimer.current) clearTimeout(autoRestartTimer.current);
      autoRestartTimer.current = setTimeout(() => {
        if (captureModeRef.current) {
          startSTTRef.current().catch(() => {});
        }
      }, AUTO_RESTART_DELAY_MS);
      return;
    }

    setState(s => ({
      ...s,
      captureState: 'error',
      error: errorMsg,
    }));

    if (errorRecoveryTimer.current) clearTimeout(errorRecoveryTimer.current);
    errorRecoveryTimer.current = setTimeout(() => {
      setState(s => {
        if (s.captureState === 'error') {
          return { ...s, captureState: 'idle', captureMode: null, error: null };
        }
        return s;
      });
    }, 3000);
  }, [clearAllTimers, startSTTRef]);

  // ─── Mode Actions ──────────────────────────────────────────────────────────
  const enableAutoMode = useCallback(async () => {
    if (!isPassiveListeningAllowed()) {
      setState(s => ({
        ...s,
        captureState: 'consent_required',
        error: 'Passive listening requires your consent. Enable in Settings.',
      }));
      return;
    }

    clearAllTimers();
    resetTranscriptReconciliation();
    captureModeRef.current = 'auto';
    captureStateRef.current = 'passive_listening';
    setState(s => ({
      ...s,
      captureMode: 'auto',
      captureState: 'passive_listening',
      error: null,
      sentences: [],
      ...getTranscriptStatePatch(),
    }));
    resetChunks();
    vibrate(30);
    await startSTTRef.current();
  }, [clearAllTimers, getTranscriptStatePatch, resetChunks, resetTranscriptReconciliation, startSTTRef, vibrate]);

  const togglePassiveMode = useCallback(async () => {
    if (captureModeRef.current === 'manual_passive') {
      clearAllTimers();
      stopSTTRef.current();
      resetTranscriptReconciliation();
      captureModeRef.current = null;
      captureStateRef.current = 'idle';
      setState(s => ({
        ...s,
        captureMode: null,
        captureState: 'idle',
        sentences: [],
        ...getTranscriptStatePatch(),
      }));
      finalizeOpenChunk('manual_stop');
      vibrate(20);
      return;
    }

    clearAllTimers();
    resetTranscriptReconciliation();
    captureModeRef.current = 'manual_passive';
    captureStateRef.current = 'passive_listening';
    setState(s => ({
      ...s,
      captureMode: 'manual_passive',
      captureState: 'passive_listening',
      error: null,
      sentences: [],
      ...getTranscriptStatePatch(),
    }));
    resetChunks();
    vibrate(30);
    await startSTTRef.current();
  }, [clearAllTimers, finalizeOpenChunk, getTranscriptStatePatch, resetChunks, resetTranscriptReconciliation, startSTTRef, vibrate]);

  const startActivationWindow = useCallback(async () => {
    if (captureModeRef.current || captureStateRef.current !== 'idle') {
      return false;
    }

    clearAllTimers();
    resetTranscriptReconciliation();
    resetChunks();
    isSpeechActiveRef.current = false;
    captureModeRef.current = 'activation_window';
    captureStateRef.current = 'passive_listening';
    setState(s => ({
      ...s,
      captureMode: 'activation_window',
      captureState: 'passive_listening',
      error: null,
      sentences: [],
      ...getTranscriptStatePatch(),
    }));
    const started = await startSTTRef.current();
    if (!started) {
      captureModeRef.current = null;
      captureStateRef.current = 'idle';
      setState(s => ({
        ...s,
        captureMode: null,
        captureState: 'idle',
        ...getTranscriptStatePatch(),
      }));
    }
    return started;
  }, [clearAllTimers, getTranscriptStatePatch, resetChunks, resetTranscriptReconciliation, startSTTRef]);

  const promoteActivationWindow = useCallback(() => {
    if (captureModeRef.current !== 'activation_window') return false;
    clearAllTimers();
    resetTranscriptReconciliation();
    resetChunks();
    isSpeechActiveRef.current = true;
    captureModeRef.current = 'manual_passive';
    captureStateRef.current = 'recording';
    setState(s => ({
      ...s,
      captureMode: 'manual_passive',
      captureState: 'recording',
      error: null,
      sentences: [],
      ...getTranscriptStatePatch(),
    }));
    const settings = getVoiceSettings();
    silenceTimer.current = setTimeout(() => {
      const committed = commitActivePartialTranscript();
      if (committed?.addedText) {
        ingestFinalTranscript(committed.addedText);
      }
      finalizeOpenChunk('silence_boundary');
      stopSTTRef.current();
    }, settings.silenceTimeoutMs);
    vibrate([0, 30, 50, 30]);
    return true;
  }, [
    clearAllTimers,
    commitActivePartialTranscript,
    finalizeOpenChunk,
    getTranscriptStatePatch,
    ingestFinalTranscript,
    resetChunks,
    resetTranscriptReconciliation,
    stopSTTRef,
    vibrate,
  ]);

  const startInstantRecord = useCallback(async () => {
    clearAllTimers();
    resetTranscriptReconciliation();
    captureModeRef.current = 'manual_instant';
    captureStateRef.current = 'recording';
    setState(s => ({
      ...s,
      captureMode: 'manual_instant',
      captureState: 'recording',
      error: null,
      sentences: [],
      ...getTranscriptStatePatch(),
    }));
    resetChunks();
    vibrate(50);
    await startSTTRef.current();
  }, [clearAllTimers, getTranscriptStatePatch, resetChunks, resetTranscriptReconciliation, startSTTRef, vibrate]);

  const stopInstantRecord = useCallback(() => {
    stopSTTRef.current();
    vibrate(30);
  }, [stopSTTRef, vibrate]);

  const startMeetingRecording = useCallback(async () => {
    try {
      const started = await startMeetingRecordingProp();
      if (!started) {
        setState(s => ({
          ...s,
          captureState: 'error',
          error: 'Microphone permission required for meeting recording',
        }));
        return;
      }

      clearAllTimers();
      
      setState(s => ({
        ...s,
        captureMode: 'meeting',
        captureState: 'recording',
        error: null,
      }));
      
      vibrate(50);
      if (__DEV__) console.log('Meeting recording started');
    } catch (err: any) {
      if (__DEV__) console.error('Failed to start meeting recording', err);
      setState(s => ({
        ...s,
        captureState: 'error',
        error: `Failed to start recording: ${err.message}`,
      }));
    }
  }, [clearAllTimers, startMeetingRecordingProp, vibrate]);

  const stopMeetingRecording = useCallback(async () => {
    try {
      vibrate(30);
      const uri = await stopMeetingRecordingProp();
      if (uri) {
        await uploadAudio(uri);
      } else {
        setState(s => ({ ...s, captureState: 'idle', captureMode: null }));
      }
    } catch (err: any) {
      if (__DEV__) console.error('Failed to stop meeting recording', err);
      setState(s => ({
        ...s,
        captureState: 'error',
        error: `Failed to stop recording: ${err.message}`,
      }));
    }
  }, [stopMeetingRecordingProp, uploadAudio, vibrate]);

  const disableCapture = useCallback(() => {
    clearAllTimers();
    stopSTTRef.current();
    isSpeechActiveRef.current = false;
    resetTranscriptReconciliation();
    captureModeRef.current = null;
    captureStateRef.current = 'idle';
    setState(s => ({
      ...s,
      captureMode: null,
      captureState: 'idle',
      sentences: [],
      ...getTranscriptStatePatch(),
      error: null,
    }));
    finalizeOpenChunk('disabled');
  }, [clearAllTimers, finalizeOpenChunk, getTranscriptStatePatch, resetTranscriptReconciliation, stopSTTRef]);

  const dismissError = useCallback(() => {
    setState(s => ({
      ...s,
      captureState: 'idle',
      captureMode: null,
      error: null,
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimers();
      if (captureStateRef.current !== 'idle') {
        stopSTTRef.current();
        isSpeechActiveRef.current = false;
      }
    };
  }, [clearAllTimers]);

  return {
    state: {
      ...state,
      sessionId: chunking.sessionId,
      rollingTranscript: chunking.rollingTranscript,
      conversationChunks: chunking.chunkHistory,
      conversationIntelligence: intelligence.intelligence,
      topicGroups: chunking.topicGroups,
      chunkDiagnostics: chunking.diagnostics,
    },
    vibrate,
    setCaptureState,
    setCaptureMode,
    setSentences,
    setPartialTranscript,
    setError,
    setSttLocale,
    setDetectedLanguage,
    
    // Callbacks to pass to useTranscriptSync
    handleSTTStart,
    handleSTTEnd,
    handleSTTResult,
    handleSTTError,
    
    // Mode Actions
    enableAutoMode,
    togglePassiveMode,
    startActivationWindow,
    promoteActivationWindow,
    startInstantRecord,
    stopInstantRecord,
    startMeetingRecording,
    stopMeetingRecording,
    disableCapture,
    dismissError,
  };
}

export default useMemoryEngine;
