import { env } from './utils/env';

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';
import axios from 'axios';
import FormData from 'form-data';
import { performance } from 'perf_hooks';
import { extractMemory } from './services/gemini.service';
import { MemoryRepository } from './repositories/MemoryRepository';
import { TranscriptionService } from './services/TranscriptionService';
import { logger } from './utils/logger';
import prisma from './lib/prisma';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const memoryRepo = new MemoryRepository();
const transcriptionService = new TranscriptionService();

app.use(cors());
app.use(express.json());

// ── Database Readiness ──
prisma.$connect()
  .then(() => logger.info('[DEBUG] Database Ready'))
  .catch(err => logger.error({ err }, '[DEBUG] Database Connection Failed'));

// ── Health check ──
app.get('/health', (req, res) => res.send({ status: 'active', engine: 'EchoMind Neural Loop', ip: '192.168.29.113' }));

// ── Vault API (Search/List) ──
app.get('/api/memories', async (req, res) => {
  try {
    const { q, category } = req.query;
    let whereClause: any = {};
    
    if (category && category !== 'All') {
      whereClause.category = String(category);
    }
    
    // Leverage Prisma Full-Text search if q is provided
    if (q && typeof q === 'string' && q.trim().length > 0) {
      const searchStr = q.trim().split(' ').join(' | '); // Convert "my idea" to "my | idea" simple fts format
      // Actually Prisma accepts a raw query string, but using standard `search` property requires formatting or simple string matching.
      whereClause.OR = [
         { summary: { search: searchStr } },
         { rawTranscript: { search: searchStr } },
         { title: { contains: q.trim(), mode: 'insensitive' } } // Fallback for title
      ];
    }
    
    const startTime = performance.now();
    const memories = await prisma.memory.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      // Include rawTranscript for Drawer view
    });
    const endTime = performance.now();
    logger.info(`[API] GET /api/memories — Latency: ${(endTime - startTime).toFixed(0)}ms | Found: ${memories.length}`);
    
    res.json({ memories });
  } catch (err) {
    logger.error({ err }, '[API] Search Error');
    res.status(500).json({ error: 'Failed to fetch memories', memories: [] });
  }
});

// ── Semantic Vector Search API ──
app.get('/api/memories/semantic-search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter "q" is required for semantic search' });
    }

    const searchLimit = limit ? parseInt(String(limit), 10) : 5;
    
    const startTime = performance.now();
    const memories = await memoryRepo.searchSimilarMemories(q.trim(), searchLimit);
    const endTime = performance.now();
    
    logger.info(`[API] GET /api/memories/semantic-search — Latency: ${(endTime - startTime).toFixed(0)}ms | Found: ${memories.length}`);
    
    res.json({ memories });
  } catch (err) {
    logger.error({ err }, '[API] Semantic Search Error');
    res.status(500).json({ error: 'Failed to perform semantic search' });
  }
});

// ── Retry Extraction API ──
app.post('/api/memories/:id/retry', async (req, res) => {
  try {
    const memory = await prisma.memory.findUnique({ where: { id: req.params.id } });
    if (!memory || !memory.rawTranscript) return res.status(404).json({ error: 'Memory or transcript not found' });
    
    const extractionStart = performance.now();
    const newExtraction = await extractMemory(memory.rawTranscript);
    if (!newExtraction) return res.status(500).json({ error: 'Extraction failed' });
    
    const updated = await prisma.memory.update({
      where: { id: memory.id },
      data: {
        title: newExtraction.title,
        summary: newExtraction.summary,
        category: newExtraction.category,
        importance: newExtraction.importance
      }
    });
    const extractionLatency = performance.now() - extractionStart;
    logger.info(`[AUDIT] Retry Extraction -> (${extractionLatency.toFixed(0)}ms) -> DB Write (Success)`);
    res.json({ memory: updated });
  } catch (err) {
    logger.error({ err }, '[API] Retry Error');
    res.status(500).json({ error: 'Server error' });
  }
});


// ── WebSocket Heartbeat (Anti-Drop) ──
function heartbeat(this: any) {
  this.isAlive = true;
}

const interval = setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

// ── Neural Loop Handler ──
wss.on('connection', (ws: any) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  
  const correlationId = Math.random().toString(36).substring(7);
  logger.info(`[DEBUG] Hardware connection: Active [${correlationId}]`);

  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'quiet',
    '-i', 'pipe:0',
    '-f', 's16le',
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
    // Intercept synthetic mobile ping
    if (message.toString() === '{"type":"PING"}') {
      ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    }

    // Handle finalized text from mobile STT
    try {
        const data = JSON.parse(message.toString());
        if (data.type === 'TEXT_TRANSCRIPT') {
            const transcript = data.text;
            logger.info(`[INTEL] Received Text Transcript [${correlationId}]: ${transcript.substring(0, 50)}...`);
            
            ws.send(JSON.stringify({ type: 'STATUS_CHANGE', status: 'analyzing', correlationId }));

            extractMemory(transcript).then(async (memoryAnalysis) => {
                if (memoryAnalysis) {
                    const savedMemory = await memoryRepo.saveExtractedMemory(memoryAnalysis, transcript);
                    ws.send(JSON.stringify({ type: 'MEMORY_SAVED', data: savedMemory, correlationId }));
                    logger.info(`[AUDIT] Text Processed -> Memory Saved [${correlationId}]`);
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
                const partialResult = await transcriptionService.transcribeBuffer(audioBuffer, correlationId, 'tiny.en');
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

    if (audioBuffer.length > 0) {
      const streamEndTime = performance.now();
      try {
        let transcript = '';
        try {
          const whisperUrl = env.WHISPER_URL;
          
          const whisperStartTime = performance.now();
          const whisperResponse = await axios.post(whisperUrl, formData, {
            headers: formData.getHeaders(),
            params: { task: 'transcribe', language: 'en', encode: 'true', output: 'json' }
          });
          transcript = whisperResponse.data.text;
        } catch (e) {
          if (env.DEMO_MODE) {
            logger.warn(`[DEMO_MODE] Whisper API unreachable. Injecting mock transcript.`);
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
            const savedMemory = await memoryRepo.saveExtractedMemory(memoryAnalysis, transcript);
            const saveTime = performance.now() - saveStartTime;
            
            // Required telemetry log
            logger.info(`[AUDIT] Start -> Transcript (${whisperTime.toFixed(0)}ms) -> Extraction (${geminiTime.toFixed(0)}ms) -> DB Write (Success)`);
            
            ws.send(JSON.stringify({ type: 'MEMORY_SAVED', data: savedMemory }));
          }
        }
      } catch (err) {
        logger.error({ err }, `[DEBUG] Startup Link Error [${correlationId}]`);
      }
    }
  });
});

// ── Graceful Shutdown ──
const shutdown = async () => {
  logger.info('[DEBUG] Neural Loop Shutting Down...');
  clearInterval(interval);
  wss.close();
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const PORT = env.PORT;
server.listen(Number(PORT), '0.0.0.0', () => {
  logger.info(`[DEBUG] EchoMind AI Neural Loop active at ws://0.0.0.0:${PORT}`);
});
