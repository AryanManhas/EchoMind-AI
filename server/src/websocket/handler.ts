import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { createLogger, withCorrelation } from '../utils/logger.js';
import { AuthService } from '../auth/auth.service.js';
import { extractMemory, answerQuery, extractCalendarEvent } from '../ai/gemini.service.js';
import { CalendarService } from '../services/calendar.service.js';
import { memoryService } from '../services/memory.service.js';
import { ReminderService } from '../reminders/reminder.service.js';
import { retrievalService } from '../retrieval/retrieval.service.js';
import { ReminderExtractionSchema } from '@echomind/types';
import { CONSTANTS } from '../config/constants.js';
import { detectLanguage, normalizeTranscript } from '../nlp/language.service.js';
import { isQueryIntent, extractEntities } from '../nlp/entity-extractor.js';
import { TranscriptSynchronizer } from '../streaming/transcript-sync.js';
import { enqueueEmbedding } from '../queues/embedding.queue.js';
import prisma from '../db/prisma.js';
import type {
  WSAuthMessage,
  WSTextTranscript,
  WSMemorySaved,
  WSError,
  WSStatusChange,
  AuthUser,
} from '@echomind/types';
import { randomUUID } from 'crypto';
import type { RankedMemory } from '../retrieval/ranking.engine.js';

const log = createLogger('websocket');

interface AuthenticatedSocket extends WebSocket {
  isAlive: boolean;
  user?: AuthUser;
  sessionId: string;
  transcriptSync: TranscriptSynchronizer;
  rateLimit: { count: number; windowStart: number };
}

const WS_RATE_LIMIT_WINDOW_MS = 1000;
const WS_RATE_LIMIT_MAX_MESSAGES = 50;

/**
 * Production WebSocket server with JWT authentication and bilingual support.
 *
 * Protocol:
 * 1. Client connects → must send AUTH message with JWT within 5 seconds
 * 2. Server validates token → sends AUTH_OK or AUTH_FAIL
 * 3. After auth, client can send:
 *    - TEXT_TRANSCRIPT: Raw text for memory extraction (voice or typed)
 *    - QUERY: Semantic search query (supports English + Hindi)
 *    - PING: Heartbeat
 * 4. Server processes and responds with:
 *    - MEMORY_SAVED: Memory extracted and stored
 *    - QUERY_RESULT: Semantic search results
 *    - STATUS_CHANGE: Pipeline status updates
 *    - ERROR: Error messages
 *
 * Bilingual Pipeline:
 * - Detects language (en / hi / hi-en)
 * - Routes to appropriate Gemini prompt
 * - NLP entity extraction (bilingual)
 * - Embedding generation (queued via BullMQ)
 */
