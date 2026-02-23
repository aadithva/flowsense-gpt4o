/**
 * Shadow Rollout Configuration and Release Gates
 * V3 Accuracy Upgrade - Day 10: Shadow Rollout + Release Gate
 *
 * Manages shadow scoring, feature flags, and release gate criteria.
 */

import type { AnalysisEngineVersion } from './analysis-config';
import { BENCHMARK_CONFIG } from './benchmark';

// =============================================================================
// Shadow Rollout Configuration
// =============================================================================

export interface ShadowRolloutConfig {
  /** Whether shadow analysis is enabled */
  enabled: boolean;
  /** Environment: 'staging' | 'production' */
  environment: 'staging' | 'production';
  /** Sample rate for shadow analysis (0.0 - 1.0) */
  sampleRate: number;
  /** Active engine version (primary) */
  activeEngine: AnalysisEngineVersion;
  /** Shadow engine version (secondary, for comparison) */
  shadowEngine: AnalysisEngineVersion;
  /** Whether to promote shadow to active when gates pass */
  autoPromote: boolean;
  /** Minimum samples before considering promotion */
  minSamplesForPromotion: number;
  /** Feature flags */
  featureFlags: ShadowFeatureFlags;
}

export interface ShadowFeatureFlags {
  /** Enable shadow dual-write to versioned store */
  enableShadowDualWrite: boolean;
  /** Enable shadow diff computation in API responses */
  enableShadowDiffInApi: boolean;
  /** Enable shadow metrics in UI */
  enableShadowMetricsInUi: boolean;
  /** Enable shadow analysis telemetry */
  enableShadowTelemetry: boolean;
  /** Block promotion if any release gate fails */
  strictReleaseGates: boolean;
}

export const DEFAULT_SHADOW_CONFIG: ShadowRolloutConfig = {
  enabled: false,
  environment: 'staging',
  sampleRate: 0.0,
  activeEngine: 'v2_baseline',
  shadowEngine: 'v3_hybrid',
  autoPromote: false,
  minSamplesForPromotion: 100,
  featureFlags: {
    enableShadowDualWrite: false,
    enableShadowDiffInApi: false,
    enableShadowMetricsInUi: false,
    enableShadowTelemetry: true,
    strictReleaseGates: true,
  },
};

export const STAGING_SHADOW_CONFIG: ShadowRolloutConfig = {
  enabled: true,
  environment: 'staging',
  sampleRate: 1.0, // 100% in staging
  activeEngine: 'v2_baseline',
  shadowEngine: 'v3_hybrid',
  autoPromote: false,
  minSamplesForPromotion: 50,
  featureFlags: {
    enableShadowDualWrite: true,
    enableShadowDiffInApi: true,
    enableShadowMetricsInUi: true,
    enableShadowTelemetry: true,
    strictReleaseGates: true,
  },
};

export const PRODUCTION_SHADOW_CONFIG: ShadowRolloutConfig = {
  enabled: true,
  environment: 'production',
  sampleRate: 0.1, // 10% sample in production
  activeEngine: 'v2_baseline',
  shadowEngine: 'v3_hybrid',
  autoPromote: false,
  minSamplesForPromotion: 100,
  featureFlags: {
    enableShadowDualWrite: true,
    enableShadowDiffInApi: false, // Hidden in prod until promoted
    enableShadowMetricsInUi: false,
    enableShadowTelemetry: true,
    strictReleaseGates: true,
  },
};

// =============================================================================
// Release Gate Criteria
// =============================================================================

export interface ReleaseGateCriteria {
  /** Minimum mean quadratic weighted kappa */
  minMeanKappa: number;
  /** Minimum kappa uplift vs baseline */
  minKappaUplift: number;
  /** Minimum issue tag macro F1 */
  minIssueF1: number;
  /** Minimum block precision */
  minBlockPrecision: number;
  /** Maximum false block rate */
  maxFalseBlockRate: number;
  /** Maximum truncation rate */
  maxTruncationRate: number;
  /** Maximum failure rate */
  maxFailureRate: number;
  /** Maximum gate change frequency (shadow vs primary) */
  maxGateChangeFrequency: number;
}

