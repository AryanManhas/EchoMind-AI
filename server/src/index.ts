import { env } from './utils/env';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { logger } from './utils/logger';
import prisma from './lib/prisma';
import app from './app';
import { setupNeuralLoop } from './websocket/NeuralLoopHandler';

const server = createServer(app);
const wss = new WebSocketServer({ server });

// ── Database Readiness ──
prisma.$connect()
  .then(() => logger.info('[DEBUG] Database Ready'))
  .catch(err => logger.error({ err }, '[DEBUG] Database Connection Failed'));

// ── Setup Neural Loop WebSocket ──
const { interval } = setupNeuralLoop(wss);

// ── Graceful Shutdown ──
const shutdown = async () => {
  logger.info('[DEBUG] Neural Loop Shutting Down...');
  clearInterval(interval);
  wss.close();
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const PORT = env.PORT;
server.listen(Number(PORT), '0.0.0.0', () => {
  logger.info(`[DEBUG] EchoMind AI Neural Loop active at ws://0.0.0.0:${PORT}`);
});