export function setupWebSocket(wss: WebSocketServer) {
  // ─── Heartbeat ──────────────────────────────────────────────
  const interval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const client = ws as AuthenticatedSocket;
      if (!client.isAlive) {
        log.info({ sessionId: client.sessionId }, 'Client heartbeat timeout — terminating');
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, CONSTANTS.WS_HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(interval));

  // ─── Connection Handler ─────────────────────────────────────
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const client = ws as AuthenticatedSocket;
    client.isAlive = true;
    client.sessionId = randomUUID();
    client.transcriptSync = new TranscriptSynchronizer();
    client.rateLimit = { count: 0, windowStart: Date.now() };

    const connLog = withCorrelation(log, client.sessionId);

    // Retrieve user attached during HTTP upgrade handshake
    const user = (req as any).user as AuthUser | undefined;
    if (!user) {
      connLog.warn('Connection attempt without handshake authentication');
      sendMessage(client, { type: 'AUTH_FAIL', message: 'Unauthorized' });
      client.close(4001, 'Unauthorized');
      return;
    }

    client.user = user;
    connLog.info({ userId: user.userId }, 'Client connected — authenticated via handshake');

    // Immediately send AUTH_OK so client knows it is connected and authenticated
    sendMessage(client, { type: 'AUTH_OK' });

    client.on('pong', () => { client.isAlive = true; });

    // ─── Message Handler ──────────────────────────────────────
    client.on('message', async (raw: Buffer) => {
      // ── Rate Limiting ──
      const now = Date.now();
      if (now - client.rateLimit.windowStart > WS_RATE_LIMIT_WINDOW_MS) {
        client.rateLimit.count = 0;
        client.rateLimit.windowStart = now;
      }
      client.rateLimit.count++;
      
      if (client.rateLimit.count > WS_RATE_LIMIT_MAX_MESSAGES) {
        connLog.warn('WebSocket rate limit exceeded');
        sendMessage(client, { type: 'ERROR', message: 'Rate limit exceeded' });
        return;
      }

      let data: any;

      try {
        data = JSON.parse(raw.toString());
      } catch {
        // Not JSON — ignore (binary audio for future phases)
        return;
      }

      // ── Authentication Fallback / No-Op ──
      if (data.type === 'AUTH') {
        connLog.info('Received AUTH message on handshake-authenticated connection');
        sendMessage(client, { type: 'AUTH_OK' });
        return;
      }

      // ── Reject unauthenticated messages ──
      if (!client.user) {
        sendMessage(client, { type: 'AUTH_FAIL', message: 'Not authenticated' });
        return;
      }

      // ── Ping/Pong ──
      if (data.type === 'PING') {
        sendMessage(client, { type: 'PONG' });
        return;
      }

      // ── Text Transcript (bilingual) ──
      if (data.type === 'TEXT_TRANSCRIPT') {
        await handleTextTranscript(client, data as WSTextTranscript, connLog);
        return;
      }

      // ── Semantic Query (bilingual) ──
      if (data.type === 'QUERY') {
        await handleQuery(client, data, connLog);
        return;
      }

      connLog.warn({ type: data.type }, 'Unknown message type');
    });

    // ─── Disconnect ───────────────────────────────────────────
    client.on('close', async () => {

      // Flush any remaining partial transcript before cleanup
      if (client.user) {
        const flushed = client.transcriptSync.flush();
        if (flushed) {
          connLog.info({ textLength: flushed.length }, 'Flushing remaining partial on disconnect');
          // Process the flushed text asynchronously (best-effort)
          handleTextTranscript(
            client,
            { type: 'TEXT_TRANSCRIPT', text: flushed } as WSTextTranscript,
            connLog,
          ).catch(err => connLog.warn({ err }, 'Failed to process flushed partial'));
        }
      }

      client.transcriptSync.reset();
      connLog.info('Client disconnected');
    });

    client.on('error', (err) => {
      connLog.error({ err }, 'WebSocket error');
    });
  });

  return { interval };
}