export const DEFAULT_RELEASE_CRITERIA: ReleaseGateCriteria = {
  minMeanKappa: BENCHMARK_CONFIG.RELEASE_CRITERIA.MEAN_KAPPA_THRESHOLD,
  minKappaUplift: BENCHMARK_CONFIG.RELEASE_CRITERIA.KAPPA_UPLIFT_TARGET,
  minIssueF1: BENCHMARK_CONFIG.RELEASE_CRITERIA.ISSUE_TAG_MACRO_F1_THRESHOLD,
  minBlockPrecision: BENCHMARK_CONFIG.RELEASE_CRITERIA.BLOCK_PRECISION_THRESHOLD,
  maxFalseBlockRate: BENCHMARK_CONFIG.RELEASE_CRITERIA.FALSE_BLOCK_RATE_THRESHOLD,
  maxTruncationRate: 0.05, // 5% max truncation
  maxFailureRate: 0.02, // 2% max failure
  maxGateChangeFrequency: 0.15, // 15% max gate changes
};

// =============================================================================
// Shadow Monitoring Metrics
// =============================================================================

export interface ShadowMonitoringMetrics {
  /** Total runs processed with shadow */
  totalRuns: number;
  /** Runs completed successfully */
  completedRuns: number;
  /** Runs that failed */
  failedRuns: number;
  /** Completion rate */
  completionRate: number;
  /** Failure rate */
  failureRate: number;
  /** Truncation metrics */
  truncation: {
    truncatedRuns: number;
    truncationRate: number;
    avgFramesSkipped: number;
  };
  /** Gate change metrics (shadow vs primary) */
  gateChanges: {
    totalComparisons: number;
    gateChangedCount: number;
    gateChangeFrequency: number;
    passToWarn: number;
    passToBlock: number;
    warnToPass: number;
    warnToBlock: number;
    blockToPass: number;
    blockToWarn: number;
  };
  /** Score delta metrics */
  scoreDeltas: {
    meanWeightedScoreDelta: number;
    medianWeightedScoreDelta: number;
    stdDevWeightedScoreDelta: number;
    meanCriticalIssueDelta: number;
  };
  /** Token usage metrics */
  tokenUsage: {
    meanTokensPerRun: number;
    medianTokensPerRun: number;
    p95TokensPerRun: number;
  };
  /** Time window for these metrics */
  timeWindow: {
    startTime: string;
    endTime: string;
    durationHours: number;
  };
}

export interface ShadowRunRecord {
  runId: string;
  timestamp: string;
  primaryEngine: AnalysisEngineVersion;
  shadowEngine: AnalysisEngineVersion;
  primarySuccess: boolean;
  shadowSuccess: boolean;
  primaryTruncated: boolean;
  shadowTruncated: boolean;
  primaryFramesSkipped: number;
  shadowFramesSkipped: number;
  primaryWeightedScore: number | null;
  shadowWeightedScore: number | null;
  primaryCriticalIssues: number | null;
  shadowCriticalIssues: number | null;
  primaryQualityGate: 'pass' | 'warn' | 'block' | null;
  shadowQualityGate: 'pass' | 'warn' | 'block' | null;
  gateChanged: boolean;
  weightedScoreDelta: number | null;
  criticalIssueDelta: number | null;
  primaryTokens: number;
  shadowTokens: number;
}

// =============================================================================
// Release Gate Checker
// =============================================================================

export interface ReleaseGateResult {
  /** Whether all gates pass */
  allGatesPass: boolean;
  /** Individual gate results */
  gates: {
    name: string;
    criterion: string;
    threshold: number;
    actual: number;
    passed: boolean;
  }[];
  /** Overall recommendation */
  recommendation: 'promote' | 'hold' | 'rollback';
  /** Detailed reasoning */
  reasoning: string;
  /** Timestamp of evaluation */
  evaluatedAt: string;
}

/**
 * Check all release gates against monitoring metrics
 */
