/**
 * Benchmark Metrics Calculations
 * V3 Accuracy Upgrade - Day 9: Validation + Benchmark Execution
 *
 * Provides comprehensive metric calculations for benchmark evaluation:
 * - Per-category Cohen's Kappa and Quadratic Weighted Kappa
 * - Issue tag precision, recall, F1 (micro and macro)
 * - Quality gate confusion matrix and false-block rate
 * - Token usage distribution statistics
 */

import type { RubricScores, IssueTag } from './types';
import type {
  BenchmarkCase,
  AdjudicatedLabel,
  CategoryMetrics,
  IssueTagMetrics,
  GateMetrics,
  BenchmarkScoreReport,
  BenchmarkSplit,
} from './benchmark';
import {
  calculateKappa,
  calculateQuadraticWeightedKappa,
  calculateF1,
  BENCHMARK_CONFIG,
} from './benchmark';

// =============================================================================
// Types for Benchmark Evaluation
// =============================================================================

/** Predicted analysis result for a benchmark case */
export interface PredictedAnalysis {
  case_id: string;
  rubric_scores: RubricScores;
  issue_tags: IssueTag[];
  quality_gate_status: 'pass' | 'warn' | 'block';
  weighted_score_100: number;
  critical_issue_count: number;
  /** Engine version used */
  engine_version: string;
  /** Token usage for this case */
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Inference time in milliseconds */
  inference_ms: number;
  /** Whether analysis was truncated */
  analysis_truncated: boolean;
}

/** Token usage distribution statistics */
export interface TokenUsageDistribution {
  /** Total tokens across all cases */
  total: number;
  /** Mean tokens per case */
  mean: number;
  /** Median tokens per case */
  median: number;
  /** Standard deviation */
  stdDev: number;
  /** Minimum tokens */
  min: number;
  /** Maximum tokens */
  max: number;
  /** Percentiles */
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  /** Number of truncated cases */
  truncatedCount: number;
  /** Truncation rate */
  truncationRate: number;
}

/** Extended benchmark report with token usage */
export interface ExtendedBenchmarkReport extends BenchmarkScoreReport {
  /** Token usage distribution */
  token_usage_distribution: TokenUsageDistribution;
  /** Per-engine comparison (if comparing V2 vs V3) */
  engine_comparison?: {
    primary_engine: string;
    baseline_engine: string;
    kappa_delta: number;
    f1_delta: number;
    false_block_delta: number;
    token_delta_percent: number;
  };
  /** Calibration recommendations */
  calibration_recommendations?: CalibrationRecommendation[];
}

/** Calibration recommendation */
export interface CalibrationRecommendation {
  parameter: string;
  current_value: number;
  recommended_value: number;
  rationale: string;
  expected_impact: string;
}

/** Threshold configuration for quality gates */
export interface ThresholdConfig {
  /** Weighted score threshold for block vs warn */
  block_score_threshold: number;
  /** Weighted score threshold for warn vs pass */
  pass_score_threshold: number;
  /** Critical issue threshold for block */
  critical_issue_block_threshold: number;
}

// =============================================================================
// Metric Calculation Functions
// =============================================================================

const SCORE_CATEGORIES: (keyof RubricScores)[] = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7'];

/**
 * Calculate per-category metrics comparing predicted to ground truth
 */
export function calculateCategoryMetrics(
  predictions: PredictedAnalysis[],
  groundTruth: AdjudicatedLabel[]
): Record<keyof RubricScores, CategoryMetrics> {
  const gtMap = new Map(groundTruth.map(gt => [gt.case_id, gt]));

  const metrics: Record<string, CategoryMetrics> = {};

  for (const category of SCORE_CATEGORIES) {
    const predScores: number[] = [];
    const gtScores: number[] = [];

    for (const pred of predictions) {
      const gt = gtMap.get(pred.case_id);
      if (!gt) continue;

      predScores.push(pred.rubric_scores[category]);
      gtScores.push(gt.rubric_scores[category]);
    }

    if (predScores.length === 0) {
      metrics[category] = {
        kappa: 0,
        quadratic_weighted_kappa: 0,
        percent_agreement: 0,
        n: 0,
      };
      continue;
    }

    const kappa = calculateKappa(predScores, gtScores, [0, 1, 2]);
    const qwk = calculateQuadraticWeightedKappa(predScores, gtScores, [0, 1, 2]);

    // Calculate percent agreement
    let agreements = 0;
    for (let i = 0; i < predScores.length; i++) {
      if (predScores[i] === gtScores[i]) agreements++;
    }
    const percentAgreement = agreements / predScores.length;

    metrics[category] = {
      kappa,
      quadratic_weighted_kappa: qwk,
      percent_agreement: Number(percentAgreement.toFixed(4)),
      n: predScores.length,
    };
  }

  return metrics as Record<keyof RubricScores, CategoryMetrics>;
}

