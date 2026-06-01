import { useCallback, useRef, useEffect } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { EchoMindSocket } from '../lib/socket';
import { detectLanguageForSTT, type MobileLanguage } from '../lib/languageDetection';
import { getSTTLocale, type LanguageMode, getVoiceSettings } from '../lib/voiceSettings';
import { CaptureMode, VoiceCaptureState } from './useEchoMindVoice';
import {
  reconcileTranscriptSegment,
} from '../lib/transcriptReconciliation';

const LANGUAGE_SWITCH_CHECK_INTERVAL = 3;
const MAX_SESSION_SENTENCES = 24;
const MAX_SESSION_TRANSCRIPT_CHARS = 1800;
const TRANSCRIPT_BUFFER_OPTIONS = {
  maxSegments: MAX_SESSION_SENTENCES,
  maxChars: MAX_SESSION_TRANSCRIPT_CHARS,
};

export interface UseTranscriptSyncProps {
  captureState: VoiceCaptureState;
  captureMode: CaptureMode | null;
  sttLocale: string;
  setSttLocale: (locale: string) => void;
  detectedLanguage: MobileLanguage;
  setDetectedLanguage: (lang: MobileLanguage) => void;
  setAudioLevel: (level: number) => void;
  setError: (error: string | null) => void;
  sessionId: string;
  
  // Callbacks to notify useMemoryEngine about STT events
  onSTTStart: () => void;
  onSTTEnd: (fullText: string | null) => void;
  onSTTResult: (text: string, isFinal: boolean) => void;
  onSTTError: (errorMsg: string, code: string) => void;
}

