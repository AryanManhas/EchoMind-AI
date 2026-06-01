import { useCallback, useRef, useState, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { OrchestratorContext } from './useAIOrchestrator';

export type GeminiStreamState =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'timeout'
  | 'offline';

export type UseGeminiStreamReturn = {
  streamState: GeminiStreamState;
  partialResponse: string;
  finalResponse: string;
  error: string | null;
  diagnostics: {
    activeStreamId: string | null;
    retrySuppressedCount: number;
    lastStartedAt: number | null;
    lastCompletedAt: number | null;
    lastAbortReason: string | null;
    bufferedChars: number;
  };
  generateStream: (context: OrchestratorContext) => Promise<void>;
  cancelStream: () => void;
  resetStream: () => void;
};

// Ensure this is set in your environment
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

const TIMEOUT_FIRST_BYTE_MS = 15000;
const TIMEOUT_TOTAL_MS = 45000;
const THROTTLE_MS = 100;
const MAX_RESPONSE_CHARS = 4000;
const RETRY_COOLDOWN_MS = 2500;

function fallbackResponseFor(reason: string, localSynthesis?: string): string {
  if (localSynthesis) return localSynthesis;

  if (/timeout/i.test(reason)) {
    return 'I had to pause the live response, but your local memory and reminders are still safe.';
  }
  if (/offline|network|fetch/i.test(reason)) {
    return 'I am offline right now, so I will keep this local and use saved context until the connection returns.';
  }
  return 'I could not finish that response cleanly, but the conversation state is preserved.';
}

export function useGeminiStream(): UseGeminiStreamReturn {
  const [streamState, setStreamState] = useState<GeminiStreamState>('idle');
  const [partialResponse, setPartialResponse] = useState('');
  const [finalResponse, setFinalResponse] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Strict ownership lock
  const activeStreamRef = useRef<boolean>(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const timeoutReasonRef = useRef<'first_byte_timeout' | 'total_timeout' | null>(null);
  const lastStartAtRef = useRef<number | null>(null);
  const lastCompleteAtRef = useRef<number | null>(null);
  const retrySuppressedCountRef = useRef(0);
  const lastAbortReasonRef = useRef<string | null>(null);
  
  // Throttle render storms
  const lastUpdateRef = useRef<number>(0);
  const bufferedTextRef = useRef<string>('');
  
  // Timeout references
  const firstByteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadRef = useRef<string | null>(null);

  const clearTimeouts = useCallback(() => {
    if (firstByteTimeoutRef.current) clearTimeout(firstByteTimeoutRef.current);
    if (totalTimeoutRef.current) clearTimeout(totalTimeoutRef.current);
    firstByteTimeoutRef.current = null;
    totalTimeoutRef.current = null;
  }, []);

  const cancelStream = useCallback((reason = 'cancelled') => {
    if (abortControllerRef.current) {
      lastAbortReasonRef.current = reason;
      abortControllerRef.current.abort(reason);
      abortControllerRef.current = null;
    }
    clearTimeouts();
    if (activeStreamRef.current && mountedRef.current) {
      setStreamState('cancelled');
      activeStreamRef.current = false;
      setFinalResponse(bufferedTextRef.current);
    }
  }, [clearTimeouts]);

  const resetStream = useCallback(() => {
    cancelStream();
    setStreamState('idle');
    setPartialResponse('');
    setFinalResponse('');
    setError(null);
    bufferedTextRef.current = '';
    lastPayloadRef.current = null;
  }, [cancelStream]);

  // Clean up on unmount & AppState backgrounding
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState.match(/inactive|background/)) {
        if (activeStreamRef.current) {
          if (__DEV__) console.log('[GeminiStream] App backgrounded - cancelling active stream');
          cancelStream('backgrounded');
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      mountedRef.current = false;
      subscription.remove();
      cancelStream('unmounted');
    };
  }, [cancelStream]);

  const generateStream = useCallback(async (context: OrchestratorContext) => {
    const now = Date.now();
    if (lastStartAtRef.current && now - lastStartAtRef.current < RETRY_COOLDOWN_MS) {
      retrySuppressedCountRef.current += 1;
      return;
    }

    const payload = {
      system_instruction: {
        parts: [{ text: context.systemDirectives }]
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Contextual Recall:\n${context.contextualRecall || context.recentMemories}` },
            { text: `Reminders:\n${context.activeReminders}` },
            ...(context.proactiveContext ? [{ text: `Proactive Awareness:\n${context.proactiveContext}` }] : []),
            ...(context.semanticIntent ? [{ text: `Current Intent: ${context.semanticIntent.type} - ${context.semanticIntent.task}` }] : []),
            { text: `User Utterance:\n${context.currentUtterance}` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      }
    };

    const payloadString = JSON.stringify(payload);
    if (activeStreamRef.current) {
      if (lastPayloadRef.current === payloadString) {
        // Suppress exact duplicate request while already streaming it
        return;
      }
      // Abort any existing stream to prevent overlaps
      cancelStream('superseded');
    }
    lastPayloadRef.current = payloadString;

    if (!GEMINI_API_KEY) {
      setError('Missing EXPO_PUBLIC_GEMINI_API_KEY');
      setStreamState('failed');
      return;
    }

    // Optional: Add navigator.onLine check here if available in RN (e.g. NetInfo)
    
    activeStreamRef.current = true;
    lastStartAtRef.current = now;
    activeStreamIdRef.current = `gemini-${now.toString(36)}`;
    setStreamState('preparing');
    setPartialResponse('');
    setFinalResponse('');
    setError(null);
    bufferedTextRef.current = '';
    
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    const streamId = activeStreamIdRef.current;


    try {
      firstByteTimeoutRef.current = setTimeout(() => {
        timeoutReasonRef.current = 'first_byte_timeout';
        if (abortControllerRef.current) abortControllerRef.current.abort('first_byte_timeout');
      }, TIMEOUT_FIRST_BYTE_MS);

      totalTimeoutRef.current = setTimeout(() => {
        timeoutReasonRef.current = 'total_timeout';
        if (abortControllerRef.current) abortControllerRef.current.abort('total_timeout');
      }, TIMEOUT_TOTAL_MS);

      const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Clear first byte timeout once we get headers
      if (firstByteTimeoutRef.current) clearTimeout(firstByteTimeoutRef.current);

      if (!response.body) {
        throw new Error('No response body');
      }

      setStreamState('streaming');

      // Manual chunk parsing for RN fetch stream
      const reader = (response.body as any).getReader
        ? (response.body as any).getReader() // Web environment
        : null;

      if (!reader) {
        // Fallback for strict RN if ReadableStream is not exposed properly.
        // We will just read the full text if streaming fails to polyfill.
        const fullText = await response.text();
        // Naive fallback: parse the final block
        const chunks = fullText.split('\n\n');
        for (const chunk of chunks) {
          if (chunk.startsWith('data: ')) {
            try {
              const data = JSON.parse(chunk.slice(6));
              const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              bufferedTextRef.current = (bufferedTextRef.current + textChunk).slice(0, MAX_RESPONSE_CHARS);
            } catch (e) {
              // ignore parse errors
            }
          }
        }
        if (mountedRef.current && activeStreamIdRef.current === streamId) {
          setFinalResponse(bufferedTextRef.current);
          setPartialResponse(bufferedTextRef.current);
          setStreamState('completed');
          lastCompleteAtRef.current = Date.now();
        }
        activeStreamRef.current = false;
        clearTimeouts();
        return;
      }

      // Web / Polyfilled ReadableStream approach
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (activeStreamIdRef.current !== streamId || signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (textChunk) {
                bufferedTextRef.current = (bufferedTextRef.current + textChunk).slice(0, MAX_RESPONSE_CHARS);
                
                // Throttle UI updates
                const now = Date.now();
                if (mountedRef.current && activeStreamIdRef.current === streamId && now - lastUpdateRef.current > THROTTLE_MS) {
                  setPartialResponse(bufferedTextRef.current);
                  lastUpdateRef.current = now;
                }
              }
            } catch (e) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }

      // Flush remaining
      if (mountedRef.current && activeStreamIdRef.current === streamId) {
        setPartialResponse(bufferedTextRef.current);
        setFinalResponse(bufferedTextRef.current);
        setStreamState('completed');
        lastCompleteAtRef.current = Date.now();
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (activeStreamIdRef.current !== streamId) return;
      if (err.name === 'AbortError' || timeoutReasonRef.current) {
        const reason = timeoutReasonRef.current;
        const isTimeout = !!reason;
        setStreamState(isTimeout ? 'timeout' : 'cancelled');
        const message = isTimeout ? `Stream timed out: ${reason}` : 'Stream cancelled';
        setError(message);
        if (isTimeout) setFinalResponse(prev => prev || context.localSynthesis || fallbackResponseFor(message, context.localSynthesis));
      } else {
        const message = err.message || 'Unknown stream error';
        setStreamState(/network|offline|fetch/i.test(message) ? 'offline' : 'failed');
        setError(message);
        setFinalResponse(prev => prev || context.localSynthesis || fallbackResponseFor(message, context.localSynthesis));
      }
    } finally {
      if (activeStreamIdRef.current === streamId) {
        activeStreamRef.current = false;
        timeoutReasonRef.current = null;
        activeStreamIdRef.current = null;
        clearTimeouts();
        abortControllerRef.current = null;
      }
    }
  }, [cancelStream, clearTimeouts]);

  return {
    streamState,
    partialResponse,
    finalResponse,
    error,
    diagnostics: {
      activeStreamId: activeStreamIdRef.current,
      retrySuppressedCount: retrySuppressedCountRef.current,
      lastStartedAt: lastStartAtRef.current,
      lastCompletedAt: lastCompleteAtRef.current,
      lastAbortReason: lastAbortReasonRef.current,
      bufferedChars: bufferedTextRef.current.length,
    },
    generateStream,
    cancelStream,
    resetStream,
  };
}