/**
 * Calculate mean quadratic weighted kappa across all categories
 */
export function calculateMeanQWK(categoryMetrics: Record<keyof RubricScores, CategoryMetrics>): number {
  const qwks = SCORE_CATEGORIES.map(cat => categoryMetrics[cat].quadratic_weighted_kappa);
  const sum = qwks.reduce((a, b) => a + b, 0);
  return Number((sum / qwks.length).toFixed(4));
}

/**
 * Calculate issue tag detection metrics
 */
export function calculateIssueTagMetrics(
  predictions: PredictedAnalysis[],
  groundTruth: AdjudicatedLabel[]
): IssueTagMetrics {
  const gtMap = new Map(groundTruth.map(gt => [gt.case_id, gt]));

  // Collect all unique tags
  const allTags = new Set<IssueTag>();
  for (const pred of predictions) {
    pred.issue_tags.forEach(tag => allTags.add(tag));
  }
  for (const gt of groundTruth) {
    gt.issue_tags.forEach(tag => allTags.add(tag as IssueTag));
  }

  const perTag: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};

  for (const tag of allTags) {
    let tp = 0; // True positives
    let fp = 0; // False positives
    let fn = 0; // False negatives

    for (const pred of predictions) {
      const gt = gtMap.get(pred.case_id);
      if (!gt) continue;

      const predHas = pred.issue_tags.includes(tag);
      const gtHas = gt.issue_tags.includes(tag as IssueTag);

      if (predHas && gtHas) tp++;
      else if (predHas && !gtHas) fp++;
      else if (!predHas && gtHas) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = calculateF1(precision, recall);
    const support = tp + fn; // Number of actual positives

    perTag[tag] = {
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      support,
    };
  }

  // Calculate macro F1 (average F1 across all tags)
  const tagF1s = Object.values(perTag).map(m => m.f1);
  const macroF1 = tagF1s.length > 0 ? tagF1s.reduce((a, b) => a + b, 0) / tagF1s.length : 0;

  return {
    macro_f1: Number(macroF1.toFixed(4)),
    per_tag: perTag,
  };
}

/**
 * Calculate quality gate confusion matrix and related metrics
 */
export function calculateGateMetrics(
  predictions: PredictedAnalysis[],
  groundTruth: AdjudicatedLabel[]
): GateMetrics {
  const gtMap = new Map(groundTruth.map(gt => [gt.case_id, gt]));

  const confusionMatrix = {
    pass: { pass: 0, warn: 0, block: 0 },
    warn: { pass: 0, warn: 0, block: 0 },
    block: { pass: 0, warn: 0, block: 0 },
  };

  for (const pred of predictions) {
    const gt = gtMap.get(pred.case_id);
    if (!gt) continue;

    const actual = gt.quality_gate_status;
    const predicted = pred.quality_gate_status;
    confusionMatrix[actual][predicted]++;
  }

  // Calculate block precision: correct blocks / predicted blocks
  const predictedBlocks = confusionMatrix.pass.block + confusionMatrix.warn.block + confusionMatrix.block.block;
  const correctBlocks = confusionMatrix.block.block;
  const blockPrecision = predictedBlocks > 0 ? correctBlocks / predictedBlocks : 0;

  // Calculate block recall: correct blocks / actual blocks
  const actualBlocks = confusionMatrix.block.pass + confusionMatrix.block.warn + confusionMatrix.block.block;
  const blockRecall = actualBlocks > 0 ? correctBlocks / actualBlocks : 0;

  // Calculate false block rate: incorrect blocks / total non-blocks
  const totalNonBlocks = (
    confusionMatrix.pass.pass + confusionMatrix.pass.warn + confusionMatrix.pass.block +
    confusionMatrix.warn.pass + confusionMatrix.warn.warn + confusionMatrix.warn.block
  );
  const falseBlocks = confusionMatrix.pass.block + confusionMatrix.warn.block;
  const falseBlockRate = totalNonBlocks > 0 ? falseBlocks / totalNonBlocks : 0;

  // Calculate overall gate accuracy
  const totalCorrect = confusionMatrix.pass.pass + confusionMatrix.warn.warn + confusionMatrix.block.block;
  const total = predictions.length;
  const gateAccuracy = total > 0 ? totalCorrect / total : 0;

  return {
    confusion_matrix: confusionMatrix,
    block_precision: Number(blockPrecision.toFixed(4)),
    block_recall: Number(blockRecall.toFixed(4)),
    false_block_rate: Number(falseBlockRate.toFixed(4)),
    gate_accuracy: Number(gateAccuracy.toFixed(4)),
  };
}

