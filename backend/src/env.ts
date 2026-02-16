import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  WEBHOOK_SECRET: z.string().min(24, 'WEBHOOK_SECRET must be at least 24 characters'),
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_API_KEY: z.string().min(20),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1).default('gpt-4o-vision'),
  AZURE_OPENAI_API_VERSION: z.string().min(1).default('2024-02-15-preview'),
  AZURE_SQL_SERVER: z.string().min(1),
  AZURE_SQL_DATABASE: z.string().min(1),
  AZURE_STORAGE_ACCOUNT_NAME: z.string().min(3),
  AZURE_STORAGE_CONTAINER: z.string().min(1).default('videos'),
  PROCESSOR_WORKER_ID: z.string().min(1).default('worker-local'),
  APPINSIGHTS_CONNECTION_STRING: z.string().optional(),
  FFMPEG_PATH: z.string().optional(),
  AZURE_STORAGE_ACCOUNT_KEY: z.string().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
});

export type RuntimeEnv = z.infer<typeof envSchema>;

let cachedEnv: RuntimeEnv | null = null;

export function getEnv(): RuntimeEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[Startup] Invalid backend environment configuration');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Backend environment validation failed');
  }

  if (parsed.data.AZURE_STORAGE_ACCOUNT_KEY || parsed.data.AZURE_STORAGE_CONNECTION_STRING) {
    throw new Error(
      'Shared-key Azure Storage vars are forbidden. Use managed identity only (AZURE_STORAGE_ACCOUNT_NAME).'
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
