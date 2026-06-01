import { createQueue, createWorker, type Job } from './queue.factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('dead-letter');

/**
 * Dead-Letter Queue (DLQ) Handler
 *
 * When jobs fail all retry attempts in any queue, they're moved here for:
 * 1. Permanent logging
 * 2. Alert generation
 * 3. Optional manual reprocessing
 *
 * This prevents failed jobs from being silently dropped while keeping
 * the primary queues clean.
 */

interface DeadLetterJobData {
  originalQueue: string;
  originalJobId: string;
  failedReason: string;
  payload: Record<string, unknown>;
  failedAt: string;
  attempts: number;
}

// ─── Queue ────────────────────────────────────────────────────
export const deadLetterQueue = createQueue<DeadLetterJobData>('dead-letter');

export async function processDeadLetterJob(jobData: DeadLetterJobData, jobId: string) {
  const { originalQueue, originalJobId, failedReason, attempts } = jobData;

  // Log permanently for monitoring
  log.error({
    originalQueue,
    originalJobId,
    failedReason,
    attempts,
    dlqJobId: jobId,
  }, 'Job moved to dead-letter queue');

  // In production, this would also:
  // - Write to a persistent error log table
  // - Send alerts to monitoring (PagerDuty, Slack webhook, etc.)
  // - Increment error metrics
}

// ─── Worker ───────────────────────────────────────────────────
export const deadLetterWorker = createWorker<DeadLetterJobData>(
  'dead-letter',
  async (job: Job<DeadLetterJobData>) => {
    return await processDeadLetterJob(job.data, job.id || 'unknown');
  },
  1, // Low concurrency — DLQ processing is not time-sensitive
);

/**
 * Move a failed job to the dead-letter queue.
 * Called from other queue workers when max retries are exhausted.
 */
export async function moveToDeadLetter(
  originalQueue: string,
  originalJobId: string,
  failedReason: string,
  payload: Record<string, unknown>,
  attempts: number,
): Promise<void> {
  if (!deadLetterQueue) {
    const jobId = `local-dlq-${Date.now()}`;
    processDeadLetterJob({
      originalQueue,
      originalJobId,
      failedReason,
      payload,
      failedAt: new Date().toISOString(),
      attempts,
    }, jobId).catch(err => log.error({ err }, 'Local DLQ processing failed'));
    return;
  }

  await deadLetterQueue.add('dead-letter', {
    originalQueue,
    originalJobId,
    failedReason,
    payload,
    failedAt: new Date().toISOString(),
    attempts,
  });

  log.warn({ originalQueue, originalJobId }, 'Job sent to dead-letter queue');
}

/**
 * Get dead-letter queue statistics.
 */
export async function getDeadLetterStats() {
  if (!deadLetterQueue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
  const [waiting, active, completed, failed] = await Promise.all([
    deadLetterQueue.getWaitingCount(),
    deadLetterQueue.getActiveCount(),
    deadLetterQueue.getCompletedCount(),
    deadLetterQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}
