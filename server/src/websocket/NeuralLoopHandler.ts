import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';
import axios from 'axios';
import FormData from 'form-data';
import { performance } from 'perf_hooks';
import { extractMemory } from '../ai/gemini.service.js';
import { MemoryRepository } from '../repositories/MemoryRepository.js';
import { TranscriptionService } from '../ai/transcription.service.js';
import { ReminderService } from '../services/ReminderService.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser } from '@echomind/types';

const PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000000';

const memoryRepo = new MemoryRepository();
const transcriptionService = new TranscriptionService();

function heartbeat(this: any) {
  this.isAlive = true;
}

export function setupNeuralLoop(wss: WebSocketServer) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (ws: any) => {
    ws.isAlive = true;
    let isAuthenticated = false;
    let user: AuthUser | undefined;
    let messageCount = 0;
    let windowStart = Date.now();

    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) {
        ws.send(JSON.stringify({ type: 'AUTH_FAIL', message: 'Authentication timeout' }));
        ws.close(4001, 'Authentication timeout');
      }
    }, 5000);

    ws.on('pong', heartbeat);

    const correlationId = Math.random().toString(36).substring(7);
    logger.info(`[DEBUG] Hardware connection: Active [${correlationId}]`);

    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'quiet',
      '-i', 'pipe:0',
      '-f', 'wav',
      '-ar', '16000',
      '-ac', '1',
      '-af', 'highpass=f=200,lowpass=f=3000', // Filter noise for better Whisper results
      'pipe:1'
    ]);

    let audioBuffer = Buffer.alloc(0);
    let hasReceivedFirstChunk = false;
    let partialInterval: NodeJS.Timeout | null = null;
    let isTranscribingPartial = false;

    ws.on('message', (message: Buffer) => {
      // ── Rate Limiting ──
      const now = Date.now();
      if (now - windowStart > 1000) {
        messageCount = 0;
        windowStart = now;
      }
      messageCount++;
      if (messageCount > 50) {
        logger.warn(`[WARN] NeuralLoop rate limit exceeded [${correlationId}]`);
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Rate limit exceeded' }));
        return;
      }

      // Handle auth and JSON messages
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'AUTH') {
          clearTimeout(authTimeout);
          try {
            user = AuthService.verifyAccessToken(data.token);
            isAuthenticated = true;
            ws.send(JSON.stringify({ type: 'AUTH_OK' }));
            logger.info(`[INTEL] NeuralLoop Authenticated [${correlationId}] User: ${user.userId}`);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'AUTH_FAIL', message: 'Invalid token' }));
            ws.close(4002, 'Invalid token');
          }
          return;
        }

        if (!isAuthenticated) {
          ws.send(JSON.stringify({ type: 'AUTH_FAIL', message: 'Not authenticated' }));
          return;
        }

        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
          return;
        }

        if (data.type === 'TEXT_TRANSCRIPT') {
          const transcript = data.text?.trim();
          if (!transcript || transcript.length < 5) return; // Ultra-fast trigger permissive filter
          
          logger.info(`[INTEL] Received Text Transcript [${correlationId}]: ${transcript.substring(0, 50)}...`);

          ws.send(JSON.stringify({ type: 'STATUS_CHANGE', status: 'analyzing', correlationId }));

          extractMemory(transcript).then(async (memoryAnalysis) => {
            if (memoryAnalysis) {
              const activeUserId = user?.userId || PLACEHOLDER_USER_ID;
              const savedMemory = await memoryRepo.saveExtractedMemory(memoryAnalysis, [{ speakerId: 'Speaker 0', text: transcript, startTime: 0, endTime: 0 }], activeUserId);
              
              let savedReminders: any[] = [];
              if (memoryAnalysis.reminders && memoryAnalysis.reminders.length > 0) {
                for (const rem of memoryAnalysis.reminders) {
                  try {
                    const saved = await ReminderService.createReminder(activeUserId, savedMemory.id, {
                      title: rem.description,
                      description: rem.description,
                      dueAt: rem.due_date,
                      category: 'work',
                      priority: 'medium',
                      isCritical: false
                    });
                    savedReminders.push(saved);
                  } catch (e) {
                    logger.error({ err: e }, 'Failed to save reminder');
                  }
                }
              }

              ws.send(JSON.stringify({ 
                type: 'MEMORY_SAVED', 
                data: savedMemory, 
                reminders: savedReminders,
                correlationId 
              }));
              logger.info(`[AUDIT] Text Processed -> Memory Saved [${correlationId}] ${savedReminders.length > 0 ? '+ Reminders Created' : ''}`);
            }
          }).catch(err => {
            logger.error({ err }, `[ERROR] Text processing failed [${correlationId}]`);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to process transcript' }));
          });
          return;
        }
      } catch (e) {
        // Not JSON or not matching our special type, treat as audio
      }

      if (!hasReceivedFirstChunk) {
        logger.info(`[DEBUG] Neural Loop: Data Stream Detected [${correlationId}]`);
        hasReceivedFirstChunk = true;

        // Start partial transcription loop every 3 seconds
        partialInterval = setInterval(async () => {
          if (audioBuffer.length > 50000 && !isTranscribingPartial) {
            isTranscribingPartial = true;
            try {
              // Peek the buffer for partial transcription with tiny model
              const partialResult = await transcriptionService.transcribeBuffer(audioBuffer, correlationId);
              if (partialResult && partialResult.text) {
                ws.send(JSON.stringify({ type: 'PARTIAL_TRANSCRIPT', text: partialResult.text }));
              }
            } catch (err) {
              // Ignore partial failures to keep the stream alive
            } finally {
              isTranscribingPartial = false;
            }
          }
        }, 3000);
      }
      ffmpeg.stdin.write(message);
    });

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      // Append to our running buffer
      audioBuffer = Buffer.concat([audioBuffer, chunk]);
    });

    ws.on('close', async () => {
      logger.info(`[DEBUG] Session Ended. Calculating Neural Patterns... [${correlationId}]`);
      if (partialInterval) clearInterval(partialInterval);
      ffmpeg.stdin.end();

      ffmpeg.on('close', async () => {
        if (audioBuffer.length > 0) {
          const streamEndTime = performance.now();
          try {
            let transcript = '';
            try {
              const transcriptionResult = await transcriptionService.transcribeBuffer(audioBuffer, correlationId);
              if (transcriptionResult) {
                transcript = transcriptionResult.text;
              }
            } catch (e) {
              if (env.DEMO_MODE) {
                logger.warn(`[DEMO_MODE] STT API unreachable. Injecting mock transcript.`);
                transcript = "This is a demonstration of the Neural Link system falling back to mock networks because of internet drop.";
              } else {
                throw e;
              }
            }

            const transcriptionCompleteTime = performance.now();
            const whisperTime = transcriptionCompleteTime - streamEndTime;

            if (transcript && transcript.trim()) {
              ws.send(JSON.stringify({ type: 'FINAL_TRANSCRIPT', text: transcript }));
              ws.send(JSON.stringify({ type: 'processing_memory' }));

              const memoryAnalysis = await extractMemory(transcript);
              const geminiCompleteTime = performance.now();
              const geminiTime = geminiCompleteTime - transcriptionCompleteTime;

              if (memoryAnalysis) {
                const importanceLabel = memoryAnalysis.importance >= 0.8 ? 'HIGH' : memoryAnalysis.importance >= 0.4 ? 'MEDIUM' : 'LOW';
                logger.info(`[INTEL] Memory Classified as: ${memoryAnalysis.category.toUpperCase()} | Importance: ${importanceLabel}`);

                const saveStartTime = performance.now();
                const activeUserId = user?.userId || PLACEHOLDER_USER_ID;
                const savedMemory = await memoryRepo.saveExtractedMemory(memoryAnalysis, [{ speakerId: 'Speaker 0', text: transcript, startTime: 0, endTime: 0 }], activeUserId);
                
                let savedReminders: any[] = [];
                if (memoryAnalysis.reminders && memoryAnalysis.reminders.length > 0) {
                  for (const rem of memoryAnalysis.reminders) {
                    try {
                      const saved = await ReminderService.createReminder(activeUserId, savedMemory.id, {
                        title: rem.description,
                        description: rem.description,
                        dueAt: rem.due_date,
                        category: 'work',
                        priority: 'medium',
                        isCritical: false
                      });
                      savedReminders.push(saved);
                    } catch (e) {
                      logger.error({ err: e }, 'Failed to save reminder');
                    }
                  }
                }

                const saveTime = performance.now() - saveStartTime;

                // Required telemetry log
                logger.info(`[AUDIT] Start -> Transcript (${whisperTime.toFixed(0)}ms) -> Extraction (${geminiTime.toFixed(0)}ms) -> DB Write (Success) ${savedReminders.length > 0 ? '+ Reminders' : ''}`);

                ws.send(JSON.stringify({ 
                  type: 'MEMORY_SAVED', 
                  data: savedMemory,
                  reminders: savedReminders
                }));
              }
            }
          } catch (err) {
            logger.error({ err }, `[DEBUG] Startup Link Error [${correlationId}]`);
          }
        }
      });
    });
  });

  return { interval };
}
