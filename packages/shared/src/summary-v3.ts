/**
 * Summary V3 Types + Confidence And Diagnostics
 * V3 Accuracy Upgrade - Day 7
 */

import type { AnalysisEngineVersion } from './analysis-config';
import type { RubricScores, TopIssue, Recommendation } from './types';

// =============================================================================
// Token Usage Types
// =============================================================================

export interface TokenUsage {
  /** Total prompt tokens consumed */
  prompt_tokens: number;
  /** Total completion tokens consumed */
  completion_tokens: number;
  /** Total tokens (prompt + completion) */
  total_tokens: number;
}

// =============================================================================
// Evidence Coverage Types
// =============================================================================

export interface EvidenceCoverage {
  /** Fraction of categories with concrete evidence references (0-1) */
  overall: number;
  /** Per-category evidence coverage */
  by_category: Record<string, number>;
  /** Number of categories with evidence */
  categories_with_evidence: number;
  /** Total number of categories */
  total_categories: number;
}

// =============================================================================
// Self-Consistency Types
// =============================================================================

export interface SelfConsistencyMetrics {
  /** Overall self-consistency score (0-1) */
  score: number;
  /** Total reruns executed across all frames */
  total_reruns: number;
  /** Average confidence across frames */
  avg_confidence: number;
  /** Frames with high consistency (>0.8) */
  high_consistency_frames: number;
  /** Frames with low consistency (<0.5) */
  low_consistency_frames: number;
  /** Rerun reasons breakdown */
  rerun_reasons: {
    schema_coercion: number;
    low_confidence: number;
    extraction_failed: number;
  };
}

// =============================================================================
// Shadow Analysis Diff Types
// =============================================================================

export interface ShadowAnalysisDiff {
  /** Whether shadow analysis was performed */
  shadow_enabled: boolean;
  /** Shadow engine version used */
  shadow_engine_version: AnalysisEngineVersion | null;
  /** Weighted score delta (shadow - primary) */
  weighted_score_delta: number | null;
  /** Critical issue count delta (shadow - primary) */
  critical_issue_delta: number | null;
  /** Whether quality gate status changed between primary and shadow */
  quality_gate_changed: boolean;
  /** Primary quality gate status */
  primary_quality_gate: 'pass' | 'warn' | 'block';
  /** Shadow quality gate status */
  shadow_quality_gate: 'pass' | 'warn' | 'block' | null;
}

// =============================================================================
// Deterministic Fallback Types
// =============================================================================

export interface FallbackApplied {
  /** Whether any fallback was applied */
  any_fallback: boolean;
  /** Categories where fallback was applied */
  fallback_categories: string[];
  /** Reason for fallback */
  fallback_reason: 'missing_scores' | 'missing_justifications' | 'insufficient_frames' | null;
  /** Whether quality gate was adjusted due to fallback */
  quality_gate_adjusted: boolean;
}

// =============================================================================
// V3 Summary Extension
// =============================================================================

export interface SummaryV3Extension {
  /** Analysis engine version used */
  analysis_engine_version: AnalysisEngineVersion;
  /** Token usage breakdown */
  token_usage: TokenUsage;
  /** Evidence coverage metrics */
  evidence_coverage: EvidenceCoverage;
  /** Self-consistency metrics from reruns */
  self_consistency: SelfConsistencyMetrics;
  /** Shadow analysis diff (if shadow engine enabled) */
  shadow_diff: ShadowAnalysisDiff;
  /** Fallback information */
  fallback_applied: FallbackApplied;
  /** Whether analysis was truncated */
  analysis_truncated: boolean;
  /** Frames skipped due to truncation */
  frames_skipped: number;
  /** Total frames analyzed */
  frames_analyzed: number;
  /** Schema normalization rate */
  schema_normalization_rate: number;
  /** Total inference time in ms */
  total_inference_ms: number;
}

// =============================================================================
// Complete V3 Summary Type
// =============================================================================

