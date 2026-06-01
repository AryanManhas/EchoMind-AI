import { z } from 'zod';

// ─── Reminder Priority ────────────────────────────────────────
export const ReminderPriorityEnum = z.enum(['low', 'medium', 'high']);
export type ReminderPriority = z.infer<typeof ReminderPriorityEnum>;

// ─── Reminder Status ──────────────────────────────────────────
export const ReminderStatusEnum = z.enum([
  'pending', 'completed', 'missed', 'snoozed', 'cancelled',
]);
export type ReminderStatus = z.infer<typeof ReminderStatusEnum>;

// ─── Reminder Category ────────────────────────────────────────
export const ReminderCategoryEnum = z.enum([
  'work', 'health', 'meeting', 'personal', 'study', 'family', 'payment', 'errands',
]);
export type ReminderCategory = z.infer<typeof ReminderCategoryEnum>;

// ─── Reminder Extraction (from AI) ────────────────────────────
export const ReminderExtractionSchema = z.object({
  title: z.string().min(1, 'Reminder title is required'),
  description: z.string().optional(),
  dueAt: z.string().describe('ISO 8601 date string'),
  category: z.string().default('personal'),
  priority: ReminderPriorityEnum.default('medium'),
  repeatRule: z.string().optional().nullable(),
  isCritical: z.boolean().default(false),
});

export type ReminderExtraction = z.infer<typeof ReminderExtractionSchema>;

// ─── Reminder Record (from DB) ────────────────────────────────
export interface Reminder {
  id: string;
  userId: string;
  memoryId: string | null;
  title: string;
  description: string | null;
  dueAt: Date;
  category: string;
  priority: ReminderPriority;
  repeatRule: string | null;
  status: ReminderStatus;
  advanceOffsets: number[];
  completedAt: Date | null;
  snoozedUntil: Date | null;
  isCritical: boolean;
  confidence: number;
  escalationLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Update Reminder Status ───────────────────────────────────
export const UpdateReminderStatusSchema = z.object({
  status: ReminderStatusEnum,
});

// ─── Snooze Reminder ──────────────────────────────────────────
export const SnoozeReminderSchema = z.object({
  minutes: z.coerce.number().int().positive().max(1440).default(10),
});

// ─── Get Upcoming Reminders Query ─────────────────────────────
export const GetUpcomingRemindersSchema = z.object({
  window: z.coerce.number().int().positive().default(30),
});

export type GetUpcomingRemindersRequest = z.infer<typeof GetUpcomingRemindersSchema>;

