import { useState, useCallback, useRef } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { EchoMindSocket } from '../lib/socket';

export interface VoiceState {
  isRecording: boolean;
  sentences: string[];
  partialTranscript: string;
  audioLevel: number; // 0.0 to 1.0
  error: string | null;
}

// Ultra-fast thresholds
const PARTIAL_FLUSH_THRESHOLD_CHARS = 40;
const PARTIAL_SILENCE_TIMEOUT_MS = 800; 

export const useEchoMindVoice = () => {
  const [state, setState] = useState<VoiceState>({
    isRecording: false,
    sentences: [],
    partialTranscript: '',
    audioLevel: 0,
    error: null,
  });

  // Track what we've already sent to avoid duplicates
  const lastSentText = useRef<string>('');
  const partialFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendToBackend = useCallback((text: string) => {
    const trimmed = text.trim();
    // Only send if it's meaningfully different/longer than what we just sent
    if (trimmed.length > 5 && trimmed !== lastSentText.current && !lastSentText.current.startsWith(trimmed)) {
      console.log(`[Voice] Ultra-Fast Trigger: "${trimmed.substring(0, 40)}..."`);
      EchoMindSocket.getInstance().streamTranscript(trimmed);
      lastSentText.current = trimmed;
    }
  }, []);

  const resetPartialTimer = useCallback(() => {
    if (partialFlushTimer.current) clearTimeout(partialFlushTimer.current);
  }, []);

  // --- expo-speech-recognition event hooks ---

  useSpeechRecognitionEvent('start', () => {
    lastSentText.current = '';
    setState(s => ({ ...s, isRecording: true, error: null, sentences: [] }));
  });

  useSpeechRecognitionEvent('end', () => {
    resetPartialTimer();
    setState(s => ({ ...s, isRecording: false, partialTranscript: '' }));
  });

  useSpeechRecognitionEvent('result', (event) => {
    const result = event.results[0];
    if (!result) return;

    if (result.isFinal) {
      resetPartialTimer();
      const text = result.transcript.trim();
      if (text.length > 0) {
        setState(s => ({
          ...s,
          sentences: [...s.sentences, text],
          partialTranscript: '',
        }));
        
        // Final results are always sent unless they are a perfect subset of a just-sent partial
        sendToBackend(text);
      }
    } else {
      const currentPartial = result.transcript;
      setState(s => ({ ...s, partialTranscript: currentPartial }));

      // SMART PARTIAL TRIGGER:
      // If we have a decent chunk of text and the user pauses for 800ms, 
      // trigger analysis even before they officially finish the sentence.
      resetPartialTimer();
      if (currentPartial.length >= PARTIAL_FLUSH_THRESHOLD_CHARS) {
        partialFlushTimer.current = setTimeout(() => {
          sendToBackend(currentPartial);
        }, PARTIAL_SILENCE_TIMEOUT_MS);
      }
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.warn('[Voice] Error:', event.error, event.message);
    resetPartialTimer();
    setState(s => ({
      ...s,
      error: event.message || event.error || 'Speech recognition error',
      isRecording: false,
    }));
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    const normalized = Math.min(1, Math.max(0, ((event as any).value ?? 0 + 2) / 12));
    setState(s => ({ ...s, audioLevel: normalized }));
  });

  const startRecording = useCallback(async () => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      setState(s => ({
        ...s,
        error: 'Mic permission denied. Enable in Settings.',
      }));
      return;
    }

    try {
      lastSentText.current = '';
      setState(s => ({ ...s, error: null, sentences: [] }));
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
      });
    } catch (e: any) {
      setState(s => ({ ...s, error: `Failed to start: ${e.message}` }));
    }
  }, []);

  const stopRecording = useCallback(() => {
    resetPartialTimer();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e: any) {
      setState(s => ({ ...s, error: e.message }));
    }
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
  };
};

export default useEchoMindVoice;
