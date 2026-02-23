/**
 * Shadow Rollout Tests
 * V3 Accuracy Upgrade - Day 10: Shadow Rollout + Release Gate
 *
 * Test coverage:
 * - Shadow configuration and feature flags
 * - Release gate checking
 * - Monitoring metrics computation
 * - Shadow sampling determinism
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHADOW_CONFIG,
  STAGING_SHADOW_CONFIG,
  PRODUCTION_SHADOW_CONFIG,
  DEFAULT_RELEASE_CRITERIA,
  shouldRunShadowAnalysis,
  checkReleaseGates,
  computeMonitoringMetrics,
  formatReleaseGateReport,
  type ShadowRolloutConfig,
  type ShadowRunRecord,
  type ShadowMonitoringMetrics,
} from './shadow-rollout';

describe('shadow-rollout', () => {
  describe('Configuration', () => {
    it('should have correct default configuration', () => {
      expect(DEFAULT_SHADOW_CONFIG.enabled).toBe(false);
      expect(DEFAULT_SHADOW_CONFIG.sampleRate).toBe(0.0);
      expect(DEFAULT_SHADOW_CONFIG.activeEngine).toBe('v2_baseline');
      expect(DEFAULT_SHADOW_CONFIG.shadowEngine).toBe('v3_hybrid');
    });

    it('should have correct staging configuration', () => {
      expect(STAGING_SHADOW_CONFIG.enabled).toBe(true);
      expect(STAGING_SHADOW_CONFIG.sampleRate).toBe(1.0);
      expect(STAGING_SHADOW_CONFIG.environment).toBe('staging');
      expect(STAGING_SHADOW_CONFIG.featureFlags.enableShadowDualWrite).toBe(true);
      expect(STAGING_SHADOW_CONFIG.featureFlags.enableShadowDiffInApi).toBe(true);
    });

    it('should have correct production configuration', () => {
      expect(PRODUCTION_SHADOW_CONFIG.enabled).toBe(true);
      expect(PRODUCTION_SHADOW_CONFIG.sampleRate).toBe(0.1);
      expect(PRODUCTION_SHADOW_CONFIG.environment).toBe('production');
      expect(PRODUCTION_SHADOW_CONFIG.featureFlags.enableShadowDiffInApi).toBe(false);
    });
  });

  describe('shouldRunShadowAnalysis', () => {
    it('should return false when disabled', () => {
      const config: ShadowRolloutConfig = {
        ...DEFAULT_SHADOW_CONFIG,
        enabled: false,
      };
      expect(shouldRunShadowAnalysis(config, 'run-123')).toBe(false);
    });

    it('should return false when dual-write feature flag is disabled', () => {
      const config: ShadowRolloutConfig = {
        ...STAGING_SHADOW_CONFIG,
        featureFlags: {
          ...STAGING_SHADOW_CONFIG.featureFlags,
          enableShadowDualWrite: false,
        },
      };
      expect(shouldRunShadowAnalysis(config, 'run-123')).toBe(false);
    });

    it('should return true when sample rate is 100%', () => {
      const config: ShadowRolloutConfig = {
        ...STAGING_SHADOW_CONFIG,
        sampleRate: 1.0,
      };
      expect(shouldRunShadowAnalysis(config, 'run-123')).toBe(true);
      expect(shouldRunShadowAnalysis(config, 'run-456')).toBe(true);
    });

    it('should return false when sample rate is 0%', () => {
      const config: ShadowRolloutConfig = {
        ...STAGING_SHADOW_CONFIG,
        sampleRate: 0.0,
      };
      expect(shouldRunShadowAnalysis(config, 'run-123')).toBe(false);
    });

    it('should be deterministic for same runId', () => {
      const config: ShadowRolloutConfig = {
        ...STAGING_SHADOW_CONFIG,
        sampleRate: 0.5,
      };
      const result1 = shouldRunShadowAnalysis(config, 'run-abc-123');
      const result2 = shouldRunShadowAnalysis(config, 'run-abc-123');
      expect(result1).toBe(result2);
    });

    it('should produce approximately correct sample rate', () => {
      const config: ShadowRolloutConfig = {
        ...STAGING_SHADOW_CONFIG,
        sampleRate: 0.3,
      };

      let sampled = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        if (shouldRunShadowAnalysis(config, `run-${i}`)) {
          sampled++;
        }
      }

      // Allow 10% tolerance
      const actualRate = sampled / total;
      expect(actualRate).toBeGreaterThan(0.2);
      expect(actualRate).toBeLessThan(0.4);
    });
  });

  describe('checkReleaseGates', () => {
    const goodMetrics: ShadowMonitoringMetrics = {
      totalRuns: 150,
      completedRuns: 147,
      failedRuns: 3,
      completionRate: 0.98,
      failureRate: 0.02,
      truncation: {
        truncatedRuns: 5,
        truncationRate: 0.033,
        avgFramesSkipped: 2.5,
      },
      gateChanges: {
        totalComparisons: 147,
        gateChangedCount: 15,
        gateChangeFrequency: 0.102,
        passToWarn: 5,
        passToBlock: 2,
        warnToPass: 4,
        warnToBlock: 1,
        blockToPass: 1,
        blockToWarn: 2,
      },
      scoreDeltas: {
        meanWeightedScoreDelta: 2.5,
        medianWeightedScoreDelta: 2.0,
        stdDevWeightedScoreDelta: 3.5,
        meanCriticalIssueDelta: -0.3,
      },
      tokenUsage: {
        meanTokensPerRun: 5000,
        medianTokensPerRun: 4500,
        p95TokensPerRun: 8000,
      },
      timeWindow: {
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-02T00:00:00Z',
        durationHours: 24,
      },
    };

    const goodBenchmarkMetrics = {
      meanKappa: 0.72,
      kappaUplift: 0.12,
      issueF1: 0.65,
      blockPrecision: 0.82,
      falseBlockRate: 0.05,
    };

    it('should pass all gates with good metrics', () => {
      const result = checkReleaseGates(goodMetrics, goodBenchmarkMetrics);

      expect(result.allGatesPass).toBe(true);
      expect(result.recommendation).toBe('promote');
      expect(result.gates.length).toBe(8);
      expect(result.gates.every(g => g.passed)).toBe(true);
    });

    it('should fail when mean kappa is below threshold', () => {
      const badBenchmark = { ...goodBenchmarkMetrics, meanKappa: 0.55 };
      const result = checkReleaseGates(goodMetrics, badBenchmark);

      expect(result.allGatesPass).toBe(false);
      const kappaGate = result.gates.find(g => g.name === 'Mean Kappa');
      expect(kappaGate?.passed).toBe(false);
    });

    it('should fail when kappa uplift is below threshold', () => {
      const badBenchmark = { ...goodBenchmarkMetrics, kappaUplift: 0.05 };
      const result = checkReleaseGates(goodMetrics, badBenchmark);

      expect(result.allGatesPass).toBe(false);
      const upliftGate = result.gates.find(g => g.name === 'Kappa Uplift');
      expect(upliftGate?.passed).toBe(false);
    });

    it('should fail when false block rate exceeds threshold', () => {
      const badBenchmark = { ...goodBenchmarkMetrics, falseBlockRate: 0.15 };
      const result = checkReleaseGates(goodMetrics, badBenchmark);

      expect(result.allGatesPass).toBe(false);
      const falseBlockGate = result.gates.find(g => g.name === 'False Block Rate');
      expect(falseBlockGate?.passed).toBe(false);
    });

    it('should fail when truncation rate exceeds threshold', () => {
      const badMetrics: ShadowMonitoringMetrics = {
        ...goodMetrics,
        truncation: {
          ...goodMetrics.truncation,
          truncationRate: 0.10, // 10% > 5% threshold
        },
      };
      const result = checkReleaseGates(badMetrics, goodBenchmarkMetrics);

      expect(result.allGatesPass).toBe(false);
      const truncGate = result.gates.find(g => g.name === 'Truncation Rate');
      expect(truncGate?.passed).toBe(false);
    });

    it('should fail when failure rate exceeds threshold', () => {
      const badMetrics: ShadowMonitoringMetrics = {
        ...goodMetrics,
        failureRate: 0.05, // 5% > 2% threshold
      };
      const result = checkReleaseGates(badMetrics, goodBenchmarkMetrics);

      expect(result.allGatesPass).toBe(false);
      const failureGate = result.gates.find(g => g.name === 'Failure Rate');
      expect(failureGate?.passed).toBe(false);
    });

    it('should fail when gate change frequency exceeds threshold', () => {
      const badMetrics: ShadowMonitoringMetrics = {
        ...goodMetrics,
        gateChanges: {
          ...goodMetrics.gateChanges,
          gateChangeFrequency: 0.25, // 25% > 15% threshold
        },
      };
      const result = checkReleaseGates(badMetrics, goodBenchmarkMetrics);

      expect(result.allGatesPass).toBe(false);
      const gateChangeGate = result.gates.find(g => g.name === 'Gate Change Frequency');
      expect(gateChangeGate?.passed).toBe(false);
    });

    it('should recommend hold for minor failures', () => {
      const badBenchmark = { ...goodBenchmarkMetrics, issueF1: 0.50 };
      const result = checkReleaseGates(goodMetrics, badBenchmark);

      expect(result.allGatesPass).toBe(false);
      expect(result.recommendation).toBe('hold');
    });

    it('should recommend rollback for critical failures', () => {
      const badMetrics: ShadowMonitoringMetrics = {
        ...goodMetrics,
        failureRate: 0.10, // Critical failure
        truncation: { ...goodMetrics.truncation, truncationRate: 0.15 },
        gateChanges: { ...goodMetrics.gateChanges, gateChangeFrequency: 0.30 },
      };
      const result = checkReleaseGates(badMetrics, goodBenchmarkMetrics);

      expect(result.allGatesPass).toBe(false);
      expect(result.recommendation).toBe('rollback');
    });
  });

  describe('computeMonitoringMetrics', () => {
    const createMockRecords = (count: number): ShadowRunRecord[] => {
      const records: ShadowRunRecord[] = [];
      const baseTime = new Date('2024-01-01T00:00:00Z');

      for (let i = 0; i < count; i++) {
        const primaryGate = i % 10 === 0 ? 'block' : i % 3 === 0 ? 'warn' : 'pass';
        const shadowGate = i % 8 === 0 ? 'block' : i % 4 === 0 ? 'warn' : 'pass';

        records.push({
          runId: `run-${i}`,
          timestamp: new Date(baseTime.getTime() + i * 60000).toISOString(),
          primaryEngine: 'v2_baseline',
          shadowEngine: 'v3_hybrid',
          primarySuccess: i % 20 !== 0,
          shadowSuccess: i % 25 !== 0,
          primaryTruncated: false,
          shadowTruncated: i % 15 === 0,
          primaryFramesSkipped: 0,
          shadowFramesSkipped: i % 15 === 0 ? 3 : 0,
          primaryWeightedScore: 75 + (i % 20),
          shadowWeightedScore: 77 + (i % 18),
          primaryCriticalIssues: i % 10 === 0 ? 2 : 0,
          shadowCriticalIssues: i % 12 === 0 ? 1 : 0,
          primaryQualityGate: primaryGate,
          shadowQualityGate: shadowGate,
          gateChanged: primaryGate !== shadowGate,
          weightedScoreDelta: 2 + (i % 5) - 2,
          criticalIssueDelta: i % 10 === 0 ? -1 : i % 12 === 0 ? 1 : 0,
          primaryTokens: 4000 + (i % 1000),
          shadowTokens: 5000 + (i % 1500),
        });
      }
      return records;
    };

    it('should compute correct metrics for empty records', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const metrics = computeMonitoringMetrics([], startTime, endTime);

      expect(metrics.totalRuns).toBe(0);
      expect(metrics.completionRate).toBe(0);
      expect(metrics.failureRate).toBe(0);
    });

    it('should compute correct completion metrics', () => {
      const records = createMockRecords(100);
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const metrics = computeMonitoringMetrics(records, startTime, endTime);

      expect(metrics.totalRuns).toBe(100);
      expect(metrics.completedRuns).toBeGreaterThan(0);
      expect(metrics.failedRuns).toBeGreaterThan(0);
      expect(metrics.completionRate + metrics.failureRate).toBeCloseTo(1, 2);
    });

    it('should compute correct truncation metrics', () => {
      const records = createMockRecords(100);
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const metrics = computeMonitoringMetrics(records, startTime, endTime);

      expect(metrics.truncation.truncatedRuns).toBeGreaterThan(0);
      expect(metrics.truncation.truncationRate).toBeGreaterThan(0);
      expect(metrics.truncation.truncationRate).toBeLessThan(1);
    });

    it('should compute correct gate change metrics', () => {
      const records = createMockRecords(100);
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const metrics = computeMonitoringMetrics(records, startTime, endTime);

      expect(metrics.gateChanges.totalComparisons).toBeGreaterThan(0);
      expect(metrics.gateChanges.gateChangedCount).toBeGreaterThan(0);
      expect(metrics.gateChanges.gateChangeFrequency).toBeGreaterThan(0);
      expect(metrics.gateChanges.gateChangeFrequency).toBeLessThan(1);
    });

    it('should compute correct score delta metrics', () => {
      const records = createMockRecords(100);
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const metrics = computeMonitoringMetrics(records, startTime, endTime);

      expect(typeof metrics.scoreDeltas.meanWeightedScoreDelta).toBe('number');
      expect(typeof metrics.scoreDeltas.medianWeightedScoreDelta).toBe('number');
      expect(typeof metrics.scoreDeltas.stdDevWeightedScoreDelta).toBe('number');
    });

    it('should compute correct token usage metrics', () => {
      const records = createMockRecords(100);
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const metrics = computeMonitoringMetrics(records, startTime, endTime);

      expect(metrics.tokenUsage.meanTokensPerRun).toBeGreaterThan(0);
      expect(metrics.tokenUsage.medianTokensPerRun).toBeGreaterThan(0);
      expect(metrics.tokenUsage.p95TokensPerRun).toBeGreaterThanOrEqual(metrics.tokenUsage.medianTokensPerRun);
    });

    it('should include correct time window', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z');
      const records = createMockRecords(50);
      const metrics = computeMonitoringMetrics(records, startTime, endTime);

      expect(metrics.timeWindow.startTime).toBe(startTime.toISOString());
      expect(metrics.timeWindow.endTime).toBe(endTime.toISOString());
      expect(metrics.timeWindow.durationHours).toBe(24);
    });
  });

  describe('formatReleaseGateReport', () => {
    it('should format passing report correctly', () => {
      const result = {
        allGatesPass: true,
        gates: [
          { name: 'Mean Kappa', criterion: '≥ 0.62', threshold: 0.62, actual: 0.72, passed: true },
        ],
        recommendation: 'promote' as const,
        reasoning: 'All release gates pass. V3 can be promoted to active.',
        evaluatedAt: '2024-01-01T00:00:00Z',
      };

      const report = formatReleaseGateReport(result);

      expect(report).toContain('RELEASE GATE EVALUATION');
      expect(report).toContain('PROMOTE');
      expect(report).toContain('Mean Kappa');
      expect(report).toContain('✓ PASS');
    });

    it('should format failing report correctly', () => {
      const result = {
        allGatesPass: false,
        gates: [
          { name: 'False Block Rate', criterion: '≤ 0.08', threshold: 0.08, actual: 0.15, passed: false },
        ],
        recommendation: 'hold' as const,
        reasoning: 'Some gates failed.',
        evaluatedAt: '2024-01-01T00:00:00Z',
      };

      const report = formatReleaseGateReport(result);

      expect(report).toContain('HOLD');
      expect(report).toContain('✗ FAIL');
    });
  });

  describe('Release Criteria Constants', () => {
    it('should have correct default release criteria', () => {
      expect(DEFAULT_RELEASE_CRITERIA.minMeanKappa).toBe(0.62);
      expect(DEFAULT_RELEASE_CRITERIA.minKappaUplift).toBe(0.10);
      expect(DEFAULT_RELEASE_CRITERIA.minIssueF1).toBe(0.58);
      expect(DEFAULT_RELEASE_CRITERIA.minBlockPrecision).toBe(0.75);
      expect(DEFAULT_RELEASE_CRITERIA.maxFalseBlockRate).toBe(0.08);
      expect(DEFAULT_RELEASE_CRITERIA.maxTruncationRate).toBe(0.05);
      expect(DEFAULT_RELEASE_CRITERIA.maxFailureRate).toBe(0.02);
      expect(DEFAULT_RELEASE_CRITERIA.maxGateChangeFrequency).toBe(0.15);
    });
  });
});
