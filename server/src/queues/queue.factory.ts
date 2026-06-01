import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';

const log = createLogger('queue');

/**
 * Redis connection config for BullMQ.
 * Shared across all queues and workers.
 */
export function getRedisConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  
  const isTls = url.protocol === 'rediss:';
  
  return {
    host: url.hostname,
    port: parseInt(url.port) || (isTls ? 6380 : 6379),
    password: url.password || undefined,
    username: url.username || undefined,
    tls: isTls ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false, // Fail fast if Redis is down
    retryStrategy(times: number) {
      // Exponential backoff with a cap of 10 seconds
      return Math.min(times * 50, 10000);
    },
  };
}

/**
 * Create a typed BullMQ queue with standard settings.
 */
export function createQueue<T>(name: string): Queue<T> | null {
  if (!env.ENABLE_QUEUES || !env.ENABLE_REDIS) {
    log.info({ queue: name }, 'Queue creation skipped (ENABLE_QUEUES or ENABLE_REDIS is false)');
    return null;
  }

  const queue = new Queue<T>(name, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });

  queue.on('error', (err) => {
    log.error({ err, queue: name }, 'Queue error');
  });

  log.info({ queue: name }, 'Queue created');
  return queue;
}

/**
 * Create a typed BullMQ worker with standard error handling.
 */
export function createWorker<T>(
  name: string,
  processor: (job: Job<T>) => Promise<any>,
  concurrency: number = 3,
): Worker<T> | null {
  if (!env.ENABLE_QUEUES || !env.ENABLE_REDIS) {
    log.info({ queue: name }, 'Worker creation skipped (ENABLE_QUEUES or ENABLE_REDIS is false)');
    return null;
  }

  const worker = new Worker<T>(name, processor, {
    connection: getRedisConnection(),
    concurrency,
  });

  worker.on('completed', (job) => {
    log.info({ queue: name, jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ queue: name, jobId: job?.id, err }, 'Job failed');
  });

  worker.on('error', (err) => {
    log.error({ err, queue: name }, 'Worker error');
  });

  log.info({ queue: name, concurrency }, 'Worker started');
  return worker;
}

export type { Job };