// ─── Text Transcript Handler (Bilingual) ──────────────────────
async function handleTextTranscript(
  client: AuthenticatedSocket,
  msg: WSTextTranscript,
  connLog: ReturnType<typeof withCorrelation>,
) {
  const rawText = msg.text?.trim();
  if (!rawText || rawText.length < CONSTANTS.TRANSCRIPT_MIN_LENGTH) return;

  // Pass through transcript synchronizer to deduplicate streaming partials
  const isFinal = msg.isFinal !== false; // Default to final if not specified
  const syncedText = client.transcriptSync.process(rawText, isFinal);

  // Synchronizer returns null if this is a duplicate or non-finalized partial
  if (!syncedText) return;

  const text = normalizeTranscript(syncedText);
  const userId = client.user!.userId;
  const langResult = detectLanguage(text);

  connLog.info({
    textLength: text.length,
    language: langResult.language,
    confidence: langResult.confidence,
    codeSwitched: langResult.isCodeSwitched,
  }, 'Processing bilingual transcript');

  // Check if this is a query (semantic search) vs a memory to store
  if (isQueryIntent(text)) {
    connLog.info('Detected query intent — routing to search');
    await handleQuery(client, { text, language: langResult.language }, connLog);
    return;
  }

  // Status: analyzing
  sendMessage(client, {
    type: 'STATUS_CHANGE',
    status: 'analyzing',
    correlationId: msg.correlationId,
    language: langResult.language,
  });

  try {
    // Extract entities (bilingual NLP)
    const entities = extractEntities(text);
    connLog.debug({
      people: entities.people,
      dates: entities.dates,
      tasks: entities.tasks,
    }, 'NLP entities extracted');

    const sessionId = (msg as any).sessionId;
    let memory;
    let reminder = null;
    let recentMemory = null;

    if (sessionId) {
      // Look up if there's a recent memory for this user with the same sessionId
      const recentMemories = await prisma.memory.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { segments: true, reminders: true }
      });
      recentMemory = recentMemories.find((m: { metadata: unknown }) => {
        const meta = m.metadata as any;
        return meta && meta.sessionId === sessionId;
      });
    }

    if (recentMemory) {
      connLog.info({ memoryId: recentMemory.id, sessionId }, 'Continuing existing conversation session');
      
      // 1. Create a new transcript segment for this speech turn
      await prisma.transcriptSegment.create({
        data: {
          memoryId: recentMemory.id,
          speakerId: 'Speaker 0',
          text,
          startTime: 0,
          endTime: 0
        }
      });

      // 2. Combine all segments of this memory and run Gemini extraction on the consolidated conversation
      const allSegments = await prisma.transcriptSegment.findMany({
        where: { memoryId: recentMemory.id },
        orderBy: { createdAt: 'asc' }
      });
      const combinedText = allSegments.map((s: { text: string }) => s.text).join(' ');

      const extraction = await extractMemory(combinedText);
      if (!extraction) {
        sendMessage(client, {
          type: 'ERROR',
          message: 'Could not extract memory from transcript',
          code: 'AI_PROCESSING_FAILED',
        });
        return;
      }

      // 3. Update the existing memory record with the new consolidated extraction
      let nextActionDate: Date | null = null;
      if (extraction.category === 'Task') {
        nextActionDate = new Date();
        nextActionDate.setHours(nextActionDate.getHours() + 24);
      }

      memory = await prisma.memory.update({
        where: { id: recentMemory.id },
        data: {
          title: extraction.title,
          summary: extraction.summary,
          category: extraction.category,
          importance: extraction.importance,
          tags: extraction.tags || [],
          nextActionDate,
        },
        include: { segments: true, reminders: true }
      });

      // 4. Enqueue embedding generation for updated title/summary
      await enqueueEmbedding({
        memoryId: memory.id,
        title: extraction.title,
        summary: extraction.summary,
      });

      // 5. Update reminder if extracted, or create a new one if not existed
      if (extraction.reminders) {
        const parsed = ReminderExtractionSchema.safeParse(extraction.reminders);
        if (parsed.success) {
          if (recentMemory.reminders && recentMemory.reminders.length > 0) {
            const existingReminder = recentMemory.reminders[0];
            const updatedReminder = await ReminderService.updateReminder(userId, existingReminder.id, parsed.data);
            reminder = {
              id: updatedReminder.id,
              title: updatedReminder.title,
              dueAt: updatedReminder.dueAt.toISOString(),
            };
          } else {
            const savedReminder = await ReminderService.createReminder(userId, memory.id, parsed.data);
            reminder = {
              id: savedReminder.id,
              title: savedReminder.title,
              dueAt: savedReminder.dueAt.toISOString(),
            };
          }
        }
      }

      // Send result with language metadata
      const response: WSMemorySaved = {
        type: 'MEMORY_SAVED',
        data: {
          id: memory.id,
          title: memory.title,
          summary: memory.summary,
          category: memory.category,
          importance: memory.importance,
          language: langResult.language,
          segments: (memory as any).segments,
        },
        reminder,
      };

      sendMessage(client, response);
      connLog.info({
        memoryId: memory.id,
        language: langResult.language,
        hasReminder: !!reminder,
        isContinued: true
      }, 'Memory updated/continued via WebSocket');

      // ── Calendar Auto-Sync ──
      syncCalendarEvent(userId, combinedText, extraction.title, connLog)
        .then((calEvent) => {
          if (calEvent) {
            sendMessage(client, {
              type: 'CALENDAR_EVENT_CREATED',
              data: calEvent,
            });
          }
        })
        .catch((err) => connLog.warn({ err }, 'Calendar auto-sync failed (non-fatal)'));

    } else {
      // New conversation session
      const extraction = await extractMemory(text);
      if (!extraction) {
        sendMessage(client, {
          type: 'ERROR',
          message: 'Could not extract memory from transcript',
          code: 'AI_PROCESSING_FAILED',
        });
        return;
      }

      // Save memory with sessionId stored in metadata
      memory = await memoryService.saveFromExtraction(
        userId, 
        extraction, 
        [{ speakerId: 'Speaker 0', text, startTime: 0, endTime: 0 }], 
        'voice',
        { sessionId }
      );

      // Enqueue embedding generation (background job)
      await enqueueEmbedding({
        memoryId: memory.id,
        title: extraction.title,
        summary: extraction.summary,
      });

      // Save reminder if extracted
      if (extraction.reminders) {
        const parsed = ReminderExtractionSchema.safeParse(extraction.reminders);
        if (parsed.success) {
          const savedReminder = await ReminderService.createReminder(userId, memory.id, parsed.data);
          reminder = {
            id: savedReminder.id,
            title: savedReminder.title,
            dueAt: savedReminder.dueAt.toISOString(),
          };
        }
      }

      // Send result with language metadata
      const response: WSMemorySaved = {
        type: 'MEMORY_SAVED',
        data: {
          id: memory.id,
          title: memory.title,
          summary: memory.summary,
          category: memory.category,
          importance: memory.importance,
          language: langResult.language,
          segments: (memory as any).segments,
        },
        reminder,
      };

      sendMessage(client, response);
      connLog.info({
        memoryId: memory.id,
        language: langResult.language,
        hasReminder: !!reminder,
        isContinued: false
      }, 'New memory saved via WebSocket');

      // ── Calendar Auto-Sync ──
      syncCalendarEvent(userId, text, extraction.title, connLog)
        .then((calEvent) => {
          if (calEvent) {
            sendMessage(client, {
              type: 'CALENDAR_EVENT_CREATED',
              data: calEvent,
            });
          }
        })
        .catch((err) => connLog.warn({ err }, 'Calendar auto-sync failed (non-fatal)'));
    }
  } catch (err) {
    connLog.error({ err }, 'Failed to process transcript');
    sendMessage(client, {
      type: 'ERROR',
      message: 'Failed to process transcript',
      code: 'INTERNAL_ERROR',
    } as WSError);
  }
}

