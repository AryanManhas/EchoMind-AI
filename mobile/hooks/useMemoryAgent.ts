import { useState, useCallback, useRef } from 'react';
import { MemoryAgentService } from '../services/memoryAgent.service';
import type { ConversationMemory } from './usePersistentMemory';

export type MemoryAgentState = 'idle' | 'searching' | 'thinking' | 'streaming' | 'completed' | 'error';

export function useMemoryAgent(memories: ConversationMemory[], reminders: any[]) {
  const [state, setState] = useState<MemoryAgentState>('idle');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState('idle');
    setResponse('');
    setError(null);
  }, []);

  const ask = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    reset();
    setState('searching');
    
    try {
      // 1. Local Semantic Retrieval
      const relevantContext = MemoryAgentService.retrieveContext(query, memories, reminders);
      
      // 2. Prepare Prompt
      const { systemInstruction, userPrompt } = MemoryAgentService.buildPrompt(query, relevantContext);
      
      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
      if (!apiKey || apiKey.trim() === '') {
        throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY in .env');
      }
      
      const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse&key=${apiKey.trim()}`;

      setState('thinking');
      abortControllerRef.current = new AbortController();
      
      const payload = {
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
      };

      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortControllerRef.current.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'No error text');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      setState('streaming');
      
      const reader = res.body && (res.body as any).getReader ? (res.body as any).getReader() : null;
      
      if (!reader) {
        // Fallback for strict React Native environments
        const fullText = await res.text();
        const matches = fullText.match(/^data:\s*(.*)$/gm);
        let fullResponse = '';
        
        if (matches) {
          for (const match of matches) {
            try {
              const dataStr = match.replace(/^data:\s*/, '');
              if (dataStr === '[DONE]') continue;
              const data = JSON.parse(dataStr);
              fullResponse += data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } catch (e) {
              console.warn('[MemoryAgent] Failed to parse chunk:', match);
            }
          }
        }
        
        if (!fullResponse.trim()) {
           console.warn('[MemoryAgent] Warning: Parsed fullResponse is empty! Full text was:', fullText);
        }
        setResponse(fullResponse);
        setState('completed');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (textChunk) {
                currentResponse += textChunk;
                setResponse(currentResponse);
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }
      
      setState('completed');

    } catch (err: any) {
      if (err.name === 'AbortError') return; // Cancelled intentionally
      console.error('[MemoryAgent]', err);
      setState('error');
      setError(err.message || 'Failed to retrieve response');
    } finally {
      abortControllerRef.current = null;
    }
  }, [memories, reminders, reset]);

  return { state, response, error, ask, reset };
}
