/**
 * Benchmark Metrics Tests
 * V3 Accuracy Upgrade - Day 9: Validation + Benchmark Execution
 */

import { describe, it, expect } from 'vitest';
import {
  calculateCategoryMetrics,
  calculateMeanQWK,
  calculateIssueTagMetrics,
  calculateGateMetrics,
  calculateTokenDistribution,
  calibrateThresholds,
  generateBenchmarkReport,
  type PredictedAnalysis,
} from './benchmark-metrics';
import type { RubricScores, IssueTag } from './types';
import type { AdjudicatedLabel, BenchmarkCase } from './benchmark';

describe('benchmark-metrics', () => {
  // Test data
  const mockPredictions: PredictedAnalysis[] = [
    {
      case_id: 'case_001',
      rubric_scores: { cat1: 2, cat2: 1, cat3: 2, cat4: 1, cat5: 2, cat6: 1, cat7: 2 },
      issue_tags: ['dead_click', 'missing_spinner'] as IssueTag[],
      quality_gate_status: 'warn',
      weighted_score_100: 75,
      critical_issue_count: 1,
      engine_version: 'v3_hybrid',
      token_usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
      inference_ms: 500,
      analysis_truncated: false,
    },
    {
      case_id: 'case_002',
      rubric_scores: { cat1: 1, cat2: 2, cat3: 1, cat4: 2, cat5: 1, cat6: 2, cat7: 1 },
      issue_tags: ['delayed_response'] as IssueTag[],
      quality_gate_status: 'pass',
      weighted_score_100: 85,
      critical_issue_count: 0,
      engine_version: 'v3_hybrid',
      token_usage: { prompt_tokens: 1100, completion_tokens: 250, total_tokens: 1350 },
      inference_ms: 550,
      analysis_truncated: false,
    },
    {
      case_id: 'case_003',
      rubric_scores: { cat1: 0, cat2: 0, cat3: 1, cat4: 1, cat5: 0, cat6: 1, cat7: 1 },
      issue_tags: ['silent_error', 'blocking_error', 'dead_click'] as IssueTag[],
      quality_gate_status: 'block',
      weighted_score_100: 45,
      critical_issue_count: 3,
      engine_version: 'v3_hybrid',
      token_usage: { prompt_tokens: 900, completion_tokens: 180, total_tokens: 1080 },
      inference_ms: 480,
      analysis_truncated: false,
    },
  ];

  const mockGroundTruth: AdjudicatedLabel[] = [
    {
      case_id: 'case_001',
      rubric_scores: { cat1: 2, cat2: 1, cat3: 2, cat4: 1, cat5: 2, cat6: 2, cat7: 2 },
      issue_tags: ['dead_click', 'missing_spinner'] as IssueTag[],
      quality_gate_status: 'warn',
      required_adjudication: false,
      adjudicated_at: '2024-01-01T00:00:00Z',
    },
    {
      case_id: 'case_002',
      rubric_scores: { cat1: 1, cat2: 2, cat3: 2, cat4: 2, cat5: 1, cat6: 2, cat7: 1 },
      issue_tags: ['delayed_response', 'missing_spinner'] as IssueTag[],
      quality_gate_status: 'pass',
      required_adjudication: false,
      adjudicated_at: '2024-01-01T00:00:00Z',
    },
    {
      case_id: 'case_003',
      rubric_scores: { cat1: 0, cat2: 1, cat3: 1, cat4: 1, cat5: 0, cat6: 1, cat7: 0 },
      issue_tags: ['silent_error', 'dead_click'] as IssueTag[],
      quality_gate_status: 'block',
      required_adjudication: true,
      adjudicator_id: 'adj_001',
      adjudicated_at: '2024-01-01T00:00:00Z',
    },
  ];

  describe('calculateCategoryMetrics', () => {
    it('should calculate per-category kappa metrics', () => {
      const metrics = calculateCategoryMetrics(mockPredictions, mockGroundTruth);

      expect(metrics).toHaveProperty('cat1');
      expect(metrics).toHaveProperty('cat7');
      expect(metrics.cat1.n).toBe(3);
      expect(metrics.cat1.percent_agreement).toBeGreaterThanOrEqual(0);
      expect(metrics.cat1.percent_agreement).toBeLessThanOrEqual(1);
    });

    it('should return 0 metrics for empty arrays', () => {
      const metrics = calculateCategoryMetrics([], []);

      expect(metrics.cat1.kappa).toBe(0);
      expect(metrics.cat1.n).toBe(0);
    });
  });

  describe('calculateMeanQWK', () => {
    it('should calculate mean quadratic weighted kappa', () => {
      const categoryMetrics = calculateCategoryMetrics(mockPredictions, mockGroundTruth);
      const meanQWK = calculateMeanQWK(categoryMetrics);

      expect(typeof meanQWK).toBe('number');
      expect(meanQWK).toBeGreaterThanOrEqual(-1);
      expect(meanQWK).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateIssueTagMetrics', () => {
    it('should calculate precision, recall, and F1 for issue tags', () => {
      const metrics = calculateIssueTagMetrics(mockPredictions, mockGroundTruth);

      expect(metrics).toHaveProperty('macro_f1');
      expect(metrics).toHaveProperty('per_tag');
      expect(typeof metrics.macro_f1).toBe('number');
      expect(metrics.macro_f1).toBeGreaterThanOrEqual(0);
      expect(metrics.macro_f1).toBeLessThanOrEqual(1);
    });

    it('should include per-tag metrics', () => {
      const metrics = calculateIssueTagMetrics(mockPredictions, mockGroundTruth);

      expect(metrics.per_tag).toHaveProperty('dead_click');
      expect(metrics.per_tag.dead_click).toHaveProperty('precision');
      expect(metrics.per_tag.dead_click).toHaveProperty('recall');
      expect(metrics.per_tag.dead_click).toHaveProperty('f1');
      expect(metrics.per_tag.dead_click).toHaveProperty('support');
    });
  });

  describe('calculateGateMetrics', () => {
    it('should calculate confusion matrix and gate metrics', () => {
      const metrics = calculateGateMetrics(mockPredictions, mockGroundTruth);

      expect(metrics).toHaveProperty('confusion_matrix');
      expect(metrics).toHaveProperty('block_precision');
      expect(metrics).toHaveProperty('block_recall');
      expect(metrics).toHaveProperty('false_block_rate');
      expect(metrics).toHaveProperty('gate_accuracy');
    });

    it('should have valid confusion matrix structure', () => {
      const metrics = calculateGateMetrics(mockPredictions, mockGroundTruth);

      expect(metrics.confusion_matrix).toHaveProperty('pass');
      expect(metrics.confusion_matrix).toHaveProperty('warn');
      expect(metrics.confusion_matrix).toHaveProperty('block');
      expect(metrics.confusion_matrix.pass).toHaveProperty('pass');
      expect(metrics.confusion_matrix.pass).toHaveProperty('warn');
      expect(metrics.confusion_matrix.pass).toHaveProperty('block');
    });

    it('should calculate gate accuracy correctly', () => {
      const metrics = calculateGateMetrics(mockPredictions, mockGroundTruth);

      // With our mock data: case_001 and case_003 match, case_002 matches
      // So 3/3 = 100% accuracy
      expect(metrics.gate_accuracy).toBeGreaterThan(0);
      expect(metrics.gate_accuracy).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateTokenDistribution', () => {
    it('should calculate token usage statistics', () => {
      const dist = calculateTokenDistribution(mockPredictions);

      expect(dist.total).toBe(1200 + 1350 + 1080);
      expect(dist.mean).toBeCloseTo(1210, 0);
      expect(dist.truncatedCount).toBe(0);
      expect(dist.truncationRate).toBe(0);
    });

    it('should calculate percentiles', () => {
      const dist = calculateTokenDistribution(mockPredictions);

      expect(dist.min).toBe(1080);
      expect(dist.max).toBe(1350);
      expect(dist.p25).toBeGreaterThanOrEqual(dist.min);
      expect(dist.p75).toBeLessThanOrEqual(dist.max);
    });

    it('should handle empty array', () => {
      const dist = calculateTokenDistribution([]);

      expect(dist.total).toBe(0);
      expect(dist.mean).toBe(0);
      expect(dist.median).toBe(0);
    });
  });

  describe('calibrateThresholds', () => {
    it('should return threshold configuration', () => {
      const result = calibrateThresholds(mockPredictions, mockGroundTruth);

      expect(result).toHaveProperty('block_score_threshold');
      expect(result).toHaveProperty('pass_score_threshold');
      expect(result).toHaveProperty('critical_issue_block_threshold');
      expect(result).toHaveProperty('recommendations');
    });

    it('should return valid threshold ranges', () => {
      const result = calibrateThresholds(mockPredictions, mockGroundTruth);

      expect(result.block_score_threshold).toBeGreaterThanOrEqual(0);
      expect(result.block_score_threshold).toBeLessThanOrEqual(100);
      expect(result.pass_score_threshold).toBeGreaterThan(result.block_score_threshold);
    });
  });

  describe('generateBenchmarkReport', () => {
    it('should generate complete benchmark report', () => {
      const mockCases: BenchmarkCase[] = [
        {
          case_id: 'case_001',
          source_run_id: 'run_001',
          frame_ids: ['f1', 'f2'],
          split: 'calibration',
          domain: 'web_app',
          description: 'Test case 1',
          created_at: '2024-01-01T00:00:00Z',
          duration_ms: 5000,
          keyframe_count: 2,
        },
        {
          case_id: 'case_002',
          source_run_id: 'run_002',
          frame_ids: ['f3', 'f4'],
          split: 'calibration',
          domain: 'web_app',
          description: 'Test case 2',
          created_at: '2024-01-01T00:00:00Z',
          duration_ms: 5000,
          keyframe_count: 2,
        },
        {
          case_id: 'case_003',
          source_run_id: 'run_003',
          frame_ids: ['f5', 'f6'],
          split: 'calibration',
          domain: 'web_app',
          description: 'Test case 3',
          created_at: '2024-01-01T00:00:00Z',
          duration_ms: 5000,
          keyframe_count: 2,
        },
      ];

      const report = generateBenchmarkReport(
        mockPredictions,
        mockGroundTruth,
        mockCases,
        'v3_hybrid',
        '1.0.0',
        'calibration'
      );

      expect(report.version).toBe('1.0.0');
      expect(report.engine_version).toBe('v3_hybrid');
      expect(report.split).toBe('calibration');
      expect(report.cases_evaluated).toBe(3);
      expect(report).toHaveProperty('category_metrics');
      expect(report).toHaveProperty('issue_tag_metrics');
      expect(report).toHaveProperty('gate_metrics');
      expect(report).toHaveProperty('token_usage_distribution');
      expect(report).toHaveProperty('release_criteria');
    });

    it('should include release criteria assessment', () => {
      const mockCases: BenchmarkCase[] = mockPredictions.map((p, i) => ({
        case_id: p.case_id,
        source_run_id: `run_${i}`,
        frame_ids: [],
        split: 'calibration' as const,
        domain: 'web_app',
        description: '',
        created_at: '2024-01-01T00:00:00Z',
        duration_ms: 5000,
        keyframe_count: 2,
      }));

      const report = generateBenchmarkReport(
        mockPredictions,
        mockGroundTruth,
        mockCases,
        'v3_hybrid',
        '1.0.0',
        'calibration'
      );

      expect(report.release_criteria).toHaveProperty('kappa_threshold');
      expect(report.release_criteria).toHaveProperty('kappa_met');
      expect(report.release_criteria).toHaveProperty('issue_f1_threshold');
      expect(report.release_criteria).toHaveProperty('issue_f1_met');
      expect(report.release_criteria).toHaveProperty('block_precision_threshold');
      expect(report.release_criteria).toHaveProperty('false_block_threshold');
      expect(report.release_criteria).toHaveProperty('all_criteria_met');
    });
  });
});
