/**
 * Calendar Routes — Google Calendar OAuth flow + Event CRUD.
 *
 * OAuth Flow:
 *   GET  /api/calendar/connect      → Redirect to Google consent screen
 *   GET  /api/calendar/callback     → OAuth callback (exchanges code for tokens)
 *   GET  /api/calendar/status       → Check if calendar is connected
 *   POST /api/calendar/disconnect   → Revoke and remove tokens
 *
 * Event CRUD (requires connected calendar):
 *   POST   /api/calendar/events     → Create event
 *   PATCH  /api/calendar/events/:id → Update event
 *   DELETE /api/calendar/events/:id → Delete event
 *   GET    /api/calendar/events     → List upcoming events
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { CalendarService } from '../services/calendar.service.js';
import { validate } from '../middleware/validate.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('calendar-routes');
const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────

const CreateEventSchema = z.object({
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

const UpdateEventSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  isAllDay: z.boolean().optional(),
  timeZone: z.string().optional(),
});

// ─── Middleware: Guard for unconfigured Calendar ──────────────────

function requireCalendarConfigured(_req: Request, res: Response, next: Function) {
  if (!CalendarService.isConfigured()) {
    res.status(501).json({
      success: false,
      error: {
        code: 'CALENDAR_NOT_CONFIGURED',
        message: 'Google Calendar integration is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env',
      },
    });
    return;
  }
  next();
}

// Apply to all routes in this router
router.use(requireCalendarConfigured);

// ─── OAuth Flow ───────────────────────────────────────────────────

/**
 * GET /api/calendar/connect
 * Initiates the OAuth flow. Returns the Google consent URL.
 * Mobile app opens this URL in an in-app browser.
 */
router.get('/connect', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const authUrl = CalendarService.getAuthUrl(userId);

  res.json({
    success: true,
    data: { url: authUrl },
  });
});

/**
 * GET /api/calendar/callback
 * Google redirects here after user grants consent.
 * Exchanges the authorization code for tokens and stores them.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    log.warn({ error }, 'User denied calendar access');
    // Redirect to a mobile deep link with error state
    res.redirect(`echomind://calendar/error?reason=${error}`);
    return;
  }

  if (!code || !userId || typeof code !== 'string' || typeof userId !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_CALLBACK', message: 'Missing code or state parameter' },
    });
    return;
  }

  try {
    await CalendarService.handleCallback(code, userId);

    // Success! Redirect to mobile deep link.
    // In dev, serve an HTML success page instead.
    const successHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>EchoMind - Calendar Connected</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; margin: 0;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            color: #fff;
          }
          .card {
            text-align: center; padding: 3rem; border-radius: 1.5rem;
            background: rgba(255,255,255,0.08); backdrop-filter: blur(16px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.37);
          }
          .check { font-size: 4rem; margin-bottom: 1rem; }
          h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
          p { opacity: 0.7; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="check">✅</div>
          <h1>Google Calendar Connected!</h1>
          <p>You can close this window and return to EchoMind.</p>
          <p style="margin-top: 1rem; font-size: 0.9rem; opacity: 0.5;">
            Events will now sync automatically when EchoMind detects dates and meetings.
          </p>
        </div>
        <script>
          // Try to redirect to the app via deep link after a short delay
          setTimeout(() => { window.location.href = 'echomind://calendar/connected'; }, 2000);
        </script>
      </body>
      </html>
    `;
    res.type('html').send(successHtml);
  } catch (err: any) {
    log.error({ err, userId }, 'Calendar OAuth callback failed');
    res.status(500).json({
      success: false,
      error: { code: 'OAUTH_EXCHANGE_FAILED', message: err.message },
    });
  }
});

/**
 * GET /api/calendar/status
 * Check if the current user has connected Google Calendar.
 */
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const isConnected = await CalendarService.isConnected(req.user!.userId);
  res.json({ success: true, data: { connected: isConnected, provider: 'google' } });
});

/**
 * POST /api/calendar/disconnect
 * Revoke Google Calendar access and delete stored tokens.
 */
router.post('/disconnect', requireAuth, async (req: Request, res: Response) => {
  await CalendarService.disconnect(req.user!.userId);
  res.json({ success: true, data: { message: 'Google Calendar disconnected' } });
});

// ─── Event CRUD ───────────────────────────────────────────────────

/**
 * POST /api/calendar/events
 * Create a new calendar event.
 */
router.post('/events', requireAuth, validate(CreateEventSchema), async (req: Request, res: Response) => {
  try {
    const event = await CalendarService.createEvent(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: event });
  } catch (err: any) {
    if (err.message?.includes('not connected')) {
      res.status(403).json({
        success: false,
        error: { code: 'CALENDAR_NOT_CONNECTED', message: err.message },
      });
      return;
    }
    throw err;
  }
});

/**
 * GET /api/calendar/events
 * List upcoming calendar events.
 */
router.get('/events', requireAuth, async (req: Request, res: Response) => {
  const maxResults = Math.min(Number(req.query.limit) || 10, 50);

  try {
    const events = await CalendarService.listUpcomingEvents(req.user!.userId, maxResults);
    res.json({ success: true, data: events });
  } catch (err: any) {
    if (err.message?.includes('not connected')) {
      res.status(403).json({
        success: false,
        error: { code: 'CALENDAR_NOT_CONNECTED', message: err.message },
      });
      return;
    }
    throw err;
  }
});

/**
 * PATCH /api/calendar/events/:eventId
 * Update an existing calendar event.
 */
router.patch('/events/:eventId', requireAuth, validate(UpdateEventSchema), async (req: Request, res: Response) => {
  const event = await CalendarService.updateEvent(req.user!.userId, req.params.eventId as string, req.body);
  res.json({ success: true, data: event });
});

/**
 * DELETE /api/calendar/events/:eventId
 * Delete a calendar event.
 */
router.delete('/events/:eventId', requireAuth, async (req: Request, res: Response) => {
  await CalendarService.deleteEvent(req.user!.userId, req.params.eventId as string);
  res.json({ success: true, data: { message: 'Event deleted' } });
});

export default router;
