import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8080'),
  DATABASE_URL: z.string().url(),
  GOOGLE_API_KEY: z.string().min(1, 'Google API Key is required'),
  WHISPER_URL: z.string().url().default('http://localhost:8000/asr'),
  LOG_LEVEL: z.string().default('info'),
  DEMO_MODE: z.string().default('false').transform((s) => s === 'true'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
