import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

const DEFAULT_PHRASES = [
  'hey echomind',
  'echomind',
  'echo mind',
  'okay echomind',
  'hey mind',
  'okay mind',
  'echo mine',
  'heck of mind',
  'eko mind',
  'echo main',
  'echo my',
  'akomind',
  'ecomind',
  'akomine',
  'ekomine',
  'listen'
];
const DEFAULT_MAX_BUFFER_CHARS = 220;
const DEFAULT_COOLDOWN_MS = 4500;
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_SILENCE_RESET_MS = 2500;
const DEFAULT_MIN_TEXT_CHARS = 2;

export type TranscriptActivationStatus = 'idle' | 'listening' | 'voice_ready' | 'enhanced';

export type TranscriptActivationConfig = {
  phrases?: string[];
  maxBufferChars?: number;
  cooldownMs?: number;
  debounceMs?: number;
  silenceResetMs?: number;
  minTextChars?: number;
};

export type TranscriptActivationDiagnostics = {
  triggerCount: number;
  suppressedCount: number;
  bufferChars: number;
  lastPhrase: string | null;
  lastConfidence: number;
  appState: AppStateStatus;
};

export type UseTranscriptActivationOptions = {
  transcript: string;
  active: boolean;
  voiceReady: boolean;
  enhanced: boolean;
  config?: TranscriptActivationConfig;
  onActivate: (phrase: string) => void;
  onSilenceReset?: () => void;
};

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  return compact(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
}

function trimBuffer(text: string, maxChars: number): string {
  const clean = compact(text);
  if (clean.length <= maxChars) return clean;
  return compact(clean.slice(clean.length - maxChars));
}

export type ActivationResult = {
  phrase: string;
  confidence: number;
};

export function analyzeActivation(text: string, phrases: string[]): ActivationResult | null {
  const normalizedText = normalize(text).trim();
  if (!normalizedText) return null;

  // 1. Exact matches or direct sub-string matches of core phrases
  const highConfidencePhrases = ['hey echomind', 'okay echomind', 'ok echomind', 'echomind', 'echo mind'];
  for (const phrase of phrases) {
    const candidate = normalize(phrase).trim();
    if (!candidate || candidate.length < 2) continue;
    if (normalizedText === candidate || normalizedText.includes(candidate)) {
      const isHigh = highConfidencePhrases.includes(candidate);
      return {
        phrase,
        confidence: isHigh ? 1.0 : 0.8,
      };
    }
  }

  // 2. Broad fuzzy regex matching supporting phonetic variants of "echomind"
  const fuzzyRegex = /\b(hey|okay|ok|hi|hello|he)?\s*(echomind|echo\s*mind|echo\s*mine|heck\s*of\s*mind|eko\s*mind|echo\s*main|egg\s*mind|echo\s*my|akomind|ecomind|akomine|ekomine|mind|mine)\b/i;
  
  if (fuzzyRegex.test(normalizedText)) {
    const match = normalizedText.match(fuzzyRegex);
    if (match) {
      const prefix = match[1] ? match[1].toLowerCase() : '';
      const word = match[2].toLowerCase();
      
      // If we match just a generic single short word like "mind" or "mine" without a prefix,
      // prevent false positives unless it is a single-word utterance.
      const wordsCount = normalizedText.split(/\s+/).length;
      if ((word === 'mind' || word === 'mine') && !prefix) {
        if (wordsCount > 1) {
          return null;
        }
        // Single word "mind" or "mine" -> medium confidence
        return { phrase: 'hey echomind', confidence: 0.85 };
      }
      
      // Phonetic homophones with prefix: high confidence
      if (prefix && word !== 'mind' && word !== 'mine') {
        return { phrase: 'hey echomind', confidence: 0.95 };
      }
      
      // Phonetic homophones without prefix: very high confidence
      if (word !== 'mind' && word !== 'mine') {
        return { phrase: 'hey echomind', confidence: 0.95 };
      }

      // Prefix + "mind" / "mine": very high confidence
      return { phrase: 'hey echomind', confidence: 0.95 };
    }
  }

  return null;
}

export function findActivationPhrase(text: string, phrases: string[]): string | null {
  return analyzeActivation(text, phrases)?.phrase || null;
}

