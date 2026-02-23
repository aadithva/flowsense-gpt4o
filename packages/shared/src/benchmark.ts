/**
 * Benchmark Types and Schemas
 * V3 Accuracy Upgrade - Day 2: Benchmark Set Build + Label Protocol
 */

import { z } from 'zod';
import type { RubricScores, IssueTag } from './types';

// =============================================================================
// Benchmark Case Types
// =============================================================================

export type BenchmarkSplit = 'calibration' | 'holdout';

export interface BenchmarkCase {
  /** Unique immutable case ID */
  case_id: string;
  /** Source run ID from production data */
  source_run_id: string;
  /** Frame IDs included in this case */
  frame_ids: string[];
  /** Split assignment (calibration or holdout) */
  split: BenchmarkSplit;
  /** Domain category (e.g., 'web_app', 'mobile', 'desktop') */
  domain: string;
  /** Brief description of the task flow */
  description: string;
  /** Timestamp when case was created */
  created_at: string;
  /** Video duration in milliseconds */
  duration_ms: number;
  /** Number of keyframes */
  keyframe_count: number;
}

export interface BenchmarkManifest {
  /** Manifest version for schema evolution */
  version: string;
  /** When this manifest was generated */
  created_at: string;
  /** Total cases in benchmark */
  total_cases: number;
  /** Calibration set size */
  calibration_count: number;
  /** Holdout set size */
  holdout_count: number;
  /** List of all benchmark cases */
  cases: BenchmarkCase[];
  /** Seed used for random split assignment */
  split_seed: number;
}

// =============================================================================
// Label Types
// =============================================================================

export interface BenchmarkLabel {
  /** Reference to benchmark case */
  case_id: string;
  /** Rater identifier (anonymized) */
  rater_id: string;
  /** Rubric scores (cat1-cat7, each 0/1/2) */
  rubric_scores: RubricScores;
  /** Issue tags detected */
  issue_tags: IssueTag[];
  /** Expected quality gate status */
  quality_gate_status: 'pass' | 'warn' | 'block';
  /** Optional rater notes */
  rater_notes?: string;
  /** Timestamp when label was created */
  labeled_at: string;
  /** Time spent labeling (seconds) */
  labeling_duration_seconds?: number;
}

export interface AdjudicatedLabel {
  /** Reference to benchmark case */
  case_id: string;
  /** Final adjudicated rubric scores */
  rubric_scores: RubricScores;
  /** Final adjudicated issue tags */
  issue_tags: IssueTag[];
  /** Final adjudicated quality gate */
  quality_gate_status: 'pass' | 'warn' | 'block';
  /** Whether adjudication was needed (raters disagreed) */
  required_adjudication: boolean;
  /** Adjudicator ID if adjudication was needed */
  adjudicator_id?: string;
  /** Notes from adjudication */
  adjudication_notes?: string;
  /** Timestamp */
  adjudicated_at: string;
}

export interface LabelPack {
  /** Pack version */
  version: string;
  /** When this pack was generated */
  created_at: string;
  /** Rater this pack is assigned to */
  assigned_rater_id: string;
  /** Cases to label */
  cases: Array<{
    case_id: string;
    description: string;
    frame_urls: string[];
    video_url?: string;
  }>;
}

// =============================================================================
// Scoring Metrics Types
// =============================================================================

export interface CategoryMetrics {
  /** Cohen's Kappa for this category */
  kappa: number;
  /** Quadratic weighted kappa */
  quadratic_weighted_kappa: number;
  /** Percent agreement */
  percent_agreement: number;
  /** Sample size */
  n: number;
}

export interface IssueTagMetrics {
  /** Macro F1 score across all tags */
  macro_f1: number;
  /** Per-tag metrics */
  per_tag: Record<string, {
    precision: number;
    recall: number;
    f1: number;
    support: number;
  }>;
}

export interface GateMetrics {
  /** Confusion matrix [actual][predicted] */
  confusion_matrix: {
    pass: { pass: number; warn: number; block: number };
    warn: { pass: number; warn: number; block: number };
    block: { pass: number; warn: number; block: number };
  };
  /** Block precision (correct blocks / predicted blocks) */
  block_precision: number;
  /** Block recall (correct blocks / actual blocks) */
  block_recall: number;
  /** False block rate (incorrect blocks / total non-blocks) */
  false_block_rate: number;
  /** Overall gate accuracy */
  gate_accuracy: number;
}

