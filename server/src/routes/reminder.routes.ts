import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { ReminderService } from '../reminders/reminder.service.js';
import { UpdateReminderStatusSchema, SnoozeReminderSchema, GetUpcomingRemindersSchema } from '@echomind/types';
import { rateLimiter } from '../middleware/rate-limiter.js';

const router = Router();

// Apply rate limiting to all reminder endpoints
router.use(rateLimiter());

// ─── GET /api/reminders ───────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const reminders = await ReminderService.getAll(userId);
  res.json({ success: true, data: { reminders } });
});

// ─── GET /api/reminders/upcoming ──────────────────────────────
router.get('/upcoming', requireAuth, validate(GetUpcomingRemindersSchema, 'query'), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { window } = req.query as any;
  const reminders = await ReminderService.getUpcoming(userId, window);
  res.json({ success: true, data: { reminders } });
});

// ─── PATCH /api/reminders/:id/status ──────────────────────────
router.patch('/:id/status', requireAuth, validate(UpdateReminderStatusSchema), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await ReminderService.updateStatus(userId, req.params.id as string, req.body.status);
  res.json({ success: true });
});

// ─── POST /api/reminders/:id/snooze ───────────────────────────
router.post('/:id/snooze', requireAuth, validate(SnoozeReminderSchema), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await ReminderService.snooze(userId, req.params.id as string, req.body.minutes);
  res.json({ success: true });
});

// ─── POST /api/reminders/:id/complete ─────────────────────────
router.post('/:id/complete', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await ReminderService.complete(userId, req.params.id as string);
  res.json({ success: true });
});

// ─── DELETE /api/reminders/:id ────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await ReminderService.delete(userId, req.params.id as string);
  res.json({ success: true });
});

export default router;