export function useTranscriptActivation({
  transcript,
  active,
  voiceReady,
  enhanced,
  config,
  onActivate,
  onSilenceReset,
}: UseTranscriptActivationOptions) {
  const options = useMemo(() => ({
    phrases: config?.phrases || DEFAULT_PHRASES,
    maxBufferChars: config?.maxBufferChars || DEFAULT_MAX_BUFFER_CHARS,
    cooldownMs: config?.cooldownMs || DEFAULT_COOLDOWN_MS,
    debounceMs: config?.debounceMs || DEFAULT_DEBOUNCE_MS,
    silenceResetMs: config?.silenceResetMs || DEFAULT_SILENCE_RESET_MS,
    minTextChars: config?.minTextChars || DEFAULT_MIN_TEXT_CHARS,
  }), [config]);

  const onActivateRef = useRef(onActivate);
  const onSilenceResetRef = useRef(onSilenceReset);
  const bufferRef = useRef('');
  const lastTranscriptRef = useRef('');
  const lastActivationAtRef = useRef(0);
  const firstCandidateAtRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerCountRef = useRef(0);
  const suppressedCountRef = useRef(0);
  const lastPhraseRef = useRef<string | null>(null);
  const lastConfidenceRef = useRef<number>(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [diagnosticRevision, setDiagnosticRevision] = useState(0);

  onActivateRef.current = onActivate;
  onSilenceResetRef.current = onSilenceReset;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = '';
    lastTranscriptRef.current = '';
    firstCandidateAtRef.current = 0;
    clearSilenceTimer();
    clearDebounceTimer();
    setDiagnosticRevision(value => value + 1);
  }, [clearDebounceTimer, clearSilenceTimer]);

  useEffect(() => {
    if (!active) {
      reset();
      return;
    }

    const cleanTranscript = compact(transcript);
    if (cleanTranscript.length < options.minTextChars) return;
    if (cleanTranscript === lastTranscriptRef.current) return;
    lastTranscriptRef.current = cleanTranscript;

    bufferRef.current = trimBuffer(`${bufferRef.current} ${cleanTranscript}`, options.maxBufferChars);
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      reset();
      onSilenceResetRef.current?.();
    }, options.silenceResetMs);

    const match = analyzeActivation(bufferRef.current, options.phrases);
    if (!match) {
      setDiagnosticRevision(value => value + 1);
      return;
    }

    const { phrase, confidence } = match;
    const now = Date.now();
    if (now - lastActivationAtRef.current < options.cooldownMs) {
      suppressedCountRef.current += 1;
      clearDebounceTimer();
      setDiagnosticRevision(value => value + 1);
      return;
    }

    lastConfidenceRef.current = confidence;

    // Immediate activation for highly-confident wake phrases (confidence >= 0.9) to feel responsive
    if (confidence >= 0.9) {
      lastActivationAtRef.current = now;
      firstCandidateAtRef.current = 0;
      clearDebounceTimer();
      triggerCountRef.current += 1;
      lastPhraseRef.current = phrase;
      bufferRef.current = '';
      setDiagnosticRevision(value => value + 1);
      onActivateRef.current(phrase);
      return;
    }

    if (firstCandidateAtRef.current === 0) {
      firstCandidateAtRef.current = now;
      clearDebounceTimer();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const confirmedMatch = analyzeActivation(bufferRef.current, options.phrases);
        if (!confirmedMatch || Date.now() - lastActivationAtRef.current < options.cooldownMs) {
          suppressedCountRef.current += 1;
          setDiagnosticRevision(value => value + 1);
          return;
        }
        lastActivationAtRef.current = Date.now();
        lastConfidenceRef.current = confirmedMatch.confidence;
        firstCandidateAtRef.current = 0;
        triggerCountRef.current += 1;
        lastPhraseRef.current = confirmedMatch.phrase;
        bufferRef.current = '';
        setDiagnosticRevision(value => value + 1);
        onActivateRef.current(confirmedMatch.phrase);
      }, options.debounceMs);
      setDiagnosticRevision(value => value + 1);
      return;
    }

    if (now - firstCandidateAtRef.current < options.debounceMs) {
      return;
    }

    lastActivationAtRef.current = now;
    firstCandidateAtRef.current = 0;
    clearDebounceTimer();
    triggerCountRef.current += 1;
    lastPhraseRef.current = phrase;
    bufferRef.current = '';
    setDiagnosticRevision(value => value + 1);
    onActivateRef.current(phrase);
  }, [active, clearSilenceTimer, options, reset, transcript]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      appStateRef.current = nextAppState;
      if (nextAppState !== 'active') {
        reset();
      }
    });
    return () => {
      subscription.remove();
      clearSilenceTimer();
      clearDebounceTimer();
    };
  }, [clearDebounceTimer, clearSilenceTimer, reset]);

  const status: TranscriptActivationStatus = enhanced
    ? 'enhanced'
    : voiceReady
      ? 'voice_ready'
      : active
        ? 'listening'
        : 'idle';

  return {
    status,
    reset,
    diagnostics: {
      triggerCount: triggerCountRef.current,
      suppressedCount: suppressedCountRef.current,
      bufferChars: bufferRef.current.length,
      lastPhrase: lastPhraseRef.current,
      lastConfidence: lastConfidenceRef.current,
      appState: appStateRef.current,
      revision: diagnosticRevision,
    } as TranscriptActivationDiagnostics & { revision: number },
  };
}

export default useTranscriptActivation;