export interface RunSummaryV3 {
  // V2 fields (backward compatible)
  overall_scores: RubricScores;
  top_issues: TopIssue[];
  recommendations: Recommendation[];
  weighted_score_100: number;
  critical_issue_count: number;
  quality_gate_status: 'pass' | 'warn' | 'block';
  confidence_by_category: Record<string, number>;
  metric_version: string;

  // V3 extensions
  v3: SummaryV3Extension;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate evidence coverage from frame analyses
 */
export function calculateEvidenceCoverage(
  analyses: Array<{ justifications: Record<string, string> }>,
  categories: readonly string[]
): EvidenceCoverage {
  if (analyses.length === 0) {
    return {
      overall: 0,
      by_category: Object.fromEntries(categories.map(c => [c, 0])),
      categories_with_evidence: 0,
      total_categories: categories.length,
    };
  }

  const byCategory: Record<string, number> = {};
  let categoriesWithEvidence = 0;

  for (const category of categories) {
    // Count frames with concrete evidence (non-empty, non-generic justification)
    const framesWithEvidence = analyses.filter(analysis => {
      const text = analysis.justifications?.[category] || '';
      return hasConcreteEvidence(text);
    }).length;

    const coverage = framesWithEvidence / analyses.length;
    byCategory[category] = Number(coverage.toFixed(3));

    if (coverage > 0.5) {
      categoriesWithEvidence++;
    }
  }

  const overall = categoriesWithEvidence / categories.length;

  return {
    overall: Number(overall.toFixed(3)),
    by_category: byCategory,
    categories_with_evidence: categoriesWithEvidence,
    total_categories: categories.length,
  };
}

/**
 * Check if justification text contains concrete evidence
 */
function hasConcreteEvidence(text: string): boolean {
  if (!text || text.trim().length < 10) return false;

  // Generic or failed analysis patterns
  const genericPatterns = [
    /^analysis failed$/i,
    /^no issues detected$/i,
    /^n\/a$/i,
    /^none$/i,
    /^not applicable$/i,
    /^unable to analyze$/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(text.trim())) return false;
  }

  // Evidence indicators: specific UI elements, actions, observations
  const evidenceIndicators = [
    /button/i, /click/i, /response/i, /delay/i, /error/i,
    /loading/i, /spinner/i, /feedback/i, /visible/i, /hidden/i,
    /appears/i, /shows/i, /displays/i, /changes/i, /transition/i,
    /user/i, /action/i, /element/i, /input/i, /output/i,
    /\d+ms/i, /\d+px/i, /\d+%/i, // Specific measurements
  ];

  for (const indicator of evidenceIndicators) {
    if (indicator.test(text)) return true;
  }

  // If text is substantial (>50 chars) and not generic, assume it has evidence
  return text.trim().length > 50;
}

/**
 * Calculate self-consistency score from rerun metrics
 */
export function calculateSelfConsistencyScore(
  totalReruns: number,
  framesAnalyzed: number,
  avgConfidence: number,
  rerunReasons: { schema_coercion: number; low_confidence: number; extraction_failed: number }
): SelfConsistencyMetrics {
  if (framesAnalyzed === 0) {
    return {
      score: 1.0, // Perfect score if no frames (edge case)
      total_reruns: 0,
      avg_confidence: 0,
      high_consistency_frames: 0,
      low_consistency_frames: 0,
      rerun_reasons: { schema_coercion: 0, low_confidence: 0, extraction_failed: 0 },
    };
  }

  // Self-consistency score formula:
  // Base score starts at 1.0
  // Deduct for reruns (each rerun suggests inconsistency)
  // Weight by confidence
  const rerunRate = totalReruns / framesAnalyzed;
  const rerunPenalty = Math.min(rerunRate * 0.3, 0.5); // Max 0.5 penalty for reruns
  const confidenceBonus = avgConfidence * 0.2; // Up to 0.2 bonus for high confidence

  const score = Math.max(0, Math.min(1, 1.0 - rerunPenalty + confidenceBonus - 0.2));

  // Estimate frame consistency distribution
  const lowConfidenceFrames = rerunReasons.low_confidence;
  const highConsistencyFrames = Math.max(0, framesAnalyzed - totalReruns);

  return {
    score: Number(score.toFixed(3)),
    total_reruns: totalReruns,
    avg_confidence: Number(avgConfidence.toFixed(3)),
    high_consistency_frames: highConsistencyFrames,
    low_consistency_frames: lowConfidenceFrames,
    rerun_reasons: rerunReasons,
  };
}