/**
 * Calculate token usage distribution statistics
 */
export function calculateTokenDistribution(predictions: PredictedAnalysis[]): TokenUsageDistribution {
  if (predictions.length === 0) {
    return {
      total: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p25: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      truncatedCount: 0,
      truncationRate: 0,
    };
  }

  const tokenCounts = predictions.map(p => p.token_usage.total_tokens);
  const sorted = [...tokenCounts].sort((a, b) => a - b);
  const n = sorted.length;

  const total = tokenCounts.reduce((a, b) => a + b, 0);
  const mean = total / n;

  // Standard deviation
  const variance = tokenCounts.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // Percentile helper
  const percentile = (p: number) => {
    const idx = Math.ceil((p / 100) * n) - 1;
    return sorted[Math.max(0, Math.min(idx, n - 1))];
  };

  // Truncation stats
  const truncatedCount = predictions.filter(p => p.analysis_truncated).length;

  return {
    total,
    mean: Number(mean.toFixed(2)),
    median: percentile(50),
    stdDev: Number(stdDev.toFixed(2)),
    min: sorted[0],
    max: sorted[n - 1],
    p25: percentile(25),
    p75: percentile(75),
    p90: percentile(90),
    p95: percentile(95),
    truncatedCount,
    truncationRate: Number((truncatedCount / n).toFixed(4)),
  };
}

// =============================================================================
// Threshold Calibration
// =============================================================================

/**
 * Calibrate thresholds to minimize false block rate while meeting precision target
 */