export interface BenchmarkScoreReport {
  /** Report version */
  version: string;
  /** When this report was generated */
  created_at: string;
  /** Engine version being evaluated */
  engine_version: string;
  /** Benchmark manifest version used */
  manifest_version: string;
  /** Split used for this evaluation */
  split: BenchmarkSplit;
  /** Number of cases evaluated */
  cases_evaluated: number;
  /** Per-category kappa metrics */
  category_metrics: Record<keyof RubricScores, CategoryMetrics>;
  /** Mean quadratic weighted kappa across categories */
  mean_quadratic_weighted_kappa: number;
  /** Issue tag detection metrics */
  issue_tag_metrics: IssueTagMetrics;
  /** Quality gate metrics */
  gate_metrics: GateMetrics;
  /** Summary pass/fail against release criteria */
  release_criteria: {
    kappa_threshold: number;
    kappa_met: boolean;
    kappa_uplift_target: number;
    kappa_uplift_met: boolean;
    issue_f1_threshold: number;
    issue_f1_met: boolean;
    block_precision_threshold: number;
    block_precision_met: boolean;
    false_block_threshold: number;
    false_block_met: boolean;
    all_criteria_met: boolean;
  };
}

// =============================================================================
// Zod Schemas for Validation
// =============================================================================

export const benchmarkSplitSchema = z.enum(['calibration', 'holdout']);

export const benchmarkCaseSchema = z.object({
  case_id: z.string().min(1),
  source_run_id: z.string().min(1), // Flexible: UUID in prod, mock ID in dev
  frame_ids: z.array(z.string().min(1)), // Flexible: UUID in prod, mock ID in dev
  split: benchmarkSplitSchema,
  domain: z.string().min(1),
  description: z.string(),
  created_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  keyframe_count: z.number().int().positive(),
});

export const benchmarkManifestSchema = z.object({
  version: z.string(),
  created_at: z.string().datetime(),
  total_cases: z.number().int().positive(),
  calibration_count: z.number().int().nonnegative(),
  holdout_count: z.number().int().nonnegative(),
  cases: z.array(benchmarkCaseSchema),
  split_seed: z.number().int(),
});

export const benchmarkRubricScoresSchema = z.object({
  cat1: z.number().int().min(0).max(2),
  cat2: z.number().int().min(0).max(2),
  cat3: z.number().int().min(0).max(2),
  cat4: z.number().int().min(0).max(2),
  cat5: z.number().int().min(0).max(2),
  cat6: z.number().int().min(0).max(2),
  cat7: z.number().int().min(0).max(2),
});

export const qualityGateSchema = z.enum(['pass', 'warn', 'block']);

export const benchmarkLabelSchema = z.object({
  case_id: z.string().min(1),
  rater_id: z.string().min(1),
  rubric_scores: benchmarkRubricScoresSchema,
  issue_tags: z.array(z.string()),
  quality_gate_status: qualityGateSchema,
  rater_notes: z.string().optional(),
  labeled_at: z.string().datetime(),
  labeling_duration_seconds: z.number().positive().optional(),
});

export const adjudicatedLabelSchema = z.object({
  case_id: z.string().min(1),
  rubric_scores: benchmarkRubricScoresSchema,
  issue_tags: z.array(z.string()),
  quality_gate_status: qualityGateSchema,
  required_adjudication: z.boolean(),
  adjudicator_id: z.string().optional(),
  adjudication_notes: z.string().optional(),
  adjudicated_at: z.string().datetime(),
});

// =============================================================================
// Constants
// =============================================================================