/**
 * Compute shadow analysis diff
 */
export function computeShadowDiff(
  primaryWeightedScore: number,
  primaryCriticalCount: number,
  primaryQualityGate: 'pass' | 'warn' | 'block',
  shadowWeightedScore: number | null,
  shadowCriticalCount: number | null,
  shadowQualityGate: 'pass' | 'warn' | 'block' | null,
  shadowEngineVersion: AnalysisEngineVersion | null
): ShadowAnalysisDiff {
  const shadowEnabled = shadowWeightedScore !== null && shadowQualityGate !== null;

  return {
    shadow_enabled: shadowEnabled,
    shadow_engine_version: shadowEngineVersion,
    weighted_score_delta: shadowEnabled && shadowWeightedScore !== null
      ? Number((shadowWeightedScore - primaryWeightedScore).toFixed(2))
      : null,
    critical_issue_delta: shadowEnabled && shadowCriticalCount !== null
      ? shadowCriticalCount - primaryCriticalCount
      : null,
    quality_gate_changed: shadowEnabled && shadowQualityGate !== null
      ? shadowQualityGate !== primaryQualityGate
      : false,
    primary_quality_gate: primaryQualityGate,
    shadow_quality_gate: shadowQualityGate,
  };
}

/**
 * Apply deterministic fallback rules for missing analysis segments
 */
export function applyDeterministicFallbacks(
  scores: Record<string, number>,
  justifications: Record<string, string>,
  categories: readonly string[],
  framesAnalyzed: number
): {
  adjustedScores: Record<string, number>;
  fallbackApplied: FallbackApplied;
} {
  const adjustedScores = { ...scores };
  const fallbackCategories: string[] = [];
  let fallbackReason: FallbackApplied['fallback_reason'] = null;

  // Rule 1: If fewer than 3 frames analyzed, apply conservative fallback
  if (framesAnalyzed < 3) {
    fallbackReason = 'insufficient_frames';
    for (const category of categories) {
      if (adjustedScores[category] === 2) {
        // Downgrade perfect scores to 1 (partial) when evidence is limited
        adjustedScores[category] = 1;
        fallbackCategories.push(category);
      }
    }
  }

  // Rule 2: For categories with no justification, apply neutral fallback
  for (const category of categories) {
    const justification = justifications[category] || '';
    if (!justification.trim() || /^(n\/a|none|analysis failed)$/i.test(justification.trim())) {
      if (!fallbackReason) fallbackReason = 'missing_justifications';
      // Set to neutral score (1) if missing justification
      if (adjustedScores[category] === undefined || adjustedScores[category] === 0) {
        adjustedScores[category] = 1;
        if (!fallbackCategories.includes(category)) {
          fallbackCategories.push(category);
        }
      }
    }
  }

  // Rule 3: For missing scores, apply conservative default
  for (const category of categories) {
    if (adjustedScores[category] === undefined) {
      if (!fallbackReason) fallbackReason = 'missing_scores';
      adjustedScores[category] = 1; // Neutral fallback
      if (!fallbackCategories.includes(category)) {
        fallbackCategories.push(category);
      }
    }
  }

  return {
    adjustedScores,
    fallbackApplied: {
      any_fallback: fallbackCategories.length > 0,
      fallback_categories: fallbackCategories,
      fallback_reason: fallbackReason,
      quality_gate_adjusted: fallbackCategories.length > 0,
    },
  };
}
