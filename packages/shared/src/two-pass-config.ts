/**
 * Two-Pass Inference Configuration
 * V3 Accuracy Upgrade - Day 5-6: Two-Pass Inference + Calibration Heuristics
 *
 * Pass A: Structured interaction extraction
 * Pass B: Rubric scoring conditioned on Pass A
 */

import { z } from 'zod';

// =============================================================================
// Pass A Types: Structured Interaction Extraction
// =============================================================================

export const interactionCommandSchema = z.enum([
  'click',
  'double_click',
  'right_click',
  'hover',
  'scroll',
  'type',
  'drag',
  'select',
  'toggle',
  'navigate',
  'submit',
  'cancel',
  'expand',
  'collapse',
  'unknown',
]);

export type InteractionCommand = z.infer<typeof interactionCommandSchema>;

export const widgetTypeSchema = z.enum([
  'button',
  'link',
  'input_text',
  'input_checkbox',
  'input_radio',
  'dropdown',
  'menu',
  'tab',
  'modal',
  'tooltip',
  'card',
  'list_item',
  'icon',
  'image',
  'video_player',
  'slider',
  'toggle',
  'progress',
  'loading',
  'notification',
  'form',
  'table',
  'navigation',
  'header',
  'footer',
  'sidebar',
  'unknown',
]);

export type WidgetType = z.infer<typeof widgetTypeSchema>;

export const stateChangeTypeSchema = z.enum([
  'visibility_show',
  'visibility_hide',
  'content_update',
  'style_change',
  'position_change',
  'focus_gained',
  'focus_lost',
  'selection_change',
  'loading_start',
  'loading_end',
  'error_show',
  'error_clear',
  'navigation',
  'modal_open',
  'modal_close',
  'dropdown_open',
  'dropdown_close',
  'animation_start',
  'animation_end',
  'no_change',
]);

export type StateChangeType = z.infer<typeof stateChangeTypeSchema>;

export interface InteractionExtraction {
  /** Detected user command/action */
  command: InteractionCommand;
  /** Confidence in command detection (0-1) */
  commandConfidence: number;
  /** Target widget type */
  targetWidget: WidgetType;
  /** Target widget label/text if visible */
  targetLabel?: string;
  /** Detected state changes */
  stateChanges: StateChangeType[];
  /** Response latency observed (none, fast, slow, timeout) */
  responseLatency: 'none' | 'fast' | 'medium' | 'slow' | 'timeout';
  /** Whether feedback was visible */
  feedbackVisible: boolean;
  /** Whether error state was detected */
  errorDetected: boolean;
  /** Overall extraction confidence (0-1) */
  overallConfidence: number;
  /** Raw observations for Pass B context */
  observations: string;
  /** Flow overview - app context and user intent */
  flowOverview?: {
    /** Application/platform being used (e.g., "Microsoft Copilot", "VS Code") */
    appContext: string;
    /** What the user is trying to accomplish */
    userIntent: string;
    /** Brief description of actions observed */
    actionsObserved: string;
  };
}

export const interactionExtractionSchema = z.object({
  command: interactionCommandSchema,
  commandConfidence: z.number().min(0).max(1),
  targetWidget: widgetTypeSchema,
  targetLabel: z.string().optional(),
  stateChanges: z.array(stateChangeTypeSchema),
  responseLatency: z.enum(['none', 'fast', 'medium', 'slow', 'timeout']),
  feedbackVisible: z.boolean(),
  errorDetected: z.boolean(),
  overallConfidence: z.number().min(0).max(1),
  observations: z.string(),
  flowOverview: z.object({
    appContext: z.string(),
    userIntent: z.string(),
    actionsObserved: z.string(),
  }).optional(),
});

// =============================================================================
// Pass B Types: Conditioned Rubric Scoring
// =============================================================================

export interface PassBContext {
  /** Pass A extraction result */
  extraction: InteractionExtraction;
  /** Formatted extraction summary for prompt */
  extractionSummary: string;
}

// =============================================================================
// Self-Consistency / Rerun Configuration
// =============================================================================

export interface TwoPassConfig {
  /** Enable two-pass inference */
  enableTwoPass: boolean;
  /** Maximum reruns per frame for self-consistency */
  maxRerunsPerFrame: number;
  /** Schema coercion threshold to trigger rerun (0-1) */
  schemaCoercionThreshold: number;
  /** Minimum confidence to accept without rerun */
  minConfidenceThreshold: number;
  /** Token budget for Pass A */
  passATokenBudget: number;
  /** Token budget for Pass B */
  passBTokenBudget: number;
}

export const DEFAULT_TWO_PASS_CONFIG: TwoPassConfig = {
  enableTwoPass: true,
  maxRerunsPerFrame: 2,
  schemaCoercionThreshold: 0.3, // Rerun if >30% fields coerced
  minConfidenceThreshold: 0.6,   // Rerun if confidence <60%
  passATokenBudget: 1500,
  passBTokenBudget: 2000,
};

