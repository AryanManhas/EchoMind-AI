import { z } from 'zod';

// ─── Create Event Schema ──────────────────────────────────────────
export const CreateEventSchema = z.object({
  summary: z.string().min(1, 'Event summary is required'),
  description: z.string().optional(),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().optional(),
  location: z.string().optional(),
  isAllDay: z.boolean().optional(),
  timeZone: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  colorId: z.string().optional(),
});

export type CreateEventRequest = z.infer<typeof CreateEventSchema>;

// ─── Update Event Schema ──────────────────────────────────────────
export const UpdateEventSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  isAllDay: z.boolean().optional(),
  timeZone: z.string().optional(),
});

export type UpdateEventRequest = z.infer<typeof UpdateEventSchema>;

// ─── List Events Query Schema ─────────────────────────────────────
export const ListEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

// ─── OAuth Callback Query Schema ──────────────────────────────────
export const CallbackQuerySchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State (user ID) is required'),
  error: z.string().optional(),
});

export type CallbackQuery = z.infer<typeof CallbackQuerySchema>;
