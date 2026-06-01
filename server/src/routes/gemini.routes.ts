import { GoogleGenAI } from '@google/genai';
import { Router } from 'express';
import { env } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';
import { extractMemory } from '../ai/gemini.service.js';

const router = Router();
const GEMINI_TIMEOUT_MS = 18_000;

function getClient() {
  if (!env.GOOGLE_API_KEY) {
    throw new Error('Gemini API key is not configured');
  }
  return new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
}

function withTimeout<T>(promise: Promise<T>, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), GEMINI_TIMEOUT_MS);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function buildPrompt(body: any): string {
  const message = typeof body.message === 'string' ? body.message : '';
  const memoryContext = typeof body.memoryContext === 'string' ? body.memoryContext : '';

  if (Array.isArray(body.messages)) {
    return body.messages
      .map((entry: any) => {
        const role = typeof entry?.role === 'string' ? entry.role : 'user';
        const content = typeof entry?.content === 'string' ? entry.content : '';
        return `${role}: ${content}`;
      })
      .join('\n');
  }

  return memoryContext
    ? `Memory context:\n${memoryContext}\n\nUser: ${message}`
    : message;
}

router.post('/chat', async (req, res) => {
  const prompt = buildPrompt(req.body);

  if (!prompt.trim()) {
    res.status(400).json({ success: false, error: 'Message is required' });
    return;
  }

  try {
    const ai = getClient();

    if (req.body?.stream === true) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream = await withTimeout(
        (ai.models as any).generateContentStream({
          model: CONSTANTS.GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
        'Gemini timeout',
      );

      const deadline = Date.now() + GEMINI_TIMEOUT_MS;
      for await (const chunk of stream as AsyncIterable<any>) {
        if (Date.now() > deadline) {
          res.write(`data: ${JSON.stringify({ success: false, error: 'Gemini timeout' })}\n\n`);
          res.end();
          return;
        }

        const delta = typeof chunk?.text === 'string' ? chunk.text : '';
        if (delta) {
          res.write(`data: ${JSON.stringify({ success: true, delta })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ success: true, done: true })}\n\n`);
      res.end();
      return;
    }

    const response = await withTimeout(
      ai.models.generateContent({
        model: CONSTANTS.GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
      'Gemini timeout',
    );

    res.json({ success: true, response: response.text || '' });
  } catch (error: any) {
    const message = error?.message === 'Gemini timeout'
      ? 'Gemini timeout'
      : error?.message || 'Gemini request failed';
    const status = message === 'Gemini timeout' ? 504 : 500;

    res.status(status).json({ success: false, error: message });
  }
});

router.post('/memory/extract', async (req, res) => {
  const transcript = typeof req.body?.text === 'string'
    ? req.body.text
    : typeof req.body?.transcript === 'string'
      ? req.body.transcript
      : '';

  if (!transcript.trim()) {
    res.status(400).json({ success: false, error: 'Transcript is required' });
    return;
  }

  try {
    const extraction = await withTimeout(extractMemory(transcript), 'Gemini timeout');
    if (!extraction) {
      res.status(422).json({ success: false, error: 'Memory extraction failed' });
      return;
    }

    res.json({ success: true, data: extraction });
  } catch (error: any) {
    const message = error?.message === 'Gemini timeout'
      ? 'Gemini timeout'
      : error?.message || 'Memory extraction failed';
    const status = message === 'Gemini timeout' ? 504 : 500;

    res.status(status).json({ success: false, error: message });
  }
});

export default router;
