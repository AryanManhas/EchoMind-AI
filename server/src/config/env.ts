import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const booleanFlag = z.string().default('false').transform((s) => s === 'true');
const optionalSecret = z.string().optional().default('');

// ─── Environment Schema ───────────────────────────────────────
// Validated at startup. Minimal local mode only requires PORT, NODE_ENV,
// and GEMINI_API_KEY/GOOGLE_API_KEY.
// ────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('8080'),
  CORS_ORIGIN: z.string().default('*'),

  // Process Type (legacy enterprise mode)
  PROCESS_TYPE: z.enum(['web', 'worker', 'all']).default('web'),

  // Enterprise feature gates. All disabled by default for local-first runtime.
  ENABLE_DATABASE: booleanFlag,
  ENABLE_REDIS: booleanFlag,
  ENABLE_QUEUES: booleanFlag,
  ENABLE_WEBSOCKET: booleanFlag,
  ENABLE_SCHEDULER: booleanFlag,

  // Database
  DATABASE_URL: optionalSecret,

  // Redis (for BullMQ)
  REDIS_URL: optionalSecret,

  // AI
  GEMINI_API_KEY: optionalSecret,
  GOOGLE_API_KEY: optionalSecret,

  // Auth
  JWT_SECRET: z.string().default('development-jwt-secret-change-before-production'),
  JWT_REFRESH_SECRET: z.string().default('development-refresh-secret-change-before-production'),
  JWT_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Logging
  LOG_LEVEL: z.string().default('info'),

  // Feature flags
  DEMO_MODE: z.string().default('false').transform((s) => s === 'true'),

  // Deepgram
  DEEPGRAM_API_KEY: optionalSecret,

  // Google Calendar (optional — calendar features disabled if not set)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:');
  console.error(_env.error.format());
  process.exit(1);
}

// ─── Strict Production Guards ─────────────────────────────────
const data = {
  ..._env.data,
  GOOGLE_API_KEY: _env.data.GEMINI_API_KEY || _env.data.GOOGLE_API_KEY,
};

if (data.NODE_ENV === 'production') {
  if (!data.GOOGLE_API_KEY) {
    console.error('❌ GEMINI_API_KEY or GOOGLE_API_KEY is required in production.');
    process.exit(1);
  }

  if (data.ENABLE_REDIS && !data.REDIS_URL) {
    console.error('❌ REDIS_URL is required when ENABLE_REDIS=true.');
    process.exit(1);
  }
  if (data.ENABLE_REDIS && (data.REDIS_URL.includes('localhost') || data.REDIS_URL.includes('127.0.0.1'))) {
    console.error('❌ REDIS_URL cannot point to localhost in production.');
    process.exit(1);
  }
  if (data.ENABLE_DATABASE && !data.DATABASE_URL) {
    console.error('❌ DATABASE_URL is required when ENABLE_DATABASE=true.');
    process.exit(1);
  }
  if (data.ENABLE_DATABASE && (data.DATABASE_URL.includes('localhost') || data.DATABASE_URL.includes('127.0.0.1'))) {
    console.error('❌ DATABASE_URL cannot point to localhost in production.');
    process.exit(1);
  }
}

export const env = data;
export type Env = typeof env;