export function calibrateThresholds(
  predictions: PredictedAnalysis[],
  groundTruth: AdjudicatedLabel[],
  targetBlockPrecision: number = BENCHMARK_CONFIG.RELEASE_CRITERIA.BLOCK_PRECISION_THRESHOLD,
  targetFalseBlockRate: number = BENCHMARK_CONFIG.RELEASE_CRITERIA.FALSE_BLOCK_RATE_THRESHOLD
): ThresholdConfig & { recommendations: CalibrationRecommendation[] } {
  const gtMap = new Map(groundTruth.map(gt => [gt.case_id, gt]));
  const recommendations: CalibrationRecommendation[] = [];

  // Current default thresholds
  let blockScoreThreshold = 65;
  let passScoreThreshold = 80;
  let criticalIssueBlockThreshold = 1;

  // Grid search for optimal thresholds
  const blockCandidates = [55, 60, 65, 70, 75];
  const passCandidates = [75, 80, 85, 90];
  const criticalCandidates = [0, 1, 2, 3];

  let bestConfig: ThresholdConfig | null = null;
  let bestScore = -Infinity;

  for (const blockThresh of blockCandidates) {
    for (const passThresh of passCandidates) {
      if (passThresh <= blockThresh) continue;

      for (const critThresh of criticalCandidates) {
        // Re-evaluate predictions with new thresholds
        const reclassified = predictions.map(pred => {
          let gate: 'pass' | 'warn' | 'block';
          if (pred.critical_issue_count >= critThresh || pred.weighted_score_100 < blockThresh) {
            gate = 'block';
          } else if (pred.weighted_score_100 < passThresh) {
            gate = 'warn';
          } else {
            gate = 'pass';
          }
          return { ...pred, quality_gate_status: gate };
        });

        const gateMetrics = calculateGateMetrics(reclassified, groundTruth);

        // Score this configuration
        // Prioritize: false block rate < target, then maximize precision
        const meetsTarget = gateMetrics.false_block_rate <= targetFalseBlockRate;
        const precisionOk = gateMetrics.block_precision >= targetBlockPrecision;

        // Score formula: prioritize meeting targets, then optimize
        let score = 0;
        if (meetsTarget) score += 1000;
        if (precisionOk) score += 500;
        score += gateMetrics.block_precision * 100;
        score -= gateMetrics.false_block_rate * 200;
        score += gateMetrics.gate_accuracy * 50;

        if (score > bestScore) {
          bestScore = score;
          bestConfig = {
            block_score_threshold: blockThresh,
            pass_score_threshold: passThresh,
            critical_issue_block_threshold: critThresh,
          };
        }
      }
    }
  }

  if (!bestConfig) {
    bestConfig = {
      block_score_threshold: blockScoreThreshold,
      pass_score_threshold: passScoreThreshold,
      critical_issue_block_threshold: criticalIssueBlockThreshold,
    };
  }

  // Generate recommendations
  if (bestConfig.block_score_threshold !== blockScoreThreshold) {
    recommendations.push({
      parameter: 'block_score_threshold',
      current_value: blockScoreThreshold,
      recommended_value: bestConfig.block_score_threshold,
      rationale: `Adjusting from ${blockScoreThreshold} to ${bestConfig.block_score_threshold} reduces false blocks`,
      expected_impact: 'Reduced false block rate while maintaining precision',
    });
  }

  if (bestConfig.pass_score_threshold !== passScoreThreshold) {
    recommendations.push({
      parameter: 'pass_score_threshold',
      current_value: passScoreThreshold,
      recommended_value: bestConfig.pass_score_threshold,
      rationale: `Adjusting from ${passScoreThreshold} to ${bestConfig.pass_score_threshold} improves gate accuracy`,
      expected_impact: 'Better separation between pass and warn states',
    });
  }

  if (bestConfig.critical_issue_block_threshold !== criticalIssueBlockThreshold) {
    recommendations.push({
      parameter: 'critical_issue_block_threshold',
      current_value: criticalIssueBlockThreshold,
      recommended_value: bestConfig.critical_issue_block_threshold,
      rationale: `Adjusting from ${criticalIssueBlockThreshold} to ${bestConfig.critical_issue_block_threshold} optimizes block decision`,
      expected_impact: 'More appropriate blocking based on critical issues',
    });
  }

  return {
    ...bestConfig,
    recommendations,
  };
}

// =============================================================================
// Report Generation
// =============================================================================

/**
 * Generate a complete benchmark score report
 */
