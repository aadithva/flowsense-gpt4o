#!/usr/bin/env npx tsx
/**
 * Score Benchmark Script
 * V3 Accuracy Upgrade - Day 2: Benchmark Evaluation
 *
 * Computes kappa/F1/gate metrics comparing model predictions to human labels.
 *
 * Usage:
 *   npx tsx scripts/eval/score-benchmark.ts [options]
 *
 * Options:
 *   --manifest <path>      Path to benchmark manifest
 *   --labels <path>        Path to adjudicated labels JSON
 *   --predictions <path>   Path to model predictions JSON
 *   --baseline <path>      Optional: path to baseline predictions for uplift calculation
 *   --output <path>        Output path for score report
 *   --split <split>        Evaluate on: calibration, holdout, or all (default: holdout)
 *   --engine <version>     Engine version being evaluated (for report metadata)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  type BenchmarkManifest,
  type AdjudicatedLabel,
  type BenchmarkScoreReport,
  type CategoryMetrics,
  type IssueTagMetrics,
  type GateMetrics,
  type RubricScores,
  type BenchmarkSplit,
  type IssueTag,
  benchmarkManifestSchema,
  adjudicatedLabelSchema,
  BENCHMARK_CONFIG,
  calculateKappa,
  calculateQuadraticWeightedKappa,
  calculateF1,
} from '@interactive-flow/shared';
import { z } from 'zod';

// =============================================================================
// Configuration
// =============================================================================

interface ScoreConfig {
  manifestPath: string;
  labelsPath: string;
  predictionsPath: string;
  baselinePath?: string;
  outputPath: string;
  split: BenchmarkSplit | 'all';
  engineVersion: string;
}

function parseArgs(): ScoreConfig {
  const args = process.argv.slice(2);
  const config: ScoreConfig = {
    manifestPath: './benchmark/manifest.json',
    labelsPath: './benchmark/adjudicated-labels.json',
    predictionsPath: './benchmark/predictions.json',
    baselinePath: undefined,
    outputPath: './benchmark/score-report.json',
    split: 'holdout',
    engineVersion: 'unknown',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--manifest':
        config.manifestPath = args[++i];
        break;
      case '--labels':
        config.labelsPath = args[++i];
        break;
      case '--predictions':
        config.predictionsPath = args[++i];
        break;
      case '--baseline':
        config.baselinePath = args[++i];
        break;
      case '--output':
        config.outputPath = args[++i];
        break;
      case '--split':
        config.split = args[++i] as BenchmarkSplit | 'all';
        break;
      case '--engine':
        config.engineVersion = args[++i];
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
Score Benchmark Script - FlowSense V3 Accuracy Upgrade

Usage:
  npx tsx scripts/eval/score-benchmark.ts [options]

Options:
  --manifest <path>      Path to benchmark manifest (default: ./benchmark/manifest.json)
  --labels <path>        Path to adjudicated labels JSON (default: ./benchmark/adjudicated-labels.json)
  --predictions <path>   Path to model predictions JSON (default: ./benchmark/predictions.json)
  --baseline <path>      Optional: path to baseline predictions for uplift calculation
  --output <path>        Output path for score report (default: ./benchmark/score-report.json)
  --split <split>        Evaluate on: calibration, holdout, or all (default: holdout)
  --engine <version>     Engine version being evaluated (for report metadata)
  --help                 Show this help message

Examples:
  # Score V3 predictions against holdout set
  npx tsx scripts/eval/score-benchmark.ts --predictions ./predictions-v3.json --engine v3_hybrid

  # Compare V3 to V2 baseline
  npx tsx scripts/eval/score-benchmark.ts \\
    --predictions ./predictions-v3.json \\
    --baseline ./predictions-v2.json \\
    --engine v3_hybrid
`);
}

// =============================================================================
// Data Types
// =============================================================================

interface Prediction {
  case_id: string;
  rubric_scores: RubricScores;
  issue_tags: IssueTag[];
  quality_gate_status: 'pass' | 'warn' | 'block';
}

const predictionSchema = z.object({
  case_id: z.string(),
  rubric_scores: z.object({
    cat1: z.number().int().min(0).max(2),
    cat2: z.number().int().min(0).max(2),
    cat3: z.number().int().min(0).max(2),
    cat4: z.number().int().min(0).max(2),
    cat5: z.number().int().min(0).max(2),
    cat6: z.number().int().min(0).max(2),
    cat7: z.number().int().min(0).max(2),
  }),
  issue_tags: z.array(z.string()),
  quality_gate_status: z.enum(['pass', 'warn', 'block']),
});

const predictionsFileSchema = z.object({
  version: z.string(),
  engine_version: z.string(),
  predictions: z.array(predictionSchema),
});

// =============================================================================
// Metric Calculation
// =============================================================================

const SCORE_CATEGORIES: (keyof RubricScores)[] = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7'];

function calculateCategoryMetrics(
  labels: AdjudicatedLabel[],
  predictions: Prediction[]
): Record<keyof RubricScores, CategoryMetrics> {
  const metrics: Record<keyof RubricScores, CategoryMetrics> = {} as any;

  for (const category of SCORE_CATEGORIES) {
    const labelScores: number[] = [];
    const predScores: number[] = [];

    for (const label of labels) {
      const pred = predictions.find(p => p.case_id === label.case_id);
      if (pred) {
        labelScores.push(label.rubric_scores[category]);
        predScores.push(pred.rubric_scores[category]);
      }
    }

    const kappa = calculateKappa(labelScores, predScores);
    const qwk = calculateQuadraticWeightedKappa(labelScores, predScores);
    const agreement = labelScores.reduce((sum, score, i) =>
      sum + (score === predScores[i] ? 1 : 0), 0) / labelScores.length;

    metrics[category] = {
      kappa,
      quadratic_weighted_kappa: qwk,
      percent_agreement: agreement,
      n: labelScores.length,
    };
  }

  return metrics;
}

function calculateIssueTagMetrics(
  labels: AdjudicatedLabel[],
  predictions: Prediction[]
): IssueTagMetrics {
  // Get all unique tags
  const allTags = new Set<string>();
  labels.forEach(l => l.issue_tags.forEach(t => allTags.add(t)));
  predictions.forEach(p => p.issue_tags.forEach(t => allTags.add(t)));

  const perTag: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};

  for (const tag of allTags) {
    let tp = 0, fp = 0, fn = 0;

    for (const label of labels) {
      const pred = predictions.find(p => p.case_id === label.case_id);
      if (!pred) continue;

      const labelHas = label.issue_tags.includes(tag as IssueTag);
      const predHas = pred.issue_tags.includes(tag as IssueTag);

      if (labelHas && predHas) tp++;
      else if (!labelHas && predHas) fp++;
      else if (labelHas && !predHas) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = calculateF1(precision, recall);

    perTag[tag] = {
      precision,
      recall,
      f1,
      support: tp + fn,
    };
  }

  // Calculate macro F1
  const tagF1s = Object.values(perTag).map(t => t.f1);
  const macroF1 = tagF1s.length > 0 ? tagF1s.reduce((a, b) => a + b, 0) / tagF1s.length : 0;

  return {
    macro_f1: macroF1,
    per_tag: perTag,
  };
}

function calculateGateMetrics(
  labels: AdjudicatedLabel[],
  predictions: Prediction[]
): GateMetrics {
  const gateValues = ['pass', 'warn', 'block'] as const;
  const matrix: GateMetrics['confusion_matrix'] = {
    pass: { pass: 0, warn: 0, block: 0 },
    warn: { pass: 0, warn: 0, block: 0 },
    block: { pass: 0, warn: 0, block: 0 },
  };

  for (const label of labels) {
    const pred = predictions.find(p => p.case_id === label.case_id);
    if (!pred) continue;

    matrix[label.quality_gate_status][pred.quality_gate_status]++;
  }

  // Calculate metrics
  const totalBlocks = matrix.block.pass + matrix.block.warn + matrix.block.block;
  const predictedBlocks = matrix.pass.block + matrix.warn.block + matrix.block.block;
  const correctBlocks = matrix.block.block;
  const falseBlocks = matrix.pass.block + matrix.warn.block;
  const totalNonBlocks = labels.length - totalBlocks;

  const blockPrecision = predictedBlocks > 0 ? correctBlocks / predictedBlocks : 1;
  const blockRecall = totalBlocks > 0 ? correctBlocks / totalBlocks : 1;
  const falseBlockRate = totalNonBlocks > 0 ? falseBlocks / totalNonBlocks : 0;

  // Overall accuracy
  let correct = 0;
  for (const gate of gateValues) {
    correct += matrix[gate][gate];
  }
  const gateAccuracy = labels.length > 0 ? correct / labels.length : 0;

  return {
    confusion_matrix: matrix,
    block_precision: blockPrecision,
    block_recall: blockRecall,
    false_block_rate: falseBlockRate,
    gate_accuracy: gateAccuracy,
  };
}

function evaluateReleaseCriteria(
  categoryMetrics: Record<keyof RubricScores, CategoryMetrics>,
  issueTagMetrics: IssueTagMetrics,
  gateMetrics: GateMetrics,
  baselineMeanKappa?: number
): BenchmarkScoreReport['release_criteria'] {
  const { RELEASE_CRITERIA } = BENCHMARK_CONFIG;

  // Calculate mean QWK
  const qwks = SCORE_CATEGORIES.map(c => categoryMetrics[c].quadratic_weighted_kappa);
  const meanKappa = qwks.reduce((a, b) => a + b, 0) / qwks.length;

  const kappaUplift = baselineMeanKappa !== undefined ? meanKappa - baselineMeanKappa : 0;

  return {
    kappa_threshold: RELEASE_CRITERIA.MEAN_KAPPA_THRESHOLD,
    kappa_met: meanKappa >= RELEASE_CRITERIA.MEAN_KAPPA_THRESHOLD,
    kappa_uplift_target: RELEASE_CRITERIA.KAPPA_UPLIFT_TARGET,
    kappa_uplift_met: baselineMeanKappa === undefined || kappaUplift >= RELEASE_CRITERIA.KAPPA_UPLIFT_TARGET,
    issue_f1_threshold: RELEASE_CRITERIA.ISSUE_TAG_MACRO_F1_THRESHOLD,
    issue_f1_met: issueTagMetrics.macro_f1 >= RELEASE_CRITERIA.ISSUE_TAG_MACRO_F1_THRESHOLD,
    block_precision_threshold: RELEASE_CRITERIA.BLOCK_PRECISION_THRESHOLD,
    block_precision_met: gateMetrics.block_precision >= RELEASE_CRITERIA.BLOCK_PRECISION_THRESHOLD,
    false_block_threshold: RELEASE_CRITERIA.FALSE_BLOCK_RATE_THRESHOLD,
    false_block_met: gateMetrics.false_block_rate <= RELEASE_CRITERIA.FALSE_BLOCK_RATE_THRESHOLD,
    all_criteria_met: false, // Set below
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('FlowSense Benchmark Scorer - V3 Accuracy Upgrade');
  console.log('='.repeat(60));
  console.log();
  console.log('Configuration:');
  console.log(`  Manifest: ${config.manifestPath}`);
  console.log(`  Labels: ${config.labelsPath}`);
  console.log(`  Predictions: ${config.predictionsPath}`);
  console.log(`  Baseline: ${config.baselinePath || '(none)'}`);
  console.log(`  Split: ${config.split}`);
  console.log(`  Engine: ${config.engineVersion}`);
  console.log();

  // Load manifest
  console.log('[1/5] Loading benchmark manifest...');
  if (!fs.existsSync(config.manifestPath)) {
    console.error(`Error: Manifest not found at ${config.manifestPath}`);
    process.exit(1);
  }
  const manifest: BenchmarkManifest = JSON.parse(fs.readFileSync(config.manifestPath, 'utf-8'));
  console.log(`  Loaded ${manifest.total_cases} cases`);

  // Filter cases by split
  const splitCaseIds = new Set(
    config.split === 'all'
      ? manifest.cases.map(c => c.case_id)
      : manifest.cases.filter(c => c.split === config.split).map(c => c.case_id)
  );
  console.log(`  Evaluating ${splitCaseIds.size} cases from ${config.split} split`);

  // Load labels
  console.log('[2/5] Loading adjudicated labels...');
  if (!fs.existsSync(config.labelsPath)) {
    console.error(`Error: Labels not found at ${config.labelsPath}`);
    console.error('Create adjudicated labels first.');
    process.exit(1);
  }
  const labelsData = JSON.parse(fs.readFileSync(config.labelsPath, 'utf-8'));
  const labels: AdjudicatedLabel[] = labelsData.labels || labelsData;
  const filteredLabels = labels.filter(l => splitCaseIds.has(l.case_id));
  console.log(`  Loaded ${filteredLabels.length} labels`);

  // Load predictions
  console.log('[3/5] Loading predictions...');
  if (!fs.existsSync(config.predictionsPath)) {
    console.error(`Error: Predictions not found at ${config.predictionsPath}`);
    process.exit(1);
  }
  const predictionsData = JSON.parse(fs.readFileSync(config.predictionsPath, 'utf-8'));
  const predictions: Prediction[] = predictionsData.predictions || predictionsData;
  const filteredPredictions = predictions.filter(p => splitCaseIds.has(p.case_id));
  console.log(`  Loaded ${filteredPredictions.length} predictions`);

  // Load baseline if provided
  let baselineMeanKappa: number | undefined;
  if (config.baselinePath && fs.existsSync(config.baselinePath)) {
    console.log('[3b/5] Loading baseline predictions...');
    const baselineData = JSON.parse(fs.readFileSync(config.baselinePath, 'utf-8'));
    const baselinePreds: Prediction[] = baselineData.predictions || baselineData;
    const filteredBaseline = baselinePreds.filter(p => splitCaseIds.has(p.case_id));

    const baselineMetrics = calculateCategoryMetrics(filteredLabels, filteredBaseline);
    const qwks = SCORE_CATEGORIES.map(c => baselineMetrics[c].quadratic_weighted_kappa);
    baselineMeanKappa = qwks.reduce((a, b) => a + b, 0) / qwks.length;
    console.log(`  Baseline mean QWK: ${baselineMeanKappa.toFixed(3)}`);
  }

  // Calculate metrics
  console.log('[4/5] Calculating metrics...');
  const categoryMetrics = calculateCategoryMetrics(filteredLabels, filteredPredictions);
  const issueTagMetrics = calculateIssueTagMetrics(filteredLabels, filteredPredictions);
  const gateMetrics = calculateGateMetrics(filteredLabels, filteredPredictions);

  const meanQWK = SCORE_CATEGORIES.map(c => categoryMetrics[c].quadratic_weighted_kappa)
    .reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length;

  console.log(`  Mean Quadratic Weighted Kappa: ${meanQWK.toFixed(3)}`);
  console.log(`  Issue Tag Macro F1: ${issueTagMetrics.macro_f1.toFixed(3)}`);
  console.log(`  Block Precision: ${gateMetrics.block_precision.toFixed(3)}`);
  console.log(`  False Block Rate: ${gateMetrics.false_block_rate.toFixed(3)}`);

  // Evaluate release criteria
  const releaseCriteria = evaluateReleaseCriteria(
    categoryMetrics,
    issueTagMetrics,
    gateMetrics,
    baselineMeanKappa
  );
  releaseCriteria.all_criteria_met =
    releaseCriteria.kappa_met &&
    releaseCriteria.kappa_uplift_met &&
    releaseCriteria.issue_f1_met &&
    releaseCriteria.block_precision_met &&
    releaseCriteria.false_block_met;

  // Build report
  const report: BenchmarkScoreReport = {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    engine_version: config.engineVersion,
    manifest_version: manifest.version,
    split: config.split === 'all' ? 'calibration' : config.split, // Default to calibration for type
    cases_evaluated: filteredLabels.length,
    category_metrics: categoryMetrics,
    mean_quadratic_weighted_kappa: meanQWK,
    issue_tag_metrics: issueTagMetrics,
    gate_metrics: gateMetrics,
    release_criteria: releaseCriteria,
  };

  // Write report
  console.log('[5/5] Writing score report...');
  const outputDir = path.dirname(config.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(config.outputPath, JSON.stringify(report, null, 2));
  console.log(`  Wrote report to ${config.outputPath}`);

  // Print summary
  console.log();
  console.log('='.repeat(60));
  console.log('BENCHMARK SCORE REPORT');
  console.log('='.repeat(60));
  console.log();
  console.log('Category Metrics:');
  for (const cat of SCORE_CATEGORIES) {
    const m = categoryMetrics[cat];
    console.log(`  ${cat}: QWK=${m.quadratic_weighted_kappa.toFixed(3)}, Agreement=${(m.percent_agreement * 100).toFixed(1)}%`);
  }
  console.log();
  console.log(`Mean QWK: ${meanQWK.toFixed(3)} (threshold: ${releaseCriteria.kappa_threshold})`);
  if (baselineMeanKappa !== undefined) {
    console.log(`Uplift vs baseline: ${(meanQWK - baselineMeanKappa).toFixed(3)} (target: +${releaseCriteria.kappa_uplift_target})`);
  }
  console.log();
  console.log('Issue Tag Metrics:');
  console.log(`  Macro F1: ${issueTagMetrics.macro_f1.toFixed(3)} (threshold: ${releaseCriteria.issue_f1_threshold})`);
  console.log();
  console.log('Gate Metrics:');
  console.log(`  Block Precision: ${gateMetrics.block_precision.toFixed(3)} (threshold: ${releaseCriteria.block_precision_threshold})`);
  console.log(`  False Block Rate: ${gateMetrics.false_block_rate.toFixed(3)} (threshold: <= ${releaseCriteria.false_block_threshold})`);
  console.log(`  Gate Accuracy: ${(gateMetrics.gate_accuracy * 100).toFixed(1)}%`);
  console.log();
  console.log('Release Criteria:');
  console.log(`  Kappa: ${releaseCriteria.kappa_met ? 'PASS' : 'FAIL'}`);
  console.log(`  Kappa Uplift: ${releaseCriteria.kappa_uplift_met ? 'PASS' : 'FAIL'}`);
  console.log(`  Issue F1: ${releaseCriteria.issue_f1_met ? 'PASS' : 'FAIL'}`);
  console.log(`  Block Precision: ${releaseCriteria.block_precision_met ? 'PASS' : 'FAIL'}`);
  console.log(`  False Block Rate: ${releaseCriteria.false_block_met ? 'PASS' : 'FAIL'}`);
  console.log();
  console.log(`ALL CRITERIA: ${releaseCriteria.all_criteria_met ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Scoring failed:', err);
  process.exit(1);
});
