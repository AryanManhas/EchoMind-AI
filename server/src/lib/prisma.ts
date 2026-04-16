import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

let prisma: PrismaClient;

try {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('[ERROR] DATABASE_URL is missing in environment variables.');
    // Fail-safe initialization to avoid crashing on import if desired, 
    // though the error above will be clear.
    prisma = new PrismaClient();
  } else {
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    prisma =
      globalForPrisma.prisma ||
      new PrismaClient({
        adapter,
        log: ['query', 'info', 'warn', 'error'],
      });

    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
  }
} catch (error) {
  console.error('[ERROR] Failed to instantiate Prisma Client with Driver Adapter:', error);
  prisma = new PrismaClient();
}

export default prisma;