export function checkReleaseGates(
  metrics: ShadowMonitoringMetrics,
  benchmarkMetrics: {
    meanKappa: number;
    kappaUplift: number;
    issueF1: number;
    blockPrecision: number;
    falseBlockRate: number;
  },
  criteria: ReleaseGateCriteria = DEFAULT_RELEASE_CRITERIA
): ReleaseGateResult {
  const gates: ReleaseGateResult['gates'] = [];

  // Gate 1: Mean Kappa
  gates.push({
    name: 'Mean Kappa',
    criterion: `≥ ${criteria.minMeanKappa}`,
    threshold: criteria.minMeanKappa,
    actual: benchmarkMetrics.meanKappa,
    passed: benchmarkMetrics.meanKappa >= criteria.minMeanKappa,
  });

  // Gate 2: Kappa Uplift
  gates.push({
    name: 'Kappa Uplift',
    criterion: `≥ ${criteria.minKappaUplift}`,
    threshold: criteria.minKappaUplift,
    actual: benchmarkMetrics.kappaUplift,
    passed: benchmarkMetrics.kappaUplift >= criteria.minKappaUplift,
  });

  // Gate 3: Issue F1
  gates.push({
    name: 'Issue Tag F1',
    criterion: `≥ ${criteria.minIssueF1}`,
    threshold: criteria.minIssueF1,
    actual: benchmarkMetrics.issueF1,
    passed: benchmarkMetrics.issueF1 >= criteria.minIssueF1,
  });

  // Gate 4: Block Precision
  gates.push({
    name: 'Block Precision',
    criterion: `≥ ${criteria.minBlockPrecision}`,
    threshold: criteria.minBlockPrecision,
    actual: benchmarkMetrics.blockPrecision,
    passed: benchmarkMetrics.blockPrecision >= criteria.minBlockPrecision,
  });

  // Gate 5: False Block Rate
  gates.push({
    name: 'False Block Rate',
    criterion: `≤ ${criteria.maxFalseBlockRate}`,
    threshold: criteria.maxFalseBlockRate,
    actual: benchmarkMetrics.falseBlockRate,
    passed: benchmarkMetrics.falseBlockRate <= criteria.maxFalseBlockRate,
  });

  // Gate 6: Truncation Rate
  gates.push({
    name: 'Truncation Rate',
    criterion: `≤ ${criteria.maxTruncationRate}`,
    threshold: criteria.maxTruncationRate,
    actual: metrics.truncation.truncationRate,
    passed: metrics.truncation.truncationRate <= criteria.maxTruncationRate,
  });

  // Gate 7: Failure Rate
  gates.push({
    name: 'Failure Rate',
    criterion: `≤ ${criteria.maxFailureRate}`,
    threshold: criteria.maxFailureRate,
    actual: metrics.failureRate,
    passed: metrics.failureRate <= criteria.maxFailureRate,
  });

  // Gate 8: Gate Change Frequency
  gates.push({
    name: 'Gate Change Frequency',
    criterion: `≤ ${criteria.maxGateChangeFrequency}`,
    threshold: criteria.maxGateChangeFrequency,
    actual: metrics.gateChanges.gateChangeFrequency,
    passed: metrics.gateChanges.gateChangeFrequency <= criteria.maxGateChangeFrequency,
  });

  const allGatesPass = gates.every(g => g.passed);
  const failedGates = gates.filter(g => !g.passed);

  let recommendation: ReleaseGateResult['recommendation'];
  let reasoning: string;

  if (allGatesPass) {
    recommendation = 'promote';
    reasoning = 'All release gates pass. V3 can be promoted to active.';
  } else if (failedGates.length <= 2 && !failedGates.some(g => g.name === 'Failure Rate')) {
    recommendation = 'hold';
    reasoning = `${failedGates.length} gate(s) failed: ${failedGates.map(g => g.name).join(', ')}. Continue shadow monitoring and tune thresholds.`;
  } else {
    recommendation = 'rollback';
    reasoning = `Critical gates failed: ${failedGates.map(g => g.name).join(', ')}. Keep V2 active and investigate V3 issues.`;
  }

  return {
    allGatesPass,
    gates,
    recommendation,
    reasoning,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Compute monitoring metrics from shadow run records
 */
export function computeMonitoringMetrics(
  records: ShadowRunRecord[],
  startTime: Date,
  endTime: Date
): ShadowMonitoringMetrics {
  const totalRuns = records.length;

  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      completionRate: 0,
      failureRate: 0,
      truncation: {
        truncatedRuns: 0,
        truncationRate: 0,
        avgFramesSkipped: 0,
      },
      gateChanges: {
        totalComparisons: 0,
        gateChangedCount: 0,
        gateChangeFrequency: 0,
        passToWarn: 0,
        passToBlock: 0,
        warnToPass: 0,
        warnToBlock: 0,
        blockToPass: 0,
        blockToWarn: 0,
      },
      scoreDeltas: {
        meanWeightedScoreDelta: 0,
        medianWeightedScoreDelta: 0,
        stdDevWeightedScoreDelta: 0,
        meanCriticalIssueDelta: 0,
      },
      tokenUsage: {
        meanTokensPerRun: 0,
        medianTokensPerRun: 0,
        p95TokensPerRun: 0,
      },
      timeWindow: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationHours: (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60),
      },
    };
  }

  // Completion/Failure metrics
  const completedRuns = records.filter(r => r.primarySuccess && r.shadowSuccess).length;
  const failedRuns = records.filter(r => !r.primarySuccess || !r.shadowSuccess).length;
  const completionRate = completedRuns / totalRuns;
  const failureRate = failedRuns / totalRuns;

  // Truncation metrics
  const truncatedRuns = records.filter(r => r.shadowTruncated).length;
  const truncationRate = truncatedRuns / totalRuns;
  const framesSkipped = records.filter(r => r.shadowTruncated).map(r => r.shadowFramesSkipped);
  const avgFramesSkipped = framesSkipped.length > 0
    ? framesSkipped.reduce((a, b) => a + b, 0) / framesSkipped.length
    : 0;

  // Gate change metrics
  const comparableRecords = records.filter(
    r => r.primaryQualityGate !== null && r.shadowQualityGate !== null
  );
  const totalComparisons = comparableRecords.length;
  const gateChangedCount = comparableRecords.filter(r => r.gateChanged).length;
  const gateChangeFrequency = totalComparisons > 0 ? gateChangedCount / totalComparisons : 0;

  // Count specific gate transitions
  let passToWarn = 0, passToBlock = 0, warnToPass = 0, warnToBlock = 0, blockToPass = 0, blockToWarn = 0;
  for (const r of comparableRecords) {
    if (r.primaryQualityGate === 'pass' && r.shadowQualityGate === 'warn') passToWarn++;
    if (r.primaryQualityGate === 'pass' && r.shadowQualityGate === 'block') passToBlock++;
    if (r.primaryQualityGate === 'warn' && r.shadowQualityGate === 'pass') warnToPass++;
    if (r.primaryQualityGate === 'warn' && r.shadowQualityGate === 'block') warnToBlock++;
    if (r.primaryQualityGate === 'block' && r.shadowQualityGate === 'pass') blockToPass++;
    if (r.primaryQualityGate === 'block' && r.shadowQualityGate === 'warn') blockToWarn++;
  }

  // Score delta metrics
  const weightedDeltas = records
    .filter(r => r.weightedScoreDelta !== null)
    .map(r => r.weightedScoreDelta as number);

  const sortedDeltas = [...weightedDeltas].sort((a, b) => a - b);
  const meanWeightedScoreDelta = weightedDeltas.length > 0
    ? weightedDeltas.reduce((a, b) => a + b, 0) / weightedDeltas.length
    : 0;
  const medianWeightedScoreDelta = sortedDeltas.length > 0
    ? sortedDeltas[Math.floor(sortedDeltas.length / 2)]
    : 0;
  const variance = weightedDeltas.length > 0
    ? weightedDeltas.reduce((sum, d) => sum + Math.pow(d - meanWeightedScoreDelta, 2), 0) / weightedDeltas.length
    : 0;
  const stdDevWeightedScoreDelta = Math.sqrt(variance);

  const criticalDeltas = records
    .filter(r => r.criticalIssueDelta !== null)
    .map(r => r.criticalIssueDelta as number);
  const meanCriticalIssueDelta = criticalDeltas.length > 0
    ? criticalDeltas.reduce((a, b) => a + b, 0) / criticalDeltas.length
    : 0;

  // Token usage metrics
  const shadowTokens = records.map(r => r.shadowTokens).filter(t => t > 0);
  const sortedTokens = [...shadowTokens].sort((a, b) => a - b);
  const meanTokensPerRun = shadowTokens.length > 0
    ? shadowTokens.reduce((a, b) => a + b, 0) / shadowTokens.length
    : 0;
  const medianTokensPerRun = sortedTokens.length > 0
    ? sortedTokens[Math.floor(sortedTokens.length / 2)]
    : 0;
  const p95Index = Math.floor(sortedTokens.length * 0.95);
  const p95TokensPerRun = sortedTokens.length > 0
    ? sortedTokens[Math.min(p95Index, sortedTokens.length - 1)]
    : 0;

  return {
    totalRuns,
    completedRuns,
    failedRuns,
    completionRate,
    failureRate,
    truncation: {
      truncatedRuns,
      truncationRate,
      avgFramesSkipped,
    },
    gateChanges: {
      totalComparisons,
      gateChangedCount,
      gateChangeFrequency,
      passToWarn,
      passToBlock,
      warnToPass,
      warnToBlock,
      blockToPass,
      blockToWarn,
    },
    scoreDeltas: {
      meanWeightedScoreDelta,
      medianWeightedScoreDelta,
      stdDevWeightedScoreDelta,
      meanCriticalIssueDelta,
    },
    tokenUsage: {
      meanTokensPerRun,
      medianTokensPerRun,
      p95TokensPerRun,
    },
    timeWindow: {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationHours: (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60),
    },
  };
}

