import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { createLogger } from '../utils/logger.js';
import ws from 'ws';
import { env } from '../config/env.js';

// ─── Enable WebSocket connection for port 443 ─────────────────
neonConfig.webSocketConstructor = ws;

const log = createLogger('prisma');

const globalForPrisma = global as unknown as { prisma: PrismaClient };

let prisma: PrismaClient;

try {
  const connectionString = env.DATABASE_URL;
  
  if (globalForPrisma.prisma) {
    prisma = globalForPrisma.prisma;
    log.info('Using existing Prisma Client from global cache');
  } else {
    log.info({ 
      hasConnectionString: !!connectionString,
      connectionStringPrefix: connectionString?.substring(0, 20) + '...'
    }, 'Instantiating Prisma with Neon adapter');

    // For Prisma 7+, PrismaNeon acts as a factory. Pass the config directly.
    // We limit the pool size to avoid exhausting Neon connections on smaller plans.
    const adapter = new PrismaNeon({
      connectionString,
      max: 10, // Max concurrent connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    prisma = new PrismaClient({
      adapter,
      log: env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['query', 'info', 'warn', 'error'],
    });

    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = prisma;
    }
  }
} catch (error) {
  log.error({ error }, 'Failed to instantiate Prisma Client');
  throw error;
}

export default prisma;