export function generateBenchmarkReport(
  predictions: PredictedAnalysis[],
  groundTruth: AdjudicatedLabel[],
  cases: BenchmarkCase[],
  engineVersion: string,
  manifestVersion: string,
  split: BenchmarkSplit,
  baselinePredictions?: PredictedAnalysis[]
): ExtendedBenchmarkReport {
  // Filter to only cases in the specified split
  const splitCaseIds = new Set(cases.filter(c => c.split === split).map(c => c.case_id));
  const filteredPredictions = predictions.filter(p => splitCaseIds.has(p.case_id));
  const filteredGroundTruth = groundTruth.filter(gt => splitCaseIds.has(gt.case_id));

  const categoryMetrics = calculateCategoryMetrics(filteredPredictions, filteredGroundTruth);
  const meanQWK = calculateMeanQWK(categoryMetrics);
  const issueTagMetrics = calculateIssueTagMetrics(filteredPredictions, filteredGroundTruth);
  const gateMetrics = calculateGateMetrics(filteredPredictions, filteredGroundTruth);
  const tokenDistribution = calculateTokenDistribution(filteredPredictions);

  // Check release criteria
  const releaseCriteria = {
    kappa_threshold: BENCHMARK_CONFIG.RELEASE_CRITERIA.MEAN_KAPPA_THRESHOLD,
    kappa_met: meanQWK >= BENCHMARK_CONFIG.RELEASE_CRITERIA.MEAN_KAPPA_THRESHOLD,
    kappa_uplift_target: BENCHMARK_CONFIG.RELEASE_CRITERIA.KAPPA_UPLIFT_TARGET,
    kappa_uplift_met: true, // Will be updated if baseline is provided
    issue_f1_threshold: BENCHMARK_CONFIG.RELEASE_CRITERIA.ISSUE_TAG_MACRO_F1_THRESHOLD,
    issue_f1_met: issueTagMetrics.macro_f1 >= BENCHMARK_CONFIG.RELEASE_CRITERIA.ISSUE_TAG_MACRO_F1_THRESHOLD,
    block_precision_threshold: BENCHMARK_CONFIG.RELEASE_CRITERIA.BLOCK_PRECISION_THRESHOLD,
    block_precision_met: gateMetrics.block_precision >= BENCHMARK_CONFIG.RELEASE_CRITERIA.BLOCK_PRECISION_THRESHOLD,
    false_block_threshold: BENCHMARK_CONFIG.RELEASE_CRITERIA.FALSE_BLOCK_RATE_THRESHOLD,
    false_block_met: gateMetrics.false_block_rate <= BENCHMARK_CONFIG.RELEASE_CRITERIA.FALSE_BLOCK_RATE_THRESHOLD,
    all_criteria_met: false,
  };

  // Engine comparison if baseline provided
  let engineComparison: ExtendedBenchmarkReport['engine_comparison'];
  if (baselinePredictions) {
    const filteredBaseline = baselinePredictions.filter(p => splitCaseIds.has(p.case_id));
    const baselineCategoryMetrics = calculateCategoryMetrics(filteredBaseline, filteredGroundTruth);
    const baselineMeanQWK = calculateMeanQWK(baselineCategoryMetrics);
    const baselineIssueMetrics = calculateIssueTagMetrics(filteredBaseline, filteredGroundTruth);
    const baselineGateMetrics = calculateGateMetrics(filteredBaseline, filteredGroundTruth);
    const baselineTokenDist = calculateTokenDistribution(filteredBaseline);

    const kappaDelta = meanQWK - baselineMeanQWK;
    releaseCriteria.kappa_uplift_met = kappaDelta >= BENCHMARK_CONFIG.RELEASE_CRITERIA.KAPPA_UPLIFT_TARGET;

    engineComparison = {
      primary_engine: engineVersion,
      baseline_engine: filteredBaseline[0]?.engine_version ?? 'v2_baseline',
      kappa_delta: Number(kappaDelta.toFixed(4)),
      f1_delta: Number((issueTagMetrics.macro_f1 - baselineIssueMetrics.macro_f1).toFixed(4)),
      false_block_delta: Number((gateMetrics.false_block_rate - baselineGateMetrics.false_block_rate).toFixed(4)),
      token_delta_percent: baselineTokenDist.mean > 0
        ? Number(((tokenDistribution.mean - baselineTokenDist.mean) / baselineTokenDist.mean * 100).toFixed(2))
        : 0,
    };
  }

  releaseCriteria.all_criteria_met = (
    releaseCriteria.kappa_met &&
    releaseCriteria.kappa_uplift_met &&
    releaseCriteria.issue_f1_met &&
    releaseCriteria.block_precision_met &&
    releaseCriteria.false_block_met
  );

  // Calibration recommendations
  const calibration = calibrateThresholds(filteredPredictions, filteredGroundTruth);

  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    engine_version: engineVersion,
    manifest_version: manifestVersion,
    split,
    cases_evaluated: filteredPredictions.length,
    category_metrics: categoryMetrics,
    mean_quadratic_weighted_kappa: meanQWK,
    issue_tag_metrics: issueTagMetrics,
    gate_metrics: gateMetrics,
    release_criteria: releaseCriteria,
    token_usage_distribution: tokenDistribution,
    engine_comparison: engineComparison,
    calibration_recommendations: calibration.recommendations,
  };
}

/**
 * Format benchmark report as human-readable text
 */
