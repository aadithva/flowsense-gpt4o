import { z } from 'zod';
import {
  ANALYSIS_ENGINE_VERSIONS,
  DEFAULT_ANALYSIS_CONFIG,
  type AnalysisEngineConfig,
  DEFAULT_PREPROCESSING_CONFIG,
  type PreprocessingConfig,
  DEFAULT_TWO_PASS_CONFIG,
  type TwoPassConfig,
} from '@interactive-flow/shared';

const engineVersionEnum = z.enum([
  ANALYSIS_ENGINE_VERSIONS.V2_BASELINE,
  ANALYSIS_ENGINE_VERSIONS.V3_HYBRID,
]);

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

  // V3 Accuracy Upgrade - Analysis Engine Configuration
  ANALYSIS_ENGINE_ACTIVE: engineVersionEnum.default(DEFAULT_ANALYSIS_CONFIG.activeEngine),
  ANALYSIS_ENGINE_SHADOW: engineVersionEnum.optional(),
  ANALYSIS_SHADOW_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(DEFAULT_ANALYSIS_CONFIG.shadowSampleRate),
  ANALYSIS_TOKEN_HARD_CAP_TOTAL: z.coerce.number().int().positive().default(DEFAULT_ANALYSIS_CONFIG.tokenHardCapTotal),
  ANALYSIS_TOKEN_HARD_CAP_PER_FRAME: z.coerce.number().int().positive().default(DEFAULT_ANALYSIS_CONFIG.tokenHardCapPerFrame),

  // V3 Accuracy Upgrade - Preprocessing Configuration (Day 3-4)
  PREPROCESSING_ENABLE_CHANGE_DETECTION: z.coerce.boolean().default(DEFAULT_PREPROCESSING_CONFIG.enableChangeDetection),
  PREPROCESSING_CHANGE_GRID_ROWS: z.coerce.number().int().min(2).max(8).default(DEFAULT_PREPROCESSING_CONFIG.changeDetectionGridRows),
  PREPROCESSING_CHANGE_GRID_COLS: z.coerce.number().int().min(2).max(8).default(DEFAULT_PREPROCESSING_CONFIG.changeDetectionGridCols),
  PREPROCESSING_MIN_REGION_INTENSITY: z.coerce.number().min(0).max(1).default(DEFAULT_PREPROCESSING_CONFIG.minRegionIntensity),
  PREPROCESSING_PIXEL_DIFF_THRESHOLD: z.coerce.number().int().min(1).max(255).default(DEFAULT_PREPROCESSING_CONFIG.pixelDiffThreshold),
  PREPROCESSING_CHANGE_ANALYSIS_SIZE: z.coerce.number().int().min(64).max(512).default(DEFAULT_PREPROCESSING_CONFIG.changeAnalysisSize),
  PREPROCESSING_INCLUDE_CHANGE_CONTEXT: z.coerce.boolean().default(DEFAULT_PREPROCESSING_CONFIG.includeChangeContext),

  // V3 Accuracy Upgrade - Two-Pass Inference Configuration (Day 5-6)
  TWO_PASS_ENABLE: z.coerce.boolean().default(DEFAULT_TWO_PASS_CONFIG.enableTwoPass),
  TWO_PASS_MAX_RERUNS: z.coerce.number().int().min(0).max(5).default(DEFAULT_TWO_PASS_CONFIG.maxRerunsPerFrame),
  TWO_PASS_SCHEMA_COERCION_THRESHOLD: z.coerce.number().min(0).max(1).default(DEFAULT_TWO_PASS_CONFIG.schemaCoercionThreshold),
  TWO_PASS_MIN_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(DEFAULT_TWO_PASS_CONFIG.minConfidenceThreshold),
  TWO_PASS_A_TOKEN_BUDGET: z.coerce.number().int().positive().default(DEFAULT_TWO_PASS_CONFIG.passATokenBudget),
  TWO_PASS_B_TOKEN_BUDGET: z.coerce.number().int().positive().default(DEFAULT_TWO_PASS_CONFIG.passBTokenBudget),
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

/**
 * Get analysis engine configuration from environment
 */
export function getAnalysisConfig(): AnalysisEngineConfig {
  const env = getEnv();
  return {
    activeEngine: env.ANALYSIS_ENGINE_ACTIVE,
    shadowEngine: env.ANALYSIS_ENGINE_SHADOW ?? null,
    shadowSampleRate: env.ANALYSIS_SHADOW_SAMPLE_RATE,
    tokenHardCapTotal: env.ANALYSIS_TOKEN_HARD_CAP_TOTAL,
    tokenHardCapPerFrame: env.ANALYSIS_TOKEN_HARD_CAP_PER_FRAME,
  };
}

/**
 * Get preprocessing configuration from environment
 * V3 Accuracy Upgrade - Day 3-4
 */
export function getPreprocessingConfig(): PreprocessingConfig {
  const env = getEnv();
  return {
    enableChangeDetection: env.PREPROCESSING_ENABLE_CHANGE_DETECTION,
    changeDetectionGridRows: env.PREPROCESSING_CHANGE_GRID_ROWS,
    changeDetectionGridCols: env.PREPROCESSING_CHANGE_GRID_COLS,
    minRegionIntensity: env.PREPROCESSING_MIN_REGION_INTENSITY,
    pixelDiffThreshold: env.PREPROCESSING_PIXEL_DIFF_THRESHOLD,
    changeAnalysisSize: env.PREPROCESSING_CHANGE_ANALYSIS_SIZE,
    includeChangeContext: env.PREPROCESSING_INCLUDE_CHANGE_CONTEXT,
    maxChangeDescriptionLength: DEFAULT_PREPROCESSING_CONFIG.maxChangeDescriptionLength,
  };
}

/**
 * Get two-pass inference configuration from environment
 * V3 Accuracy Upgrade - Day 5-6
 */
export function getTwoPassConfig(): TwoPassConfig {
  const env = getEnv();
  return {
    enableTwoPass: env.TWO_PASS_ENABLE,
    maxRerunsPerFrame: env.TWO_PASS_MAX_RERUNS,
    schemaCoercionThreshold: env.TWO_PASS_SCHEMA_COERCION_THRESHOLD,
    minConfidenceThreshold: env.TWO_PASS_MIN_CONFIDENCE_THRESHOLD,
    passATokenBudget: env.TWO_PASS_A_TOKEN_BUDGET,
    passBTokenBudget: env.TWO_PASS_B_TOKEN_BUDGET,
  };
}
