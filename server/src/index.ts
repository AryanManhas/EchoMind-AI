import { env } from './config/env.js';

import { createServer } from 'http';
import { createLogger } from './utils/logger.js';
import { createApp } from './app.js';

// ─── Entry Point ─────────────────────────────────────────────
const log = createLogger('server');

async function checkRedisConnection() {
  const [{ Redis }, { getRedisConnection }] = await Promise.all([
    import('ioredis'),
    import('./queues/queue.factory.js'),
  ]);

  return new Promise<void>((resolve, reject) => {
    const config = getRedisConnection() as any;
    const redis = new Redis(config.port, config.host, {
      password: config.password,
      username: config.username,
      tls: config.tls,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });

    redis.on('ready', () => {
      redis.disconnect();
      resolve();
    });

    redis.on('error', (err: Error) => {
      redis.disconnect();
      reject(err);
    });
  });
}

async function start() {
  log.info({
    processType: env.PROCESS_TYPE,
    runtime: 'minimal',
    features: {
      database: env.ENABLE_DATABASE,
      redis: env.ENABLE_REDIS,
      queues: env.ENABLE_QUEUES,
      websocket: env.ENABLE_WEBSOCKET,
      scheduler: env.ENABLE_SCHEDULER,
    },
  }, 'Starting EchoMind process');

  let prisma: Awaited<typeof import('./db/prisma.js')>['default'] | null = null;

  // 1. ─── Database Validation ───────────────────────────────────────
  if (env.ENABLE_DATABASE) {
    try {
      log.info('Connecting to Database...');
      prisma = (await import('./db/prisma.js')).default;
      await prisma.$connect();
      // Verify reachability
      await prisma.$queryRaw`SELECT 1`;
      log.info('✅ Database connected');
    } catch (err) {
      log.error({ err }, '❌ Failed to connect to database — falling back to local storage');
      (global as any).__dbFallback = true;
    }
  } else {
    log.info('Database disabled by ENABLE_DATABASE=false');
    (global as any).__dbFallback = true;
  }

  // 2. ─── Redis Validation ──────────────────────────────────────────
  if (env.ENABLE_REDIS || env.ENABLE_QUEUES) {
    try {
      log.info('Connecting to Redis...');
      await checkRedisConnection();
      log.info('✅ Redis connected');
    } catch (err) {
      log.error({ err }, '❌ Failed to connect to Redis — disabling queues');
      (global as any).__redisFallback = true;
      // Forcefully disable queues to fallback to inline execution
      (env as any).ENABLE_QUEUES = false;
      (env as any).ENABLE_REDIS = false;
    }
  } else {
    log.info('Redis disabled by ENABLE_REDIS=false and ENABLE_QUEUES=false');
  }

  const isWeb = env.PROCESS_TYPE === 'web' || env.PROCESS_TYPE === 'all';
  const isWorker = env.ENABLE_QUEUES && (env.PROCESS_TYPE === 'worker' || env.PROCESS_TYPE === 'all');

  if (isWeb) {
    // 3. ─── Express App ────────────────────────────────────────────
    const app = await createApp();
    const server = createServer(app);
    let webSocketCleanup: (() => void) | null = null;

    // 4. ─── WebSocket ──────────────────────────────────────────────
    if (env.ENABLE_WEBSOCKET) {
      const [{ WebSocketServer }, { setupWebSocket }, { AuthService }] = await Promise.all([
        import('ws'),
        import('./websocket/handler.js'),
        import('./auth/auth.service.js'),
      ]);

      const wss = new WebSocketServer({ noServer: true });

      server.on('upgrade', (request, socket, head) => {
        try {
          const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
          const token = url.searchParams.get('token');

          if (!token) {
            log.warn('WS upgrade request missing token');
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }

          const user = AuthService.verifyAccessToken(token);
          (request as any).user = user;

          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        } catch (err) {
          log.warn({ err }, 'WS upgrade authentication failed');
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
        }
      });

      const { interval } = setupWebSocket(wss);
      webSocketCleanup = () => {
        clearInterval(interval);
        wss.close(() => log.info('WebSocket server closed'));
      };
    } else {
      log.info('WebSocket startup disabled by ENABLE_WEBSOCKET=false');
    }

    // 5. ─── Start Web Server ───────────────────────────────────────
    const PORT = Number(env.PORT);
    server.listen(PORT, '0.0.0.0', () => {
      log.info({
        port: PORT,
        env: env.NODE_ENV,
        demoMode: env.DEMO_MODE,
        runtime: 'minimal',
        features: {
          web: true,
          database: env.ENABLE_DATABASE,
          redis: env.ENABLE_REDIS,
          queues: env.ENABLE_QUEUES,
          websocket: env.ENABLE_WEBSOCKET,
          bilingual: ['en', 'hi', 'hi-en'],
        },
      }, `✅ EchoMind API server listening on port ${PORT}`);
    });

    // Handle graceful shutdown for web
    const shutdownWeb = async (signal: string) => {
      log.info({ signal }, 'Web shutdown signal received');
      webSocketCleanup?.();
      await prisma?.$disconnect();
      server.close(() => {
        log.info('HTTP server closed');
        process.exit(0);
      });
    };
    process.on('SIGINT', () => shutdownWeb('SIGINT'));
    process.on('SIGTERM', () => shutdownWeb('SIGTERM'));
  }

  if (isWorker) {
    log.info('Starting background workers and scheduler');
    
    // 6. ─── Background Workers ───────────────────────────────────────
    // Dynamic import to avoid starting workers in web process before Redis is checked
    await import('./queues/embedding.queue.js');
    await import('./queues/notification.queue.js');
    await import('./queues/ai-processing.queue.js');

    let stopScheduler: (() => void) | null = null;
    if (env.ENABLE_SCHEDULER) {
      const scheduler = await import('./intelligence/scheduler.js');
      scheduler.startScheduler();
      stopScheduler = scheduler.stopScheduler;
    } else {
      log.info('Scheduler startup disabled by ENABLE_SCHEDULER=false');
    }

    log.info({
      queues: ['embedding', 'notification', 'ai-processing'],
    }, '✅ Background workers active');

    // Handle graceful shutdown for worker
    const shutdownWorker = async (signal: string) => {
      log.info({ signal }, 'Worker shutdown signal received');
      stopScheduler?.();
      await prisma?.$disconnect();
      process.exit(0);
    };
    
    // Only register these if not already registered by web (to avoid double handling in 'all' mode)
    if (env.PROCESS_TYPE === 'worker') {
      process.on('SIGINT', () => shutdownWorker('SIGINT'));
      process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
    }
  }

  // ─── Uncaught Error Handlers ────────────────────────────────
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    log.error({ reason }, 'Unhandled rejection');
  });
}

start().catch((err) => {
  log.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
