import { createLogger } from '../utils/logger.js';
import prisma from '../db/prisma.js';
import type { ReminderExtraction } from '@echomind/types';

const log = createLogger('reminder');

const localReminders: any[] = [];

/**
 * Reminder service — CRUD, scheduling, and status management.
 */
export class ReminderService {
  /**
   * Create a reminder linked to a memory.
   */
  static async createReminder(
    userId: string,
    memoryId: string,
    extraction: ReminderExtraction,
  ) {
    if ((global as any).__dbFallback) {
      const reminder = {
        id: Math.random().toString(36).substring(7),
        userId,
        memoryId,
        title: extraction.title,
        description: extraction.description || null,
        dueAt: new Date(extraction.dueAt),
        category: extraction.category,
        priority: extraction.priority,
        repeatRule: extraction.repeatRule || null,
        isCritical: extraction.isCritical || false,
        status: 'pending',
        advanceOffsets: [30, 15, 5],
        createdAt: new Date(),
      };
      localReminders.push(reminder);
      return reminder;
    }
    const reminder = await prisma.reminder.create({
      data: {
        userId,
        memoryId,
        title: extraction.title,
        description: extraction.description || null,
        dueAt: new Date(extraction.dueAt),
        category: extraction.category,
        priority: extraction.priority,
        repeatRule: extraction.repeatRule || null,
        isCritical: extraction.isCritical || false,
        status: 'pending',
        advanceOffsets: [30, 15, 5],
      },
    });

    log.info({ reminderId: reminder.id, memoryId }, 'Reminder created');
    return reminder;
  }

  /**
   * Get upcoming reminders within a time window for a user.
   */
  static async getUpcoming(userId: string, windowMinutes: number = 30) {
    if ((global as any).__dbFallback) {
      const now = new Date();
      const future = new Date(now.getTime() + windowMinutes * 60_000);
      return localReminders.filter(r => r.userId === userId && r.status === 'pending' && r.dueAt >= now && r.dueAt <= future).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    }
    const now = new Date();
    const future = new Date(now.getTime() + windowMinutes * 60_000);

    return prisma.reminder.findMany({
      where: {
        userId,
        status: 'pending',
        dueAt: { gte: now, lte: future },
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  /**
   * Get all reminders for a user.
   */
  static async getAll(userId: string) {
    if ((global as any).__dbFallback) {
      return localReminders.filter(r => r.userId === userId).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    }
    return prisma.reminder.findMany({
      where: { userId },
      orderBy: { dueAt: 'asc' },
      include: { memory: true },
    });
  }

  /**
   * Mark reminder as completed.
   */
  static async complete(userId: string, id: string) {
    if ((global as any).__dbFallback) {
      const reminder = localReminders.find(r => r.id === id && r.userId === userId);
      if (reminder) {
        reminder.status = 'completed';
        reminder.completedAt = new Date();
      }
      return { count: reminder ? 1 : 0 };
    }
    return prisma.reminder.updateMany({
      where: { id, userId },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  /**
   * Snooze reminder by N minutes.
   */
  static async snooze(userId: string, id: string, minutes: number = 10) {
    if ((global as any).__dbFallback) {
      const snoozedUntil = new Date(Date.now() + minutes * 60_000);
      const reminder = localReminders.find(r => r.id === id && r.userId === userId);
      if (reminder) {
        reminder.status = 'snoozed';
        reminder.snoozedUntil = snoozedUntil;
      }
      return { count: reminder ? 1 : 0 };
    }
    const snoozedUntil = new Date(Date.now() + minutes * 60_000);
    return prisma.reminder.updateMany({
      where: { id, userId },
      data: { status: 'snoozed', snoozedUntil },
    });
  }

  /**
   * Update reminder status.
   */
  static async updateStatus(userId: string, id: string, status: string) {
    if ((global as any).__dbFallback) {
      const reminder = localReminders.find(r => r.id === id && r.userId === userId);
      if (reminder) {
        reminder.status = status;
        reminder.completedAt = status === 'completed' ? new Date() : null;
      }
      return { count: reminder ? 1 : 0 };
    }
    return prisma.reminder.updateMany({
      where: { id, userId },
      data: {
        status,
        completedAt: status === 'completed' ? new Date() : null,
      },
    });
  }

  /**
   * Update an existing reminder.
   */
  static async updateReminder(
    userId: string,
    id: string,
    extraction: ReminderExtraction,
  ) {
    if ((global as any).__dbFallback) {
      const reminder = localReminders.find(r => r.id === id && r.userId === userId);
      if (reminder) {
        reminder.title = extraction.title;
        reminder.description = extraction.description || null;
        reminder.dueAt = new Date(extraction.dueAt);
        reminder.category = extraction.category;
        reminder.priority = extraction.priority;
        reminder.repeatRule = extraction.repeatRule || null;
        reminder.isCritical = extraction.isCritical || false;
        reminder.status = 'pending';
      }
      return reminder || null;
    }
    const reminder = await prisma.reminder.update({
      where: { id },
      data: {
        title: extraction.title,
        description: extraction.description || null,
        dueAt: new Date(extraction.dueAt),
        category: extraction.category,
        priority: extraction.priority,
        repeatRule: extraction.repeatRule || null,
        isCritical: extraction.isCritical || false,
        status: 'pending',
      },
    });

    log.info({ reminderId: reminder.id }, 'Reminder updated');
    return reminder;
  }

  /**
   * Delete a reminder (hard delete).
   */
  static async delete(userId: string, id: string) {
    if ((global as any).__dbFallback) {
      const idx = localReminders.findIndex(r => r.id === id && r.userId === userId);
      if (idx !== -1) localReminders.splice(idx, 1);
      return { count: idx !== -1 ? 1 : 0 };
    }
    return prisma.reminder.deleteMany({ where: { id, userId } });
  }
}
