/**
 * Preprocessing Configuration
 * V3 Accuracy Upgrade - Day 3-4: Change-Focused Preprocessing
 *
 * Configuration and types for enhanced frame preprocessing.
 */

import { z } from 'zod';

// =============================================================================
// Change Detection Types
// =============================================================================

export const changeTypeSchema = z.enum([
  'interaction_feedback',
  'navigation',
  'content_update',
  'modal_overlay',
  'loading_indicator',
  'error_state',
  'cursor_movement',
  'minor_change',
  'no_change',
]);

export type ChangeType = z.infer<typeof changeTypeSchema>;

export interface ChangeRegion {
  /** Grid position (0-indexed) */
  row: number;
  col: number;
  /** Normalized position (0-1) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Change intensity (0-1) */
  intensity: number;
  /** Classified change type */
  changeType: ChangeType;
}

export interface FrameChangeContext {
  /** Overall change score (0-1) */
  overallChangeScore: number;
  /** Primary change type for the frame */
  primaryChangeType: ChangeType;
  /** Human-readable change description for prompt injection */
  changeDescription: string;
  /** Whether a modal/overlay is detected */
  hasModalOverlay: boolean;
  /** Whether loading indicators are present */
  hasLoadingIndicator: boolean;
  /** Number of significantly changed regions */
  changedRegionCount: number;
}

// =============================================================================
// Preprocessing Configuration
// =============================================================================

export interface PreprocessingConfig {
  /** Enable change-focused preprocessing (V3) */
  enableChangeDetection: boolean;
  /** Grid rows for region analysis */
  changeDetectionGridRows: number;
  /** Grid columns for region analysis */
  changeDetectionGridCols: number;
  /** Minimum intensity threshold for region changes */
  minRegionIntensity: number;
  /** Pixel difference threshold */
  pixelDiffThreshold: number;
  /** Size to resize frames for change analysis */
  changeAnalysisSize: number;
  /** Include change context in vision prompts */
  includeChangeContext: boolean;
  /** Maximum change description length */
  maxChangeDescriptionLength: number;
}

export const DEFAULT_PREPROCESSING_CONFIG: PreprocessingConfig = {
  enableChangeDetection: true,
  changeDetectionGridRows: 4,
  changeDetectionGridCols: 4,
  minRegionIntensity: 0.05,
  pixelDiffThreshold: 25,
  changeAnalysisSize: 256,
  includeChangeContext: true,
  maxChangeDescriptionLength: 200,
};

// =============================================================================
// V3 Preprocessing Feature Flags
// =============================================================================

export interface PreprocessingFeatureFlags {
  /** Use region-based change detection instead of simple diff */
  useRegionBasedChangeDetection: boolean;
  /** Inject change context into vision prompts */
  injectChangeContext: boolean;
  /** Detect modal overlays */
  detectModalOverlays: boolean;
  /** Detect loading indicators */
  detectLoadingIndicators: boolean;
  /** Generate change heatmaps */
  generateChangeHeatmaps: boolean;
}

export const DEFAULT_PREPROCESSING_FEATURE_FLAGS: PreprocessingFeatureFlags = {
  useRegionBasedChangeDetection: true,
  injectChangeContext: true,
  detectModalOverlays: true,
  detectLoadingIndicators: true,
  generateChangeHeatmaps: false, // Not yet implemented
};

// =============================================================================
// Extended Frame Data
// =============================================================================

export interface EnhancedFrameData {
  /** Frame ID */
  frameId: string;
  /** Timestamp in milliseconds */
  timestampMs: number;
  /** Is this a keyframe */
  isKeyframe: boolean;
  /** Raw diff score (for backwards compatibility) */
  diffScore: number;
  /** Change context from V3 preprocessing */
  changeContext?: FrameChangeContext;
}

// =============================================================================
// Zod Schemas for Validation
// =============================================================================

