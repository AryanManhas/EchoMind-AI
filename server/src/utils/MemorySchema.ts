import { z } from 'zod';

export const MemoryCategoryEnum = z.enum([
  'Task', 'Fact', 'Idea', 
  'conversational', 'reminder', 'meeting_action', 
  'personal_fact', 'ephemeral_context', 'semantic_observation'
]);

export const ReminderSchema = z.object({
  title: z.string().min(1, "Reminder title is required"),
  description: z.string().optional(),
  dueAt: z.string().describe("ISO 8601 date string for when the reminder is due"),
  category: z.string().describe("One of: work, health, meeting, personal, study, family, payment, errands"),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  repeatRule: z.string().nullable().optional().describe("daily, weekly, monthly, weekdays, or null"),
  isCritical: z.boolean().default(false)
});

export const MemoryExtractionSchema = z.object({
  title: z.string().min(1, "Title is required").describe("A concise, declarative title."),
  summary: z.string().min(1, "Summary is required").describe("A concise, present-tense, actionable summary in Second Brain style."),
  projects: z.array(z.string()).optional().default([]),
  participants: z.array(z.string()).optional().default([]),
  category: MemoryCategoryEnum,
  importance: z.number().min(0).max(1).describe("Importance score from 0.0 to 1.0."),
  reminderConfidence: z.number().min(0).max(1).optional().default(0),
  taskConfidence: z.number().min(0).max(1).optional().default(0),
  conversationalConfidence: z.number().min(0).max(1).optional().default(0),
  meetingConfidence: z.number().min(0).max(1).optional().default(0),
  reminders: z.array(z.object({
    description: z.string(),
    due_date: z.string().describe("ISO8601_string")
  })).optional().default([]),
});

export type MemoryExtraction = z.infer<typeof MemoryExtractionSchema>;
export type ReminderExtraction = z.infer<typeof ReminderSchema>;