export function useTranscriptSync({
  captureState,
  captureMode,
  sttLocale,
  setSttLocale,
  detectedLanguage,
  setDetectedLanguage,
  setAudioLevel,
  setError,
  sessionId,
  onSTTStart,
  onSTTEnd,
  onSTTResult,
  onSTTError,
}: UseTranscriptSyncProps) {
  const sessionIdRef = useRef(sessionId);
  
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const lastSentText = useRef<string>('');
  const sessionSentences = useRef<string[]>([]);
  const activePartialTranscript = useRef('');
  const committedTranscriptSegments = useRef<string[]>([]);
  const wordCountSinceCheck = useRef<number>(0);
  const currentLocaleRef = useRef<string>(sttLocale);

  const isRefreshingRef = useRef<boolean>(false);
  const rollingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync currentLocaleRef when sttLocale changes from parent/engine
  useEffect(() => {
    currentLocaleRef.current = sttLocale;
  }, [sttLocale]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (rollingRefreshTimer.current) clearTimeout(rollingRefreshTimer.current);
    };
  }, []);

  const sendToBackend = useCallback((text: string) => {
    const trimmed = text.trim();
    if (
      trimmed.length > 5 &&
      trimmed !== lastSentText.current &&
      !lastSentText.current.startsWith(trimmed)
    ) {
      EchoMindSocket.getInstance().streamTranscript(trimmed, sessionIdRef.current);
      lastSentText.current = trimmed;
    }
  }, []);

  const pushSessionSentence = useCallback((text: string) => {
    const result = reconcileTranscriptSegment(
      committedTranscriptSegments.current,
      text,
      TRANSCRIPT_BUFFER_OPTIONS
    );
    committedTranscriptSegments.current = result.segments;
    sessionSentences.current = result.segments;
    activePartialTranscript.current = '';
    return result;
  }, []);

  const commitActivePartialTranscript = useCallback(() => {
    const partial = activePartialTranscript.current.trim();
    if (!partial) return null;
    return pushSessionSentence(partial);
  }, [pushSessionSentence]);

  const scheduleRollingRefresh = useCallback(() => {
    if (rollingRefreshTimer.current) clearTimeout(rollingRefreshTimer.current);
    rollingRefreshTimer.current = setTimeout(() => {
      const currentState = captureStateRef.current;
      if (
        (currentState === 'recording' || currentState === 'passive_listening' || currentState === 'speech_detected') &&
        activePartialTranscript.current.trim().length === 0
      ) {
        if (!(global as any).isPresentationMode) {
          console.log('[DEV] triggering rolling STT refresh to prevent OS timeouts');
        }
        isRefreshingRef.current = true;
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          isRefreshingRef.current = false;
        }
      } else if (currentState === 'recording' || currentState === 'passive_listening' || currentState === 'speech_detected') {
        scheduleRollingRefresh();
      }
    }, 70000); // Refresh every 70 seconds during idle speech windows
  }, []);

  const startSTT = useCallback(async (carryForward?: boolean): Promise<boolean> => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      setError('Microphone permission denied. Enable in Settings.');
      return false;
    }

    const settings = getVoiceSettings();
    const locale = settings.languageMode === 'auto'
      ? currentLocaleRef.current
      : getSTTLocale(settings.languageMode);

    try {
      if (!carryForward) {
        lastSentText.current = '';
        sessionSentences.current = [];
        committedTranscriptSegments.current = [];
        activePartialTranscript.current = '';
        wordCountSinceCheck.current = 0;
      }
      isRefreshingRef.current = false;

      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: true,
        continuous: true,
      });

      currentLocaleRef.current = locale;
      setSttLocale(locale);
      setDetectedLanguage(locale === 'hi-IN' ? 'hi' : 'en');

      // Schedule next rolling refresh
      scheduleRollingRefresh();

      return true;
    } catch (e: any) {
      setError(`Failed to start: ${e.message}`);
      return false;
    }
  }, [setError, setSttLocale, setDetectedLanguage, scheduleRollingRefresh]);

  const stopSTT = useCallback(() => {
    try {
      if (rollingRefreshTimer.current) clearTimeout(rollingRefreshTimer.current);
      rollingRefreshTimer.current = null;
      isRefreshingRef.current = false;
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped
    }
  }, []);

  const setLanguage = useCallback((mode: LanguageMode) => {
    const locale = getSTTLocale(mode);
    currentLocaleRef.current = locale;
    setSttLocale(locale);
    setDetectedLanguage(mode === 'hi' ? 'hi' : mode === 'auto' ? detectedLanguage : 'en');
  }, [detectedLanguage, setDetectedLanguage, setSttLocale]);

  // Keep references fresh for the event listeners to avoid stale closures
  const captureStateRef = useRef(captureState);
  const captureModeRef = useRef(captureMode);
  const onSTTStartRef = useRef(onSTTStart);
  const onSTTEndRef = useRef(onSTTEnd);
  const onSTTResultRef = useRef(onSTTResult);
  const onSTTErrorRef = useRef(onSTTError);

  useEffect(() => {
    captureStateRef.current = captureState;
    captureModeRef.current = captureMode;
    onSTTStartRef.current = onSTTStart;
    onSTTEndRef.current = onSTTEnd;
    onSTTResultRef.current = onSTTResult;
    onSTTErrorRef.current = onSTTError;
  }, [captureState, captureMode, onSTTStart, onSTTEnd, onSTTResult, onSTTError]);

  // Speech Recognition Events
  useSpeechRecognitionEvent('start', () => {
    onSTTStartRef.current();
  });

  useSpeechRecognitionEvent('end', () => {
    const currentState = captureStateRef.current;
    const currentMode = captureModeRef.current;
    commitActivePartialTranscript();
    
    if (isRefreshingRef.current) {
      isRefreshingRef.current = false;
      if (!(global as any).isPresentationMode) {
        console.log('[DEV] restarting STT for rolling refresh');
      }
      startSTT(true).catch(() => {});
      return;
    }

    let fullText: string | null = null;
    if (
      currentMode !== 'activation_window' &&
      (currentState === 'recording' || currentState === 'speech_detected')
    ) {
      const committedTranscript = committedTranscriptSegments.current.join(' ');
      if (committedTranscript.length > 0) {
        fullText = committedTranscript;
        sendToBackend(fullText);
      }
    }

    // Auto-recovery if ended unexpectedly (non-manual stop) while in active states
    if (
      (currentState === 'recording' || currentState === 'speech_detected' || currentState === 'passive_listening') &&
      currentMode && currentMode !== 'activation_window'
    ) {
      if (!(global as any).isPresentationMode) {
        console.log('[DEV] STT ended unexpectedly during active session, recovering recognizer');
      }
      startSTT(true).catch(() => {});
      return;
    }

    onSTTEndRef.current(fullText);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const result = event.results[0];
    if (!result) return;

    if (event.isFinal) {
      const text = result.transcript.trim();
      if (text.length > 0) {
        const reconciliation = pushSessionSentence(text);
        
        onSTTResultRef.current(text, true);

        // Language check
        const settings = getVoiceSettings();
        if (settings.languageMode === 'auto') {
          wordCountSinceCheck.current += Math.max(0, reconciliation.addedText.split(/\s+/).filter(Boolean).length);
          if (wordCountSinceCheck.current >= LANGUAGE_SWITCH_CHECK_INTERVAL) {
            const currentFullText = committedTranscriptSegments.current.join(' ');
            const { language, sttLocale: newLocale } = detectLanguageForSTT(currentFullText);
            if (newLocale !== currentLocaleRef.current) {
              currentLocaleRef.current = newLocale;
              setSttLocale(newLocale);
              setDetectedLanguage(language);
            }
            wordCountSinceCheck.current = 0;
          }
        }
      }
    } else {
      const currentPartial = result.transcript;
      activePartialTranscript.current = currentPartial;
      onSTTResultRef.current(currentPartial, false);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    onSTTErrorRef.current(event.message || event.error || 'Speech recognition error', event.error);
  });

  const lastVolumeUpdate = useRef<number>(0);

  useSpeechRecognitionEvent('volumechange', (event) => {
    const now = Date.now();
    const raw = (event as any).value ?? 0;
    const normalized = Math.min(1, Math.max(0, (raw + 2) / 12));
    
    // Throttle to 100ms (10fps) for smooth responsiveness without UI thread flooding
    if (normalized === 0 || now - lastVolumeUpdate.current >= 100) {
      setAudioLevel(normalized);
      lastVolumeUpdate.current = now;
    }
  });

  return {
    startSTT,
    stopSTT,
    setLanguage,
  };
}

export default useTranscriptSync;