export const frameChangeContextSchema = z.object({
  overallChangeScore: z.number().min(0).max(1),
  primaryChangeType: changeTypeSchema,
  changeDescription: z.string(),
  hasModalOverlay: z.boolean(),
  hasLoadingIndicator: z.boolean(),
  changedRegionCount: z.number().int().nonnegative(),
});

export const preprocessingConfigSchema = z.object({
  enableChangeDetection: z.boolean(),
  changeDetectionGridRows: z.number().int().min(2).max(8),
  changeDetectionGridCols: z.number().int().min(2).max(8),
  minRegionIntensity: z.number().min(0).max(1),
  pixelDiffThreshold: z.number().int().min(1).max(255),
  changeAnalysisSize: z.number().int().min(64).max(512),
  includeChangeContext: z.boolean(),
  maxChangeDescriptionLength: z.number().int().min(50).max(500),
});

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create empty frame change context
 */
export function createEmptyChangeContext(): FrameChangeContext {
  return {
    overallChangeScore: 0,
    primaryChangeType: 'no_change',
    changeDescription: 'First frame - no prior context.',
    hasModalOverlay: false,
    hasLoadingIndicator: false,
    changedRegionCount: 0,
  };
}

/**
 * Truncate change description to max length
 */
export function truncateChangeDescription(
  description: string,
  maxLength: number = DEFAULT_PREPROCESSING_CONFIG.maxChangeDescriptionLength
): string {
  if (description.length <= maxLength) {
    return description;
  }
  return description.substring(0, maxLength - 3) + '...';
}

// =============================================================================
// Multi-Image Payload Types (V3 Day 3-4)
// =============================================================================

export interface TemporalWindowMetadata {
  /** Relative indices in window (e.g., [-2, -1, 0, +1, +2]) */
  relativeIndices: number[];
  /** Timestamps in ms */
  timestamps: number[];
  /** Delta-ms between consecutive frames */
  deltaMs: number[];
  /** Index of keyframe within window */
  keyframeIndex: number;
}

export interface MultiImagePayload {
  /** Raw temporal strip (frames concatenated horizontally) */
  rawStrip: Buffer;
  /** Diff heatmap strip (heatmaps concatenated horizontally) - optional */
  diffHeatmapStrip?: Buffer;
  /** Change region crop (most changed area) - optional */
  changeCrop?: Buffer;
  /** Temporal window metadata */
  temporalMetadata: TemporalWindowMetadata;
  /** Prior context trail (short summaries of previous analyses) */
  priorContextTrail?: string;
}

export interface PreprocessingDiagnostics {
  /** Whether preprocessing fell back to raw-only mode */
  preprocessFallback: boolean;
  /** Reason for fallback if applicable */
  fallbackReason?: 'ssim_failed' | 'heatmap_failed' | 'crop_failed' | 'strip_failed' | 'timeout';
  /** SSIM scores between consecutive frames */
  ssimScores?: number[];
  /** Average change intensity */
  avgChangeIntensity?: number;
  /** Temporal window size actually used */
  temporalWindowSize: number;
  /** Processing time in ms */
  preprocessingMs: number;
}

/**
 * Format change context for vision prompt injection
 */
export function formatChangeContextForPrompt(
  context: FrameChangeContext | undefined
): string {
  if (!context) {
    return '';
  }

  if (context.primaryChangeType === 'no_change') {
    return '\n[CHANGE CONTEXT: No significant visual changes from previous frame.]';
  }

  const parts: string[] = [];
  parts.push(`\n[CHANGE CONTEXT: ${context.changeDescription}`);

  if (context.hasModalOverlay) {
    parts.push(' Modal/overlay detected.');
  }
  if (context.hasLoadingIndicator) {
    parts.push(' Loading indicator present.');
  }

  parts.push(` Change score: ${(context.overallChangeScore * 100).toFixed(0)}%]`);

  return parts.join('');
}
