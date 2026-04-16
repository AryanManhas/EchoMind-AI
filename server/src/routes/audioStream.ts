import { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';
import { extractMemory } from '../services/gemini.service';
import { MemoryRepository } from '../repositories/MemoryRepository';
import { TranscriptionService } from '../services/TranscriptionService';

dotenv.config();

const memoryRepo = new MemoryRepository();
const transcriptionService = new TranscriptionService();

export default async function audioStreamRoutes(fastify: FastifyInstance) {
  fastify.get('/ws/stream', { websocket: true }, (connection, req) => {
    const correlationId = randomBytes(4).toString('hex');
    console.log(`[BRIDGE] [${correlationId}] New Audio Stream Connection from ${req.socket.remoteAddress || 'unknown'}`);

    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',    
      '-f', 's16le',     
      '-ar', '16000',    
      '-ac', '1',        
      'pipe:1'           
    ]);

    ffmpeg.on('error', (err) => {
        console.error(`[FFmpeg] [${correlationId}] Error:`, err);
        connection.socket.send(JSON.stringify({ type: 'ERROR', message: 'Audio processing failed' }));
    });

    // Start transcription in background
    const transcriptionPromise = transcriptionService.transcribeStream(ffmpeg.stdout, correlationId);

    connection.socket.on('message', (message) => {
      if (Buffer.isBuffer(message)) {
        ffmpeg.stdin.write(message);
      } else if (typeof message === 'string') {
        ffmpeg.stdin.write(Buffer.from(message));
      }
    });

    connection.socket.on('close', () => {
        console.log(`[BRIDGE] [${correlationId}] Connection closed. Finishing stream.`);
        ffmpeg.stdin.end();
    });

    connection.socket.on('error', (err) => {
      console.error(`[WebSocket] [${correlationId}] Error:`, err);
      ffmpeg.stdin.end();
    });

    // Handle transcription result
    transcriptionPromise.then(async (result) => {
        if (!result.text || result.text.trim().length === 0) {
            console.log(`[Transcription] [${correlationId}] Empty transcript received.`);
            return;
        }

        console.log(`[Transcription] [${correlationId}] Result: ${result.text}`);
        
        try {
            // Notify client: Transitioning to Analysis
            connection.socket.send(JSON.stringify({ 
                type: 'STATUS_CHANGE', 
                status: 'analyzing',
                correlationId 
            }));

            const memoryAnalysis = await extractMemory(result.text);
            
            if (memoryAnalysis) {
                console.log(`[MemoryEngine] [${correlationId}] Extraction successful: ${memoryAnalysis.title}`);
                
                const savedMemory = await memoryRepo.saveExtractedMemory(memoryAnalysis, result.text);
                
                connection.socket.send(JSON.stringify({
                    type: 'MEMORY_SAVED',
                    memory: savedMemory, // Aligned with Mobile hook expectation
                    correlationId
                }));
                
                console.log(`[MemoryRepo] [${correlationId}] Memory saved to database.`);
            }
        } catch (err) {
            console.error(`[Processing] [${correlationId}] Error:`, err);
            connection.socket.send(JSON.stringify({ type: 'ERROR', message: 'Memory extraction failed' }));
        }
    }).catch((err) => {
        console.error(`[Pipeline] [${correlationId}] Fatal Error:`, err);
        connection.socket.send(JSON.stringify({ type: 'ERROR', message: 'Transcription pipeline failed' }));
    });

    // Initial status
    connection.socket.send(JSON.stringify({ 
        type: 'STATUS_CHANGE', 
        status: 'transcribing',
        correlationId 
    }));
  });
}
