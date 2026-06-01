import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import geminiRoutes from './routes/gemini.routes.js';

/**
 * Creates and configures the Express application.
 * Separated from server start for testability.
 */
export async function createApp() {
  const app = express();

  // ─── Security ───────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    credentials: true,
  }));

  // ─── Parsing ────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Logging ────────────────────────────────────────────────
  app.use(requestLogger);

  // ─── Rate Limiting ──────────────────────────────────────────
  app.use(rateLimiter());

  // ─── Health / Handshake Check ───────────────────────────────
  const health = (_req: express.Request, res: express.Response) => {
    res.json({ 
      status: 'ok', 
      gemini: Boolean(env.GOOGLE_API_KEY), 
      runtime: 'local',
      version: '1.x',
      features: {
        semanticMemory: env.ENABLE_QUEUES,
        proactiveAssistant: env.ENABLE_SCHEDULER,
        meetingIntelligence: true,
      }
    });
  };

  app.get('/health', health);
  app.get('/api/health', health);

  // ─── Minimal Gemini Routes ──────────────────────────────────
  app.use('/', geminiRoutes);
  app.use('/api', geminiRoutes);

  // ─── Optional Enterprise Routes ─────────────────────────────
  // We now mount these unconditionally so the mobile app gets a 200 or 503
  // rather than a 404 when the database is offline.
  const [
    { default: authRoutes },
    { default: reminderRoutes },
    { default: calendarRoutes },
    { default: syncRoutes },
    { default: memoryRoutes }
  ] = await Promise.all([
    import('./routes/auth.routes.js'),
    import('./routes/reminder.routes.js'),
    import('./routes/calendar.routes.js'),
    import('./routes/sync.routes.js'),
    import('./routes/memory.routes.js'),
  ]);

  app.use('/api/auth', authRoutes);
  app.use('/api/reminders', reminderRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/memories', memoryRoutes);

  // ─── 404 Handler ────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  // ─── Error Handler (MUST be last) ──────────────────────────
  app.use(errorHandler);

  return app;
}
