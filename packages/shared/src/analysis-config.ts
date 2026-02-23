/**
 * Analysis Engine Configuration
 * V3 Accuracy Upgrade - Day 1: Baseline Freeze + Instrumentation
 */

export const ANALYSIS_ENGINE_VERSIONS = {
  V2_BASELINE: 'v2_baseline',
  V3_HYBRID: 'v3_hybrid',
} as const;

export type AnalysisEngineVersion = (typeof ANALYSIS_ENGINE_VERSIONS)[keyof typeof ANALYSIS_ENGINE_VERSIONS];

export interface AnalysisEngineConfig {
  /** Active engine version for production scoring */
  activeEngine: AnalysisEngineVersion;
  /** Shadow engine version for comparison (runs in parallel, not user-visible) */
  shadowEngine: AnalysisEngineVersion | null;
  /** Sample rate for shadow analysis (0.0 - 1.0) */
  shadowSampleRate: number;
  /** Hard cap on total tokens per run */
  tokenHardCapTotal: number;
  /** Hard cap on tokens per frame analysis */
  tokenHardCapPerFrame: number;
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisEngineConfig = {
  activeEngine: ANALYSIS_ENGINE_VERSIONS.V3_HYBRID,
  shadowEngine: ANALYSIS_ENGINE_VERSIONS.V2_BASELINE,
  shadowSampleRate: 0.25,
  tokenHardCapTotal: 300000,
  tokenHardCapPerFrame: 18000,
};

/**
 * Telemetry fields for V3 instrumentation
 */
export interface FrameAnalysisTelemetry {
  /** Engine version used for this analysis */
  engineVersion: AnalysisEngineVersion;
  /** Prompt tokens consumed */
  promptTokens: number;
  /** Completion tokens consumed */
  completionTokens: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Inference duration in milliseconds */
  inferenceMs: number;
  /** Whether schema normalization was required */
  schemaNormalized: boolean;
  /** Reason if analysis was truncated */
  truncationReason: 'none' | 'token_cap_total' | 'token_cap_frame' | 'timeout' | 'error';
}

export interface RunAnalysisTelemetry {
  /** Engine version used for this run */
  engineVersion: AnalysisEngineVersion;
  /** Total prompt tokens for entire run */
  totalPromptTokens: number;
  /** Total completion tokens for entire run */
  totalCompletionTokens: number;
  /** Total tokens for entire run */
  totalTokens: number;
  /** Total inference time in milliseconds */
  totalInferenceMs: number;
  /** Number of frames that required schema normalization */
  schemaNormalizedCount: number;
  /** Schema normalization rate (0.0 - 1.0) */
  schemaNormalizationRate: number;
  /** Whether run was truncated due to budget */
  analysisTruncated: boolean;
  /** Reason for truncation if applicable */
  truncationReason: 'none' | 'token_cap_total' | 'timeout';
  /** Number of frames analyzed */
  framesAnalyzed: number;
  /** Number of frames skipped due to truncation */
  framesSkipped: number;
}

export function createEmptyRunTelemetry(engineVersion: AnalysisEngineVersion): RunAnalysisTelemetry {
  return {
    engineVersion,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalInferenceMs: 0,
    schemaNormalizedCount: 0,
    schemaNormalizationRate: 0,
    analysisTruncated: false,
    truncationReason: 'none',
    framesAnalyzed: 0,
    framesSkipped: 0,
  };
}

export function createEmptyFrameTelemetry(engineVersion: AnalysisEngineVersion): FrameAnalysisTelemetry {
  return {
    engineVersion,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    inferenceMs: 0,
    schemaNormalized: false,
    truncationReason: 'none',
  };
}
