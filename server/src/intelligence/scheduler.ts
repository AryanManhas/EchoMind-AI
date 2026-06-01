import { createLogger } from '../utils/logger.js';
import prisma from '../db/prisma.js';
import { ProactiveEngine } from '../intelligence/proactive.engine.js';
import { CONSTANTS } from '../config/constants.js';

const log = createLogger('scheduler');

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Background scheduler for periodic tasks:
 * 1. Proactive reminder checks (every 5 minutes)
 * 2. Snoozed reminder reactivation
 * 3. Missed deadline detection
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    log.warn('Scheduler already running');
    return;
  }

  log.info('Scheduler started');

  schedulerInterval = setInterval(async () => {
    try {
      // 1. Verify Database Reachability (Fail Fast)
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch (dbErr) {
        log.warn({ err: dbErr }, 'Database unreachable during scheduler tick. Skipping.');
        return; // Skip this tick, wait for next one
      }

      // Get all active users (users with at least one session)
      const activeUsers = await prisma.session.findMany({
        select: { userId: true },
        distinct: ['userId'],
        where: { expiresAt: { gt: new Date() } },
      });

      for (const { userId } of activeUsers) {
        await ProactiveEngine.runChecks(userId).catch(err => {
          log.error({ err, userId }, 'Proactive check failed for user');
        });
      }
    } catch (err) {
      log.error({ err }, 'Scheduler tick failed');
    }
  }, CONSTANTS.REMINDER_CHECK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    log.info('Scheduler stopped');
  }
}
