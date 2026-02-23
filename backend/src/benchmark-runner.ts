/**
 * Benchmark Runner
 * V3 Accuracy Upgrade - Day 9: Validation + Benchmark Execution
 *
 * Executes V2 and V3 analysis engines on benchmark cases and produces
 * predictions that can be compared against ground truth labels.
 */

import { downloadBlob } from './azure-storage';
import { analyzeFrame, analyzeFrameV3 } from './vision';
import { executeTwoPassInference } from './two-pass-inference';
import { generateSummary, calculateWeightedScore100, determineQualityGateStatus, determineSeverity } from './summary';
import { preprocessFramesForAnalysis, calculateSSIM } from './preprocessing';
import { getAnalysisConfig, getPreprocessingConfig, getTwoPassConfig } from './env';
import { trackMetric, trackEvent } from './telemetry';
import sharp from 'sharp';
import {
  type BenchmarkCase,
  type BenchmarkManifest,
  type AdjudicatedLabel,
  type BenchmarkSplit,
  type RubricScores,
  type IssueTag,
  type TopIssue,
  ANALYSIS_ENGINE_VERSIONS,
  type AnalysisEngineVersion,
  type PreprocessingDiagnostics,
  type FrameChangeContext,
  createEmptyRunTelemetry,
  type PredictedAnalysis,
  type ExtendedBenchmarkReport,
  generateBenchmarkReport,
  formatBenchmarkReportText,
  calibrateThresholds,
} from '@interactive-flow/shared';

// =============================================================================
// Types
// =============================================================================

export interface BenchmarkRunnerConfig {
  /** Engine version to evaluate */
  engineVersion: AnalysisEngineVersion;
  /** Baseline engine for comparison (optional) */
  baselineEngine?: AnalysisEngineVersion;
  /** Split to evaluate */
  split: BenchmarkSplit;
  /** Maximum cases to process (for testing) */
  maxCases?: number;
  /** Whether to run baseline comparison */
  runBaseline?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, caseId: string) => void;
}

export interface BenchmarkFrameData {
  frameId: string;
  buffer: Buffer;
  timestampMs: number;
  isKeyframe: boolean;
  storagePath: string;
  changeContext?: FrameChangeContext;
}

export interface BenchmarkCaseData {
  case: BenchmarkCase;
  frames: BenchmarkFrameData[];
  groundTruth?: AdjudicatedLabel;
}

export interface BenchmarkRunResult {
  /** Primary engine predictions */
  predictions: PredictedAnalysis[];
  /** Baseline engine predictions (if runBaseline=true) */
  baselinePredictions?: PredictedAnalysis[];
  /** Primary engine report */
  report: ExtendedBenchmarkReport;
  /** Baseline engine report (if runBaseline=true) */
  baselineReport?: ExtendedBenchmarkReport;
  /** Formatted text report */
  reportText: string;
  /** Execution metadata */
  metadata: {
    startTime: string;
    endTime: string;
    durationMs: number;
    casesProcessed: number;
    casesFailed: number;
    engineVersion: string;
    baselineEngineVersion?: string;
  };
}

// =============================================================================
// Frame Strip Building
// =============================================================================

