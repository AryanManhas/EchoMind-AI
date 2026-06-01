import { createQueue, createWorker, type Job } from './queue.factory.js';
import { createLogger } from '../utils/logger.js';
import { extractMemory } from '../ai/gemini.service.js';
import { memoryService } from '../services/memory.service.js';
import { ReminderService } from '../reminders/reminder.service.js';
import { ReminderExtractionSchema } from '@echomind/types';
import { CONSTANTS } from '../config/constants.js';
import { enqueueEmbedding } from './embedding.queue.js';
import { deepgramService } from '../ai/deepgram.service.js';
import { extractMeetingInsights } from '../ai/gemini.service.js';
import fs from 'fs';

const log = createLogger('ai-queue');

// ─── Job Payload ──────────────────────────────────────────────
interface AIProcessingJobData {
  userId: string;
  transcript?: string;
  filePath?: string;
  sourceType: 'voice' | 'text' | 'import' | 'meeting';
  language?: string;
  correlationId?: string;
}

// ─── Result ───────────────────────────────────────────────────
export interface AIProcessingResult {
  memoryId: string;
  title: string;
  summary: string;
  category: string;
  importance: number;
  reminderId?: string;
  reminderTitle?: string;
  reminderDueAt?: string;
}

// ─── Queue ────────────────────────────────────────────────────
export const aiProcessingQueue = createQueue<AIProcessingJobData>(CONSTANTS.QUEUE_NAMES.AI_PROCESSING);

export async function processAIJob(jobData: AIProcessingJobData, jobId: string, correlationId?: string) {
  const { userId, transcript, filePath, sourceType, language } = jobData;
  const processCorrelationId = correlationId || jobData.correlationId;
  log.info({ userId, language, correlationId: processCorrelationId, jobId, filePath, sourceType }, 'Starting AI processing job');

  try {
    let segments: Array<{ speakerId: string; text: string; startTime: number; endTime: number }> = [];
    let processingTranscript = transcript || '';

    // 1. Handle diarization if filePath is provided
    if (filePath && (sourceType === 'voice' || sourceType === 'meeting')) {
      try {
        segments = await deepgramService.transcribeFile(filePath, language || 'en');
        processingTranscript = segments.map(s => `[${s.speakerId}] ${s.text}`).join('\n');
        log.info({ userId, jobId, segmentCount: segments.length }, 'Deepgram transcription successful');
      } catch (error) {
        log.error({ userId, jobId, error, filePath }, 'Deepgram transcription failed');
        throw new Error(`Transcription stage failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Cleanup local file after transcription (ensure this happens even on failure)
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            log.info({ userId, jobId, filePath }, 'Local audio file cleaned up');
          } catch (cleanupErr) {
            log.warn({ userId, jobId, cleanupErr, filePath }, 'Failed to cleanup local audio file');
          }
        }
      }
    } else if (transcript) {
      segments = [{ speakerId: 'Speaker 0', text: transcript, startTime: 0, endTime: 0 }];
    }

    if (!processingTranscript || processingTranscript.trim().length === 0) {
      log.warn({ userId, jobId, correlationId: processCorrelationId }, 'No transcript text available for processing');
      return;
    }

    // 2. AI memory extraction (from combined transcript)
    log.info({ userId, jobId, textLength: processingTranscript.length }, 'Extracting memory via Gemini');
    const extraction = await extractMemory(processingTranscript);
    if (!extraction) {
      log.error({ userId, jobId, correlationId: processCorrelationId }, 'Gemini memory extraction failed (returned null)');
      throw new Error('AI extraction stage failed: Gemini returned null');
    }

    // 3. Special handling for Meeting Mode (extract insights before saving)
    let metadata = {};
    if (sourceType === 'meeting') {
      try {
        log.info({ userId, jobId }, 'Extracting meeting insights');
        const insights = await extractMeetingInsights(processingTranscript);
        if (insights) {
          metadata = { meetingInsights: insights };
          log.info({ userId, jobId, correlationId: processCorrelationId }, 'Meeting insights extracted successfully');
        }
      } catch (err) {
        // Non-fatal error: log and continue
        log.error({ userId, jobId, err }, 'Meeting insights extraction failed (non-fatal)');
      }
    }

    // 4. Save memory with relational segments and metadata
    log.info({ userId, jobId }, 'Saving memory to database');
    const memory = await memoryService.saveFromExtraction(userId, extraction, segments, sourceType, metadata);

    // 5. Enqueue embedding generation
    try {
      await enqueueEmbedding({
        memoryId: memory.id,
        title: extraction.title,
        summary: extraction.summary,
      });
      log.info({ userId, jobId, memoryId: memory.id }, 'Embedding generation enqueued');
    } catch (embErr) {
      log.error({ userId, jobId, memoryId: memory.id, embErr }, 'Failed to enqueue embedding generation');
      // Non-fatal for this worker, but should be tracked
    }

    // 6. Save reminders if extracted
    if (extraction.reminders && extraction.reminders.length > 0) {
      for (const rem of extraction.reminders) {
        try {
          // Instead of parsed schema since the new shape is simpler { description, due_date }
          await ReminderService.createReminder(userId, memory.id, {
            title: rem.description,
            description: rem.description,
            dueAt: rem.due_date,
            category: 'work', // default fallback
            priority: 'medium', // default fallback
            isCritical: false
          });
          log.info({ userId, jobId, memoryId: memory.id, description: rem.description }, 'Reminder created successfully');
        } catch (remErr) {
          console.error('Failed to save extracted reminder in DB:', remErr);
          log.error({ userId, jobId, remErr }, 'Failed to save extracted reminder');
        }
      }
    }

    log.info({ userId, jobId, memoryId: memory.id }, 'AI processing job completed successfully');

    // Store result in job return value for WS notification
    return {
      memoryId: memory.id,
      title: extraction.title,
      summary: extraction.summary,
      category: extraction.category,
      importance: extraction.importance
    };
  } catch (fatalError) {
    log.error({ userId, jobId, fatalError, correlationId: processCorrelationId }, 'AI processing job failed FATALLY');
    // Re-throw to allow BullMQ to handle retries/failure state (if used)
    throw fatalError;
  }
}

// ─── Worker ───────────────────────────────────────────────────
export const aiProcessingWorker = createWorker<AIProcessingJobData>(
  CONSTANTS.QUEUE_NAMES.AI_PROCESSING,
  async (job: Job<AIProcessingJobData>) => {
    return await processAIJob(job.data, job.id || 'unknown', job.data.correlationId);
  },
  3, // Concurrency: 3 parallel AI jobs
);

/**
 * Enqueue a transcript for AI processing.
 */
export async function enqueueAIProcessing(data: AIProcessingJobData): Promise<string> {
  if (!aiProcessingQueue) {
    const jobId = `local-${Date.now()}`;
    // Execute directly asynchronously
    processAIJob(data, jobId).catch(err => log.error({ err, jobId }, 'Local AI processing failed'));
    return jobId;
  }

  const job = await aiProcessingQueue.add('process', data, {
    priority: data.sourceType === 'voice' ? 1 : 2, // Voice gets priority
  });
  return job.id!;
}
