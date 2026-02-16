import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url(),
  AUTH_SESSION_SECRET: z.string().min(32, 'AUTH_SESSION_SECRET must be at least 32 characters'),
  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  ENTRA_REDIRECT_PATH: z.string().min(1).default('/auth/callback'),
  AZURE_SQL_SERVER: z.string().min(1),
  AZURE_SQL_DATABASE: z.string().min(1),
  AZURE_STORAGE_ACCOUNT_NAME: z.string().min(3),
  AZURE_STORAGE_CONTAINER: z.string().min(1).default('videos'),
  PROCESSOR_BASE_URL: z.string().url(),
  PROCESSOR_WEBHOOK_SECRET: z.string().min(24),
  APPINSIGHTS_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_ACCOUNT_KEY: z.string().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
});

export type FrontendServerEnv = z.infer<typeof envSchema>;

let cachedEnv: FrontendServerEnv | null = null;

export function getServerEnv(): FrontendServerEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[Startup] Invalid frontend environment configuration');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Frontend environment validation failed');
  }

  if (parsed.data.AZURE_STORAGE_ACCOUNT_KEY || parsed.data.AZURE_STORAGE_CONNECTION_STRING) {
    throw new Error(
      'Shared-key Azure Storage vars are forbidden. Use managed identity only (AZURE_STORAGE_ACCOUNT_NAME).'
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