// =============================================================================
// Rerun Tracking
// =============================================================================

export interface RerunMetrics {
  /** Number of reruns executed */
  rerunCount: number;
  /** Reasons for reruns */
  rerunReasons: Array<'schema_coercion' | 'low_confidence' | 'extraction_failed'>;
  /** Confidence scores from each run */
  confidenceHistory: number[];
  /** Final merged result used */
  mergeStrategy: 'highest_confidence' | 'majority_vote' | 'first_valid';
}

export interface TwoPassResult {
  /** Pass A extraction */
  extraction: InteractionExtraction;
  /** Pass B rubric analysis */
  rubricAnalysis: {
    rubric_scores: Record<string, number>;
    justifications: Record<string, string>;
    issue_tags: string[];
    suggestions: Array<{ severity: 'high' | 'med' | 'low'; title: string; description: string }>;
    flow_overview?: {
      app_context: string;
      user_intent: string;
      actions_observed: string;
    };
  };
  /** Combined telemetry */
  telemetry: {
    passATokens: number;
    passBTokens: number;
    totalTokens: number;
    passAMs: number;
    passBMs: number;
    totalMs: number;
    rerunMetrics: RerunMetrics;
  };
  /** Whether schema normalization was needed */
  schemaNormalized: boolean;
}

// =============================================================================
// Token Budget Types
// =============================================================================

export interface TokenBudgetStatus {
  /** Total tokens used so far */
  totalUsed: number;
  /** Total budget allocated */
  totalBudget: number;
  /** Remaining budget */
  remaining: number;
  /** Percentage used */
  percentUsed: number;
  /** Whether budget is exceeded */
  exceeded: boolean;
  /** Whether analysis was truncated due to budget */
  analysisTruncated: boolean;
  /** Number of frames skipped due to truncation */
  framesSkipped: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format Pass A extraction for Pass B prompt
 */
export function formatExtractionForPassB(extraction: InteractionExtraction): string {
  const parts: string[] = [];

  parts.push(`[PASS A EXTRACTION CONTEXT]`);
  parts.push(`- User Action: ${extraction.command} (confidence: ${(extraction.commandConfidence * 100).toFixed(0)}%)`);
  parts.push(`- Target: ${extraction.targetWidget}${extraction.targetLabel ? ` "${extraction.targetLabel}"` : ''}`);

  if (extraction.stateChanges.length > 0) {
    parts.push(`- State Changes: ${extraction.stateChanges.join(', ')}`);
  }

  parts.push(`- Response Latency: ${extraction.responseLatency}`);
  parts.push(`- Feedback Visible: ${extraction.feedbackVisible ? 'Yes' : 'No'}`);

  if (extraction.errorDetected) {
    parts.push(`- Error Detected: Yes`);
  }

  parts.push(`- Observations: ${extraction.observations}`);

  return parts.join('\n');
}

/**
 * Determine if rerun is needed based on metrics
 */
export function shouldRerun(
  confidenceScore: number,
  schemaCoercionRate: number,
  currentRerunCount: number,
  config: TwoPassConfig
): { shouldRerun: boolean; reason?: 'schema_coercion' | 'low_confidence' } {
  if (currentRerunCount >= config.maxRerunsPerFrame) {
    return { shouldRerun: false };
  }

  if (schemaCoercionRate > config.schemaCoercionThreshold) {
    return { shouldRerun: true, reason: 'schema_coercion' };
  }

  if (confidenceScore < config.minConfidenceThreshold) {
    return { shouldRerun: true, reason: 'low_confidence' };
  }

  return { shouldRerun: false };
}

/**
 * Merge multiple rubric score results using deterministic rules
 */
export function mergeRubricScores(
  results: Array<{
    scores: Record<string, number>;
    confidence: number;
    coercionRate: number;
  }>
): { mergedScores: Record<string, number>; strategy: 'highest_confidence' | 'majority_vote' | 'first_valid' } {
  if (results.length === 0) {
    throw new Error('No results to merge');
  }

  if (results.length === 1) {
    return { mergedScores: results[0].scores, strategy: 'first_valid' };
  }

  // Sort by confidence (highest first), then by coercion rate (lowest first)
  const sorted = [...results].sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) > 0.1) {
      return b.confidence - a.confidence;
    }
    return a.coercionRate - b.coercionRate;
  });

  // Use highest confidence result
  return { mergedScores: sorted[0].scores, strategy: 'highest_confidence' };
}

/**
 * Merge issue tags from multiple runs (union with deduplication)
 */
export function mergeIssueTags(tagArrays: string[][]): string[] {
  const tagSet = new Set<string>();
  for (const tags of tagArrays) {
    for (const tag of tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet);
}

/**
 * Calculate schema coercion rate
 */
export function calculateCoercionRate(
  originalFieldCount: number,
  coercedFieldCount: number
): number {
  if (originalFieldCount === 0) return 0;
  return coercedFieldCount / originalFieldCount;
}