export const BENCHMARK_CONFIG = {
  /** Target total cases */
  TARGET_TOTAL_CASES: 120,
  /** Calibration set proportion */
  CALIBRATION_PROPORTION: 0.75, // 90 calibration, 30 holdout
  /** Minimum raters per case */
  MIN_RATERS_PER_CASE: 2,
  /** Release criteria thresholds */
  RELEASE_CRITERIA: {
    MEAN_KAPPA_THRESHOLD: 0.62,
    KAPPA_UPLIFT_TARGET: 0.10,
    ISSUE_TAG_MACRO_F1_THRESHOLD: 0.58,
    BLOCK_PRECISION_THRESHOLD: 0.75,
    FALSE_BLOCK_RATE_THRESHOLD: 0.08,
  },
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a deterministic case ID from source run ID
 */
export function generateCaseId(sourceRunId: string, index: number): string {
  return `bench_${sourceRunId.substring(0, 8)}_${index.toString().padStart(3, '0')}`;
}

/**
 * Assign split based on seed and index for reproducibility
 */
export function assignSplit(index: number, totalCases: number, seed: number): BenchmarkSplit {
  // Simple deterministic split using modular arithmetic
  const calibrationCount = Math.floor(totalCases * BENCHMARK_CONFIG.CALIBRATION_PROPORTION);

  // Use seed to create a deterministic shuffle
  const hash = (index * 31 + seed) % totalCases;

  return hash < calibrationCount ? 'calibration' : 'holdout';
}

/**
 * Check if two raters agree on a category score (within tolerance)
 */
export function scoresAgree(score1: number, score2: number, tolerance = 0): boolean {
  return Math.abs(score1 - score2) <= tolerance;
}

/**
 * Calculate Cohen's Kappa for ordinal data
 */
export function calculateKappa(
  ratings1: number[],
  ratings2: number[],
  categories = [0, 1, 2]
): number {
  if (ratings1.length !== ratings2.length || ratings1.length === 0) {
    return 0;
  }

  const n = ratings1.length;
  const k = categories.length;

  // Build confusion matrix
  const matrix: number[][] = Array(k).fill(null).map(() => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const r1 = categories.indexOf(ratings1[i]);
    const r2 = categories.indexOf(ratings2[i]);
    if (r1 >= 0 && r2 >= 0) {
      matrix[r1][r2]++;
    }
  }

  // Calculate observed agreement
  let po = 0;
  for (let i = 0; i < k; i++) {
    po += matrix[i][i];
  }
  po /= n;

  // Calculate expected agreement
  let pe = 0;
  for (let i = 0; i < k; i++) {
    let rowSum = 0;
    let colSum = 0;
    for (let j = 0; j < k; j++) {
      rowSum += matrix[i][j];
      colSum += matrix[j][i];
    }
    pe += (rowSum * colSum) / (n * n);
  }

  // Cohen's Kappa
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

/**
 * Calculate Quadratic Weighted Kappa
 */
export function calculateQuadraticWeightedKappa(
  ratings1: number[],
  ratings2: number[],
  categories = [0, 1, 2]
): number {
  if (ratings1.length !== ratings2.length || ratings1.length === 0) {
    return 0;
  }

  const n = ratings1.length;
  const k = categories.length;

  // Build confusion matrix
  const observed: number[][] = Array(k).fill(null).map(() => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const r1 = categories.indexOf(ratings1[i]);
    const r2 = categories.indexOf(ratings2[i]);
    if (r1 >= 0 && r2 >= 0) {
      observed[r1][r2]++;
    }
  }

  // Row and column sums
  const rowSums = observed.map(row => row.reduce((a, b) => a + b, 0));
  const colSums = Array(k).fill(0);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < k; i++) {
      colSums[j] += observed[i][j];
    }
  }

  // Expected matrix
  const expected: number[][] = Array(k).fill(null).map(() => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      expected[i][j] = (rowSums[i] * colSums[j]) / n;
    }
  }

  // Quadratic weights
  const weights: number[][] = Array(k).fill(null).map(() => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      weights[i][j] = ((i - j) * (i - j)) / ((k - 1) * (k - 1));
    }
  }

  // Calculate weighted sums
  let observedWeighted = 0;
  let expectedWeighted = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observedWeighted += weights[i][j] * observed[i][j];
      expectedWeighted += weights[i][j] * expected[i][j];
    }
  }

  if (expectedWeighted === 0) return 1;
  return 1 - (observedWeighted / expectedWeighted);
}

/**
 * Calculate F1 score from precision and recall
 */
export function calculateF1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}
