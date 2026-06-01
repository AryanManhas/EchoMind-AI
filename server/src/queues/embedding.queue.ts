import { createQueue, createWorker, type Job } from './queue.factory.js';
import { createLogger } from '../utils/logger.js';
import { embeddingService, EmbeddingService } from '../ai/embedding.service.js';
import prisma from '../db/prisma.js';
import { CONSTANTS } from '../config/constants.js';

const log = createLogger('embedding-queue');

// ─── Job Payload ──────────────────────────────────────────────
interface EmbeddingJobData {
  memoryId: string;
  title: string;
  summary: string;
}

// ─── Queue ────────────────────────────────────────────────────
export const embeddingQueue = createQueue<EmbeddingJobData>(CONSTANTS.QUEUE_NAMES.EMBEDDING);

export async function processEmbeddingJob(jobData: EmbeddingJobData, jobId: string) {
  const { memoryId, title, summary } = jobData;
  log.info({ memoryId, jobId }, 'Generating embedding');

  const textToEmbed = `Title: ${title}\nSummary: ${summary}`;
  const embedding = await embeddingService.generate(textToEmbed);
  const vec = EmbeddingService.toSqlVector(embedding);

  await prisma.$executeRaw`
    UPDATE "Memory" SET embedding = ${vec}::vector WHERE id = ${memoryId}
  `;

  log.info({ memoryId }, 'Embedding stored successfully');
}

// ─── Worker ───────────────────────────────────────────────────
export const embeddingWorker = createWorker<EmbeddingJobData>(
  CONSTANTS.QUEUE_NAMES.EMBEDDING,
  async (job: Job<EmbeddingJobData>) => {
    return await processEmbeddingJob(job.data, job.id || 'unknown');
  },
  2, // Concurrency: 2 parallel embedding jobs
);

/**
 * Enqueue an embedding generation job.
 * Called by the memory service after saving a memory.
 */
export async function enqueueEmbedding(data: EmbeddingJobData): Promise<void> {
  if (!embeddingQueue) {
    const jobId = `local-${Date.now()}`;
    // Delay slightly to let DB write settle
    setTimeout(() => {
      processEmbeddingJob(data, jobId).catch(err => log.error({ err, jobId }, 'Local embedding generation failed'));
    }, 500);
    return;
  }

  await embeddingQueue.add('generate', data, {
    priority: 1,
    delay: 500, // Small delay to let DB write settle
  });
}