async function buildFrameStrip(buffers: Buffer[], targetHeight = 360): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('No frames provided for strip');
  }

  const resized = await Promise.all(
    buffers.map(buffer =>
      sharp(buffer).resize({ height: targetHeight }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
    )
  );

  if (resized.length === 1) {
    return resized[0].data;
  }

  const widths = resized.map(result => result.info.width || 0);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  if (totalWidth <= 0) {
    return resized[0].data;
  }

  let offsetX = 0;
  const composites = resized.map((result, index) => {
    const input = {
      input: result.data,
      top: 0,
      left: offsetX,
    };
    offsetX += widths[index];
    return input;
  });

  return sharp({
    create: {
      width: totalWidth,
      height: targetHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
}

// =============================================================================
// Analysis Functions
// =============================================================================

interface FrameAnalysisResult {
  rubric_scores: Record<string, number>;
  issue_tags: string[];
  justifications: Record<string, string>;
  suggestions: Array<{ title?: string; description?: string; severity?: string }>;
}

/**
 * Analyze a single benchmark case with V2 engine
 */
async function analyzeWithV2(
  frames: BenchmarkFrameData[],
  engineVersion: AnalysisEngineVersion
): Promise<{
  analyses: FrameAnalysisResult[];
  tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  inferenceMs: number;
}> {
  const keyframes = frames.filter(f => f.isKeyframe).sort((a, b) => a.timestampMs - b.timestampMs);
  const analyses: FrameAnalysisResult[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalInferenceMs = 0;
  const contextTrail: string[] = [];

  for (let index = 0; index < keyframes.length; index++) {
    const frame = keyframes[index];

    // Build context strip
    const contextStart = Math.max(0, index - 2);
    const contextEnd = Math.min(keyframes.length, index + 3);
    const contextFrames = keyframes.slice(contextStart, contextEnd);
    const contextBuffers = contextFrames.map(f => f.buffer);
    const stripBuffer = await buildFrameStrip(contextBuffers);
    const timestamps = contextFrames.map(f => f.timestampMs);

    const priorContext = contextTrail.length > 0 ? contextTrail.join('\n') : undefined;

    const result = await analyzeFrame(
      stripBuffer,
      {
        sequence: {
          count: contextFrames.length,
          order: 'left-to-right oldest-to-newest',
          timestampsMs: timestamps,
        },
        priorContext,
        changeContext: frame.changeContext,
      },
      engineVersion
    );

    analyses.push(result.analysis);
    totalPromptTokens += result.telemetry.promptTokens;
    totalCompletionTokens += result.telemetry.completionTokens;
    totalInferenceMs += result.telemetry.inferenceMs;

    // Update context trail
    const topIssues = (result.analysis.issue_tags || []).slice(0, 3);
    const summary = `t=${frame.timestampMs}ms: ${topIssues.length > 0 ? topIssues.join(', ') : 'No issues'}`;
    contextTrail.push(summary);
    if (contextTrail.length > 5) contextTrail.shift();
  }

  return {
    analyses,
    tokenUsage: {
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_tokens: totalPromptTokens + totalCompletionTokens,
    },
    inferenceMs: totalInferenceMs,
  };
}

/**
 * Analyze a single benchmark case with V3 engine (with preprocessing and two-pass)
 */
async function analyzeWithV3(
  frames: BenchmarkFrameData[],
  engineVersion: AnalysisEngineVersion
): Promise<{
  analyses: FrameAnalysisResult[];
  tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  inferenceMs: number;
  truncated: boolean;
}> {
  const preprocessingConfig = getPreprocessingConfig();
  const twoPassConfig = getTwoPassConfig();
  const analysisConfig = getAnalysisConfig();

  // Sort frames by timestamp
  const sortedFrames = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  const keyframes = sortedFrames.filter(f => f.isKeyframe);

  // Preprocess frames
  const preprocessResult = await preprocessFramesForAnalysis(
    sortedFrames.map(f => ({
      id: f.frameId,
      buffer: f.buffer,
      timestampMs: f.timestampMs,
      isKeyframe: f.isKeyframe,
      changeContext: f.changeContext,
    })),
    preprocessingConfig
  );

  const analyses: FrameAnalysisResult[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalInferenceMs = 0;
  let totalTokens = 0;
  let truncated = false;
  const contextTrail: string[] = [];

  for (let index = 0; index < keyframes.length; index++) {
    // Check token budget
    if (totalTokens >= analysisConfig.tokenHardCapTotal) {
      truncated = true;
      break;
    }

    const preprocessed = preprocessResult.frames[index];
    const priorContext = contextTrail.length > 0 ? contextTrail.join('\n') : undefined;

    // Calculate SSIM scores for diagnostics
    let ssimScores: number[] | undefined;
    if (preprocessed.temporalWindow.buffers.length >= 2) {
      ssimScores = [];
      for (let i = 0; i < preprocessed.temporalWindow.buffers.length - 1; i++) {
        const ssim = await calculateSSIM(
          preprocessed.temporalWindow.buffers[i],
          preprocessed.temporalWindow.buffers[i + 1]
        );
        ssimScores.push(ssim);
      }
    }

    const diagnostics: PreprocessingDiagnostics = {
      preprocessFallback: preprocessed.preprocessFallback,
      fallbackReason: preprocessed.fallbackReason as PreprocessingDiagnostics['fallbackReason'],
      ssimScores,
      avgChangeIntensity: preprocessed.changeContext.overallChangeScore,
      temporalWindowSize: preprocessed.temporalWindow.buffers.length,
      preprocessingMs: 0,
    };

    let analysis: FrameAnalysisResult;
    let frameTokens = 0;
    let frameInferenceMs = 0;

    if (twoPassConfig.enableTwoPass) {
      // Use two-pass inference
      const twoPassResult = await executeTwoPassInference(
        preprocessed.rawStrip,
        preprocessed.diffHeatmapStrip,
        preprocessed.changeCrop,
        {
          temporalMetadata: {
            relativeIndices: preprocessed.temporalWindow.relativeIndices,
            timestamps: preprocessed.temporalWindow.timestamps,
            deltaMs: preprocessed.temporalWindow.deltaMs,
            keyframeIndex: preprocessed.temporalWindow.relativeIndices.indexOf(0),
          },
          priorContextTrail: priorContext,
          changeContext: preprocessed.changeContext,
          diagnostics,
          keyframeIndex: index,
        },
        engineVersion
      );

      analysis = twoPassResult.rubricAnalysis;
      frameTokens = twoPassResult.telemetry.totalTokens;
      frameInferenceMs = twoPassResult.telemetry.totalMs;
    } else {
      // Single-pass V3
      const result = await analyzeFrameV3(
        preprocessed.rawStrip,
        preprocessed.diffHeatmapStrip,
        preprocessed.changeCrop,
        {
          temporalMetadata: {
            relativeIndices: preprocessed.temporalWindow.relativeIndices,
            timestamps: preprocessed.temporalWindow.timestamps,
            deltaMs: preprocessed.temporalWindow.deltaMs,
            keyframeIndex: preprocessed.temporalWindow.relativeIndices.indexOf(0),
          },
          priorContextTrail: priorContext,
          changeContext: preprocessed.changeContext,
          diagnostics,
          keyframeIndex: index,
        },
        engineVersion
      );

      analysis = result.analysis;
      frameTokens = result.telemetry.totalTokens;
      frameInferenceMs = result.telemetry.inferenceMs;
    }

    analyses.push(analysis);
    totalTokens += frameTokens;
    totalInferenceMs += frameInferenceMs;

    // Update context trail
    const topIssues = (analysis.issue_tags || []).slice(0, 3);
    const summary = `t=${keyframes[index].timestampMs}ms: ${topIssues.length > 0 ? topIssues.join(', ') : 'No issues'}`;
    contextTrail.push(summary);
    if (contextTrail.length > 5) contextTrail.shift();
  }

  return {
    analyses,
    tokenUsage: {
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_tokens: totalTokens,
    },
    inferenceMs: totalInferenceMs,
    truncated,
  };
}

/**
 * Aggregate frame analyses into a case-level prediction
 */
function aggregatePrediction(
  caseId: string,
  analyses: FrameAnalysisResult[],
  engineVersion: string,
  tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  inferenceMs: number,
  truncated: boolean
): PredictedAnalysis {
  if (analyses.length === 0) {
    throw new Error(`No analyses for case ${caseId}`);
  }

  // Aggregate rubric scores (average, then round)
  const categories = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7'] as const;
  const rubricScores: RubricScores = {
    cat1: 0,
    cat2: 0,
    cat3: 0,
    cat4: 0,
    cat5: 0,
    cat6: 0,
    cat7: 0,
  };

  for (const cat of categories) {
    const avg = analyses.reduce((sum, a) => sum + (a.rubric_scores[cat] ?? 0), 0) / analyses.length;
    rubricScores[cat] = Math.round(avg) as 0 | 1 | 2;
  }

  // Aggregate issue tags (union with counts)
  const issueCountMap = new Map<string, number>();
  for (const analysis of analyses) {
    for (const tag of analysis.issue_tags) {
      issueCountMap.set(tag, (issueCountMap.get(tag) || 0) + 1);
    }
  }

  const issueTags = Array.from(issueCountMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag as IssueTag);

  // Calculate top issues for critical count
  const topIssues: TopIssue[] = Array.from(issueCountMap.entries())
    .map(([tag, count]) => ({
      tag: tag as IssueTag,
      count,
      severity: determineSeverity(tag as IssueTag),
      description: '',
      sourceFrameIds: [],  // Benchmark doesn't track frame sources
    }))
    .filter(issue => issue.severity === 'high');

  const weightedScore100 = calculateWeightedScore100(rubricScores);
  const criticalIssueCount = topIssues.reduce((sum, issue) => sum + issue.count, 0);
  let qualityGateStatus = determineQualityGateStatus(weightedScore100, criticalIssueCount);

  // Downgrade to warn if truncated
  if (truncated && qualityGateStatus === 'pass') {
    qualityGateStatus = 'warn';
  }

  return {
    case_id: caseId,
    rubric_scores: rubricScores,
    issue_tags: issueTags,
    quality_gate_status: qualityGateStatus,
    weighted_score_100: weightedScore100,
    critical_issue_count: criticalIssueCount,
    engine_version: engineVersion,
    token_usage: tokenUsage,
    inference_ms: inferenceMs,
    analysis_truncated: truncated,
  };
}

// =============================================================================
// Main Benchmark Runner
// =============================================================================

/**
 * Run benchmark evaluation on a set of cases
 */
export async function runBenchmark(
  manifest: BenchmarkManifest,
  caseDataLoader: (caseId: string) => Promise<BenchmarkCaseData>,
  groundTruth: AdjudicatedLabel[],
  config: BenchmarkRunnerConfig
): Promise<BenchmarkRunResult> {
  const startTime = new Date();
  console.log('═'.repeat(60));
  console.log(`BENCHMARK RUNNER - ${config.engineVersion}`);
  console.log('═'.repeat(60));
  console.log(`Split: ${config.split}`);
  console.log(`Engine: ${config.engineVersion}`);
  if (config.baselineEngine) {
    console.log(`Baseline: ${config.baselineEngine}`);
  }
  console.log('');

  // Filter cases by split
  const casesToRun = manifest.cases
    .filter(c => c.split === config.split)
    .slice(0, config.maxCases);

  console.log(`Cases to evaluate: ${casesToRun.length}`);

  const predictions: PredictedAnalysis[] = [];
  const baselinePredictions: PredictedAnalysis[] = [];
  let casesFailed = 0;

  for (let i = 0; i < casesToRun.length; i++) {
    const benchmarkCase = casesToRun[i];

    try {
      config.onProgress?.(i + 1, casesToRun.length, benchmarkCase.case_id);
      console.log(`[${i + 1}/${casesToRun.length}] Processing case: ${benchmarkCase.case_id}`);

      // Load case data
      const caseData = await caseDataLoader(benchmarkCase.case_id);

      // Run primary engine
      console.log(`  Running ${config.engineVersion}...`);
      const isV3 = config.engineVersion === ANALYSIS_ENGINE_VERSIONS.V3_HYBRID;
      const primaryResult = isV3
        ? await analyzeWithV3(caseData.frames, config.engineVersion)
        : await analyzeWithV2(caseData.frames, config.engineVersion);

      // V3 returns truncated flag, V2 does not
      const wasTruncated = 'truncated' in primaryResult && typeof primaryResult.truncated === 'boolean'
        ? primaryResult.truncated
        : false;

      const prediction = aggregatePrediction(
        benchmarkCase.case_id,
        primaryResult.analyses,
        config.engineVersion,
        primaryResult.tokenUsage,
        primaryResult.inferenceMs,
        wasTruncated
      );
      predictions.push(prediction);

      // Run baseline engine if configured
      if (config.runBaseline && config.baselineEngine) {
        console.log(`  Running baseline ${config.baselineEngine}...`);
        const baselineResult = await analyzeWithV2(caseData.frames, config.baselineEngine);
        const baselinePred = aggregatePrediction(
          benchmarkCase.case_id,
          baselineResult.analyses,
          config.baselineEngine,
          baselineResult.tokenUsage,
          baselineResult.inferenceMs,
          false
        );
        baselinePredictions.push(baselinePred);
      }

      console.log(`  ✓ Done - Score: ${prediction.weighted_score_100}, Gate: ${prediction.quality_gate_status}`);

      // Track metrics
      trackMetric('benchmark.case_tokens', prediction.token_usage.total_tokens, {
        caseId: benchmarkCase.case_id,
        engine: config.engineVersion,
      });
      trackMetric('benchmark.case_inference_ms', prediction.inference_ms, {
        caseId: benchmarkCase.case_id,
        engine: config.engineVersion,
      });

    } catch (error) {
      console.error(`  ✗ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      casesFailed++;
    }
  }

  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Completed: ${predictions.length} succeeded, ${casesFailed} failed`);
  console.log(`Duration: ${(durationMs / 1000 / 60).toFixed(2)} minutes`);
  console.log('');

  // Generate reports
  console.log('Generating benchmark report...');
  const report = generateBenchmarkReport(
    predictions,
    groundTruth,
    manifest.cases,
    config.engineVersion,
    manifest.version,
    config.split,
    config.runBaseline ? baselinePredictions : undefined
  );

  let baselineReport: ExtendedBenchmarkReport | undefined;
  if (config.runBaseline && baselinePredictions.length > 0 && config.baselineEngine) {
    baselineReport = generateBenchmarkReport(
      baselinePredictions,
      groundTruth,
      manifest.cases,
      config.baselineEngine,
      manifest.version,
      config.split
    );
  }

  const reportText = formatBenchmarkReportText(report);

  // Track overall metrics
  trackEvent('benchmark.run_completed', {
    engine: config.engineVersion,
    split: config.split,
    casesProcessed: String(predictions.length),
    casesFailed: String(casesFailed),
    durationMs: String(durationMs),
    meanQWK: String(report.mean_quadratic_weighted_kappa),
    macroF1: String(report.issue_tag_metrics.macro_f1),
    falseBlockRate: String(report.gate_metrics.false_block_rate),
  });

  return {
    predictions,
    baselinePredictions: config.runBaseline ? baselinePredictions : undefined,
    report,
    baselineReport,
    reportText,
    metadata: {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs,
      casesProcessed: predictions.length,
      casesFailed,
      engineVersion: config.engineVersion,
      baselineEngineVersion: config.baselineEngine,
    },
  };
}

/**
 * Run calibration on the calibration set and rerun on holdout
 */
export async function runCalibrationAndHoldout(
  manifest: BenchmarkManifest,
  caseDataLoader: (caseId: string) => Promise<BenchmarkCaseData>,
  groundTruth: AdjudicatedLabel[],
  engineVersion: AnalysisEngineVersion,
  baselineEngine?: AnalysisEngineVersion,
  onProgress?: (phase: string, current: number, total: number) => void
): Promise<{
  calibrationReport: ExtendedBenchmarkReport;
  holdoutReport: ExtendedBenchmarkReport;
  calibratedThresholds: {
    block_score_threshold: number;
    pass_score_threshold: number;
    critical_issue_block_threshold: number;
  };
  finalReportText: string;
}> {
  console.log('═'.repeat(80));
  console.log('CALIBRATION + HOLDOUT BENCHMARK RUN');
  console.log('═'.repeat(80));
  console.log('');

  // Phase 1: Run on calibration set
  console.log('PHASE 1: CALIBRATION SET');
  console.log('─'.repeat(40));
  const calibrationResult = await runBenchmark(manifest, caseDataLoader, groundTruth, {
    engineVersion,
    baselineEngine,
    split: 'calibration',
    runBaseline: !!baselineEngine,
    onProgress: (current, total, caseId) => onProgress?.('calibration', current, total),
  });

  // Phase 2: Calibrate thresholds
  console.log('');
  console.log('PHASE 2: THRESHOLD CALIBRATION');
  console.log('─'.repeat(40));
  const calibrationGT = groundTruth.filter(gt =>
    manifest.cases.some(c => c.case_id === gt.case_id && c.split === 'calibration')
  );
  const calibratedThresholds = calibrateThresholds(calibrationResult.predictions, calibrationGT);
  console.log(`Calibrated thresholds:`);
  console.log(`  block_score_threshold: ${calibratedThresholds.block_score_threshold}`);
  console.log(`  pass_score_threshold: ${calibratedThresholds.pass_score_threshold}`);
  console.log(`  critical_issue_block_threshold: ${calibratedThresholds.critical_issue_block_threshold}`);
  console.log('');

  // Phase 3: Run on holdout set with calibrated thresholds
  console.log('PHASE 3: HOLDOUT SET');
  console.log('─'.repeat(40));
  const holdoutResult = await runBenchmark(manifest, caseDataLoader, groundTruth, {
    engineVersion,
    baselineEngine,
    split: 'holdout',
    runBaseline: !!baselineEngine,
    onProgress: (current, total, caseId) => onProgress?.('holdout', current, total),
  });

  // Generate final combined report
  const finalReportLines: string[] = [];
  finalReportLines.push('╔'.padEnd(79, '═') + '╗');
  finalReportLines.push('║ FINAL BENCHMARK REPORT - CALIBRATION + HOLDOUT'.padEnd(78) + '║');
  finalReportLines.push('╚'.padEnd(79, '═') + '╝');
  finalReportLines.push('');
  finalReportLines.push('CALIBRATION SET RESULTS:');
  finalReportLines.push('─'.repeat(40));
  finalReportLines.push(`Mean QWK: ${calibrationResult.report.mean_quadratic_weighted_kappa.toFixed(4)}`);
  finalReportLines.push(`Macro F1: ${calibrationResult.report.issue_tag_metrics.macro_f1.toFixed(4)}`);
  finalReportLines.push(`False Block Rate: ${(calibrationResult.report.gate_metrics.false_block_rate * 100).toFixed(2)}%`);
  finalReportLines.push('');
  finalReportLines.push('CALIBRATED THRESHOLDS:');
  finalReportLines.push('─'.repeat(40));
  finalReportLines.push(`Block Score: ${calibratedThresholds.block_score_threshold}`);
  finalReportLines.push(`Pass Score: ${calibratedThresholds.pass_score_threshold}`);
  finalReportLines.push(`Critical Issue: ${calibratedThresholds.critical_issue_block_threshold}`);
  finalReportLines.push('');
  finalReportLines.push('HOLDOUT SET RESULTS (FINAL):');
  finalReportLines.push('─'.repeat(40));
  finalReportLines.push(holdoutResult.reportText);

  return {
    calibrationReport: calibrationResult.report,
    holdoutReport: holdoutResult.report,
    calibratedThresholds: {
      block_score_threshold: calibratedThresholds.block_score_threshold,
      pass_score_threshold: calibratedThresholds.pass_score_threshold,
      critical_issue_block_threshold: calibratedThresholds.critical_issue_block_threshold,
    },
    finalReportText: finalReportLines.join('\n'),
  };
}