export function formatBenchmarkReportText(report: ExtendedBenchmarkReport): string {
  const lines: string[] = [];

  lines.push('═'.repeat(80));
  lines.push('BENCHMARK EVALUATION REPORT');
  lines.push('═'.repeat(80));
  lines.push('');
  lines.push(`Engine Version:      ${report.engine_version}`);
  lines.push(`Manifest Version:    ${report.manifest_version}`);
  lines.push(`Split:               ${report.split}`);
  lines.push(`Cases Evaluated:     ${report.cases_evaluated}`);
  lines.push(`Generated:           ${report.created_at}`);
  lines.push('');

  // Category Metrics
  lines.push('─'.repeat(80));
  lines.push('CATEGORY METRICS (Quadratic Weighted Kappa)');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push('Category  │ QWK     │ Kappa   │ Agreement │ N');
  lines.push('──────────┼─────────┼─────────┼───────────┼────');

  const categories = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7'] as const;
  for (const cat of categories) {
    const m = report.category_metrics[cat];
    lines.push(
      `${cat.padEnd(10)}│ ${m.quadratic_weighted_kappa.toFixed(3).padStart(7)} │ ${m.kappa.toFixed(3).padStart(7)} │ ${(m.percent_agreement * 100).toFixed(1).padStart(8)}% │ ${String(m.n).padStart(3)}`
    );
  }
  lines.push('──────────┴─────────┴─────────┴───────────┴────');
  lines.push(`Mean QWK: ${report.mean_quadratic_weighted_kappa.toFixed(4)}`);
  lines.push('');

  // Issue Tag Metrics
  lines.push('─'.repeat(80));
  lines.push('ISSUE TAG METRICS');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push(`Macro F1: ${report.issue_tag_metrics.macro_f1.toFixed(4)}`);
  lines.push('');
  lines.push('Tag                      │ Precision │ Recall  │ F1      │ Support');
  lines.push('─────────────────────────┼───────────┼─────────┼─────────┼────────');

  const sortedTags = Object.entries(report.issue_tag_metrics.per_tag)
    .sort((a, b) => b[1].support - a[1].support);

  for (const [tag, m] of sortedTags.slice(0, 10)) {
    lines.push(
      `${tag.padEnd(25)}│ ${m.precision.toFixed(3).padStart(9)} │ ${m.recall.toFixed(3).padStart(7)} │ ${m.f1.toFixed(3).padStart(7)} │ ${String(m.support).padStart(7)}`
    );
  }
  if (sortedTags.length > 10) {
    lines.push(`... and ${sortedTags.length - 10} more tags`);
  }
  lines.push('');

  // Gate Metrics
  lines.push('─'.repeat(80));
  lines.push('QUALITY GATE METRICS');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push('Confusion Matrix (Actual → Predicted):');
  lines.push('');
  lines.push('           │ Pred Pass │ Pred Warn │ Pred Block');
  lines.push('───────────┼───────────┼───────────┼───────────');
  const cm = report.gate_metrics.confusion_matrix;
  lines.push(`Act Pass   │ ${String(cm.pass.pass).padStart(9)} │ ${String(cm.pass.warn).padStart(9)} │ ${String(cm.pass.block).padStart(10)}`);
  lines.push(`Act Warn   │ ${String(cm.warn.pass).padStart(9)} │ ${String(cm.warn.warn).padStart(9)} │ ${String(cm.warn.block).padStart(10)}`);
  lines.push(`Act Block  │ ${String(cm.block.pass).padStart(9)} │ ${String(cm.block.warn).padStart(9)} │ ${String(cm.block.block).padStart(10)}`);
  lines.push('');
  lines.push(`Gate Accuracy:     ${(report.gate_metrics.gate_accuracy * 100).toFixed(2)}%`);
  lines.push(`Block Precision:   ${(report.gate_metrics.block_precision * 100).toFixed(2)}%`);
  lines.push(`Block Recall:      ${(report.gate_metrics.block_recall * 100).toFixed(2)}%`);
  lines.push(`False Block Rate:  ${(report.gate_metrics.false_block_rate * 100).toFixed(2)}%`);
  lines.push('');

  // Token Usage Distribution
  lines.push('─'.repeat(80));
  lines.push('TOKEN USAGE DISTRIBUTION');
  lines.push('─'.repeat(80));
  lines.push('');
  const td = report.token_usage_distribution;
  lines.push(`Total Tokens:      ${td.total.toLocaleString()}`);
  lines.push(`Mean per Case:     ${td.mean.toLocaleString()}`);
  lines.push(`Median:            ${td.median.toLocaleString()}`);
  lines.push(`Std Dev:           ${td.stdDev.toLocaleString()}`);
  lines.push(`Range:             ${td.min.toLocaleString()} - ${td.max.toLocaleString()}`);
  lines.push(`P25/P75:           ${td.p25.toLocaleString()} / ${td.p75.toLocaleString()}`);
  lines.push(`P90/P95:           ${td.p90.toLocaleString()} / ${td.p95.toLocaleString()}`);
  lines.push(`Truncated Cases:   ${td.truncatedCount} (${(td.truncationRate * 100).toFixed(2)}%)`);
  lines.push('');

  // Engine Comparison
  if (report.engine_comparison) {
    lines.push('─'.repeat(80));
    lines.push('ENGINE COMPARISON (V3 vs Baseline)');
    lines.push('─'.repeat(80));
    lines.push('');
    const ec = report.engine_comparison;
    lines.push(`Primary Engine:    ${ec.primary_engine}`);
    lines.push(`Baseline Engine:   ${ec.baseline_engine}`);
    lines.push(`Kappa Delta:       ${ec.kappa_delta >= 0 ? '+' : ''}${ec.kappa_delta.toFixed(4)}`);
    lines.push(`F1 Delta:          ${ec.f1_delta >= 0 ? '+' : ''}${ec.f1_delta.toFixed(4)}`);
    lines.push(`False Block Delta: ${ec.false_block_delta >= 0 ? '+' : ''}${(ec.false_block_delta * 100).toFixed(2)}%`);
    lines.push(`Token Delta:       ${ec.token_delta_percent >= 0 ? '+' : ''}${ec.token_delta_percent.toFixed(2)}%`);
    lines.push('');
  }

  // Release Criteria
  lines.push('─'.repeat(80));
  lines.push('RELEASE CRITERIA');
  lines.push('─'.repeat(80));
  lines.push('');
  const rc = report.release_criteria;
  const check = (met: boolean) => met ? '✓' : '✗';
  lines.push(`${check(rc.kappa_met)} Mean QWK ≥ ${rc.kappa_threshold}: ${report.mean_quadratic_weighted_kappa.toFixed(4)}`);
  lines.push(`${check(rc.kappa_uplift_met)} Kappa Uplift ≥ ${rc.kappa_uplift_target}: ${report.engine_comparison?.kappa_delta?.toFixed(4) ?? 'N/A'}`);
  lines.push(`${check(rc.issue_f1_met)} Issue F1 ≥ ${rc.issue_f1_threshold}: ${report.issue_tag_metrics.macro_f1.toFixed(4)}`);
  lines.push(`${check(rc.block_precision_met)} Block Precision ≥ ${rc.block_precision_threshold}: ${report.gate_metrics.block_precision.toFixed(4)}`);
  lines.push(`${check(rc.false_block_met)} False Block Rate ≤ ${rc.false_block_threshold}: ${report.gate_metrics.false_block_rate.toFixed(4)}`);
  lines.push('');
  lines.push(`All Criteria Met: ${rc.all_criteria_met ? '✓ PASS' : '✗ FAIL'}`);
  lines.push('');

  // Calibration Recommendations
  if (report.calibration_recommendations && report.calibration_recommendations.length > 0) {
    lines.push('─'.repeat(80));
    lines.push('CALIBRATION RECOMMENDATIONS');
    lines.push('─'.repeat(80));
    lines.push('');
    for (const rec of report.calibration_recommendations) {
      lines.push(`• ${rec.parameter}: ${rec.current_value} → ${rec.recommended_value}`);
      lines.push(`  Rationale: ${rec.rationale}`);
      lines.push(`  Expected: ${rec.expected_impact}`);
      lines.push('');
    }
  }

  lines.push('═'.repeat(80));

  return lines.join('\n');
}
