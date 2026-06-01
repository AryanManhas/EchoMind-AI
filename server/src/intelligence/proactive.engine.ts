import { createLogger } from '../utils/logger.js';
import prisma from '../db/prisma.js';
import { enqueueNotification } from '../queues/notification.queue.js';

const log = createLogger('proactive');

/**
 * Proactive Intelligence Engine — Queryless mode.
 * Scans for:
 * 1. Approaching deadlines
 * 2. Missed follow-ups
 * 3. High-importance unactioned tasks
 * 4. Recurring reminder triggers
 *
 * Called periodically by the scheduler (every 5 minutes).
 */
export class ProactiveEngine {
  /**
   * Run all proactive checks for a user.
   */
  static async runChecks(userId: string): Promise<void> {
    await Promise.allSettled([
      this.checkApproachingDeadlines(userId),
      this.checkMissedFollowups(userId),
      this.checkHighPriorityUnactioned(userId),
      this.checkSnoozedReminders(userId),
    ]);
  }

  /**
   * Check for reminders approaching their due time.
   * Sends advance notifications at configured offset intervals.
   */
  static async checkApproachingDeadlines(userId: string): Promise<void> {
    const now = new Date();
    const windowMs = 60 * 60 * 1000; // 1 hour lookahead
    const futureWindow = new Date(now.getTime() + windowMs);

    const upcoming = await prisma.reminder.findMany({
      where: {
        userId,
        status: 'pending',
        dueAt: { gte: now, lte: futureWindow },
      },
      include: { memory: true },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pushToken) return;

    for (const reminder of upcoming) {
      const minutesUntilDue = (reminder.dueAt.getTime() - now.getTime()) / 60_000;
      const shouldNotify = reminder.advanceOffsets.some(
        (offset: number) => Math.abs(minutesUntilDue - offset) < 3 // 3-minute tolerance
      );

      if (shouldNotify) {
        await enqueueNotification({
          userId,
          pushToken: user.pushToken,
          title: reminder.isCritical ? `🚨 ${reminder.title}` : `⏰ ${reminder.title}`,
          body: reminder.description || `Due in ${Math.round(minutesUntilDue)} minutes`,
          data: { type: 'reminder', reminderId: reminder.id },
        });

        // Escalate if critical
        if (reminder.isCritical && minutesUntilDue <= 5) {
          await prisma.reminder.update({
            where: { id: reminder.id },
            data: { escalationLevel: { increment: 1 } },
          });
        }

        log.info({ reminderId: reminder.id, minutesUntilDue: Math.round(minutesUntilDue) }, 'Advance notification sent');
      }
    }
  }

  /**
   * Detect missed follow-ups: high-importance tasks older than 24h with no action.
   */
  static async checkMissedFollowups(userId: string): Promise<void> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const missedTasks = await prisma.memory.findMany({
      where: {
        userId,
        category: 'Task',
        importance: { gte: 0.7 },
        createdAt: { lte: twentyFourHoursAgo },
        deletedAt: null,
        reminders: {
          none: { status: 'completed' },
        },
      },
      take: 5,
      orderBy: { importance: 'desc' },
    });

    if (missedTasks.length === 0) return;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pushToken) return;

    const taskList = missedTasks.map((t: { title: string }) => `• ${t.title}`).join('\n');

    await enqueueNotification({
      userId,
      pushToken: user.pushToken,
      title: '📋 Pending Follow-ups',
      body: `You have ${missedTasks.length} important tasks without action:\n${taskList}`,
      data: { type: 'followup', memoryIds: missedTasks.map((t: { id: string }) => t.id) },
    });

    log.info({ userId, count: missedTasks.length }, 'Follow-up notification sent');
  }

  /**
   * Check for high-priority tasks that haven't been actioned.
   */
  static async checkHighPriorityUnactioned(userId: string): Promise<void> {
    const overdue = await prisma.reminder.findMany({
      where: {
        userId,
        status: 'pending',
        priority: 'high',
        dueAt: { lte: new Date() },
      },
      take: 5,
    });

    if (overdue.length === 0) return;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pushToken) return;

    for (const reminder of overdue) {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'missed', escalationLevel: { increment: 1 } },
      });

      await enqueueNotification({
        userId,
        pushToken: user.pushToken,
        title: `⚠️ Missed: ${reminder.title}`,
        body: reminder.description || 'This high-priority task is overdue.',
        data: { type: 'missed_reminder', reminderId: reminder.id },
      });
    }
  }

  /**
   * Re-activate snoozed reminders that have passed their snooze-until time.
   */
  static async checkSnoozedReminders(userId: string): Promise<void> {
    const reactivated = await prisma.reminder.updateMany({
      where: {
        userId,
        status: 'snoozed',
        snoozedUntil: { lte: new Date() },
      },
      data: { status: 'pending', snoozedUntil: null },
    });

    if (reactivated.count > 0) {
      log.info({ userId, count: reactivated.count }, 'Snoozed reminders reactivated');
    }
  }
}