/**
 * Determine if a run should be shadow-analyzed based on config and sampling
 */
export function shouldRunShadowAnalysis(
  config: ShadowRolloutConfig,
  runId: string
): boolean {
  if (!config.enabled) {
    return false;
  }

  if (!config.featureFlags.enableShadowDualWrite) {
    return false;
  }

  if (config.sampleRate >= 1.0) {
    return true;
  }

  if (config.sampleRate <= 0.0) {
    return false;
  }

  // Deterministic sampling based on runId hash
  const hash = hashString(runId);
  const threshold = Math.floor(config.sampleRate * 0xFFFFFFFF);
  return hash < threshold;
}

/**
 * Simple string hash for deterministic sampling
 */
/**
 * FNV-1a hash function for better uniform distribution
 * Used for deterministic sampling
 */
function hashString(str: string): number {
  // FNV-1a parameters for 32-bit hash
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit integer
  return hash >>> 0;
}

/**
 * Format release gate result as text report
 */
export function formatReleaseGateReport(result: ReleaseGateResult): string {
  const lines: string[] = [];

  lines.push('═'.repeat(60));
  lines.push('RELEASE GATE EVALUATION');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`Evaluated: ${result.evaluatedAt}`);
  lines.push(`Recommendation: ${result.recommendation.toUpperCase()}`);
  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('GATE RESULTS');
  lines.push('─'.repeat(60));
  lines.push('');
  lines.push('Gate                     │ Criterion    │ Actual    │ Status');
  lines.push('─────────────────────────┼──────────────┼───────────┼────────');

  for (const gate of result.gates) {
    const status = gate.passed ? '✓ PASS' : '✗ FAIL';
    lines.push(
      `${gate.name.padEnd(25)}│ ${gate.criterion.padEnd(12)} │ ${gate.actual.toFixed(4).padStart(9)} │ ${status}`
    );
  }

  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('REASONING');
  lines.push('─'.repeat(60));
  lines.push('');
  lines.push(result.reasoning);
  lines.push('');
  lines.push('═'.repeat(60));

  return lines.join('\n');
}