// ─── Semantic Query Handler (Bilingual) ───────────────────────
async function handleQuery(
  client: AuthenticatedSocket,
  msg: { text: string; language?: string },
  connLog: ReturnType<typeof withCorrelation>,
) {
  const query = normalizeTranscript(msg.text || '');
  if (!query || query.length < 2) return;

  const userId = client.user!.userId;
  const langResult = detectLanguage(query);

  connLog.info({ query: query.substring(0, 50), language: langResult.language }, 'Processing query');

  sendMessage(client, {
    type: 'STATUS_CHANGE',
    status: 'searching',
    language: langResult.language,
  });

  try {
    // Hybrid semantic search (pgvector + keyword)
    const results = await retrievalService.hybridSearch(userId, query);

    if (results.length === 0) {
      sendMessage(client, {
        type: 'QUERY_RESULT',
        query,
        results: [],
        aiAnswer: langResult.language === 'en'
          ? "I don't have any memories matching that query yet."
          : 'अभी इस query से related कोई memory नहीं मिली।',
      });
      return;
    }

    // Build context from results
    const contextSnippets = results.slice(0, 5).map((m: RankedMemory, i: number) =>
      `${i + 1}. [${m.category}] ${m.title}: ${m.summary}`
    ).join('\n');

    // AI-powered answer from memory context
    const aiAnswer = await answerQuery(query, contextSnippets, langResult.language);

    sendMessage(client, {
      type: 'QUERY_RESULT',
      query,
      language: langResult.language,
      results: results.slice(0, 10).map((m: RankedMemory) => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        category: m.category,
        importance: m.importance,
        createdAt: m.createdAt,
      })),
      aiAnswer,
    });

    connLog.info({ resultCount: results.length }, 'Query answered');
  } catch (err) {
    connLog.error({ err }, 'Query failed');
    sendMessage(client, {
      type: 'ERROR',
      message: 'Search query failed',
      code: 'QUERY_FAILED',
    } as WSError);
  }
}

// ─── Helper ───────────────────────────────────────────────────
function sendMessage(client: WebSocket, message: any) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ ...message, timestamp: Date.now() }));
  }
}

// ─── Calendar Auto-Sync Helper ────────────────────────────────
/**
 * Checks if a transcript contains a calendar event and auto-creates it
 * in the user's connected Google Calendar.
 *
 * Returns the created event or null if:
 * - Calendar is not configured/connected
 * - No calendar-worthy event detected
 * - Confidence is below threshold
 */
async function syncCalendarEvent(
  userId: string,
  transcript: string,
  memoryTitle: string,
  connLog: ReturnType<typeof withCorrelation>,
) {
  // Skip if Google Calendar is not configured
  if (!CalendarService.isConfigured()) return null;

  // Skip if user hasn't connected their calendar
  const isConnected = await CalendarService.isConnected(userId);
  if (!isConnected) return null;

  // Ask Gemini to extract calendar event data
  const extracted = await extractCalendarEvent(transcript, memoryTitle);
  if (!extracted) return null;

  connLog.info({
    summary: extracted.summary,
    confidence: extracted.confidence,
  }, 'Calendar event detected — auto-creating');

  // Create the event in Google Calendar
  const event = await CalendarService.createEvent(userId, {
    summary: extracted.summary,
    description: extracted.description || `Auto-created by EchoMind from voice memo: "${memoryTitle}"`,
    startTime: extracted.startTime,
    endTime: extracted.endTime,
    location: extracted.location,
    isAllDay: extracted.isAllDay,
    timeZone: extracted.timeZone,
    recurrence: extracted.recurrence,
  });

  return event;
}
