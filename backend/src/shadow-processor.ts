/**
 * Shadow Processor
 * V3 Accuracy Upgrade - Day 10: Shadow Rollout + Release Gate
 *
 * Handles shadow analysis dual-write, monitoring, and release gate evaluation.
 */

import { getPool, sql } from './azure-db';
import { trackMetric, trackEvent } from './telemetry';
import {
  type ShadowRolloutConfig,
  type ShadowRunRecord,
  type ShadowMonitoringMetrics,
  type ReleaseGateResult,
  type AnalysisEngineVersion,
  type RubricScores,
  type V3Diagnostics,
  shouldRunShadowAnalysis,
  computeMonitoringMetrics,
  checkReleaseGates,
  formatReleaseGateReport,
  DEFAULT_SHADOW_CONFIG,
  STAGING_SHADOW_CONFIG,
  PRODUCTION_SHADOW_CONFIG,
} from '@interactive-flow/shared';
import { getEnv } from './env';

// =============================================================================
// Shadow Rollout Configuration Management
// =============================================================================

let currentConfig: ShadowRolloutConfig = DEFAULT_SHADOW_CONFIG;

/**
 * Get the current shadow rollout configuration
 */
export function getShadowConfig(): ShadowRolloutConfig {
  return currentConfig;
}

/**
 * Initialize shadow config based on environment
 */
export function initializeShadowConfig(): ShadowRolloutConfig {
  const env = getEnv();
  const environment = env.NODE_ENV === 'production' ? 'production' : 'staging';

  if (environment === 'production') {
    currentConfig = { ...PRODUCTION_SHADOW_CONFIG };
  } else {
    currentConfig = { ...STAGING_SHADOW_CONFIG };
  }

  // Override from environment variables if present
  if (process.env.SHADOW_ENABLED === 'true') {
    currentConfig.enabled = true;
  } else if (process.env.SHADOW_ENABLED === 'false') {
    currentConfig.enabled = false;
  }

  if (process.env.SHADOW_SAMPLE_RATE) {
    const rate = parseFloat(process.env.SHADOW_SAMPLE_RATE);
    if (!isNaN(rate) && rate >= 0 && rate <= 1) {
      currentConfig.sampleRate = rate;
    }
  }

  if (process.env.SHADOW_AUTO_PROMOTE === 'true') {
    currentConfig.autoPromote = true;
  }

  console.log(`[Shadow] Initialized config: enabled=${currentConfig.enabled}, sampleRate=${currentConfig.sampleRate}, env=${environment}`);

  return currentConfig;
}

/**
 * Update shadow config at runtime (for feature flag changes)
 */
export function updateShadowConfig(updates: Partial<ShadowRolloutConfig>): ShadowRolloutConfig {
  currentConfig = { ...currentConfig, ...updates };
  console.log(`[Shadow] Updated config:`, currentConfig);
  return currentConfig;
}

// =============================================================================
// Shadow Summary Dual-Write
// =============================================================================

export interface ShadowSummaryData {
  runId: string;
  engineVersion: AnalysisEngineVersion;
  overallScores: Record<string, number>;
  topIssues: unknown[];
  recommendations: unknown[];
  weightedScore100: number;
  criticalIssueCount: number;
  qualityGateStatus: 'pass' | 'warn' | 'block';
  confidenceByCategory: Record<keyof RubricScores, number>;
  metricVersion: string;
  analysisTruncated: boolean;
  framesSkipped: number;
  framesAnalyzed: number;
  v3Diagnostics?: V3Diagnostics;
  shadowSampleRate: number;
}

/**
 * Insert shadow summary to versioned store (run_summaries_versions table)
 */
export async function insertShadowSummary(data: ShadowSummaryData): Promise<void> {
  const db = await getPool();

  try {
    await db
      .request()
      .input('runId', sql.UniqueIdentifier, data.runId)
      .input('engineVersion', sql.NVarChar(50), data.engineVersion)
      .input('overallScores', sql.NVarChar(sql.MAX), JSON.stringify(data.overallScores))
      .input('topIssues', sql.NVarChar(sql.MAX), JSON.stringify(data.topIssues))
      .input('recommendations', sql.NVarChar(sql.MAX), JSON.stringify(data.recommendations))
      .input('weightedScore100', sql.Float, data.weightedScore100)
      .input('criticalIssueCount', sql.Int, data.criticalIssueCount)
      .input('qualityGateStatus', sql.NVarChar(10), data.qualityGateStatus)
      .input('confidenceByCategory', sql.NVarChar(sql.MAX), JSON.stringify(data.confidenceByCategory))
      .input('metricVersion', sql.NVarChar(20), data.metricVersion)
      .input('analysisTruncated', sql.Bit, data.analysisTruncated ? 1 : 0)
      .input('framesSkipped', sql.Int, data.framesSkipped)
      .input('framesAnalyzed', sql.Int, data.framesAnalyzed)
      .input('v3Diagnostics', sql.NVarChar(sql.MAX), data.v3Diagnostics ? JSON.stringify(data.v3Diagnostics) : null)
      .input('isShadow', sql.Bit, 1)
      .input('shadowSampleRate', sql.Float, data.shadowSampleRate)
      .query(`
        MERGE run_summaries_versions AS target
        USING (
          SELECT
            @runId AS run_id,
            @engineVersion AS analysis_engine_version,
            @overallScores AS overall_scores,
            @topIssues AS top_issues,
            @recommendations AS recommendations,
            @weightedScore100 AS weighted_score_100,
            @criticalIssueCount AS critical_issue_count,
            @qualityGateStatus AS quality_gate_status,
            @confidenceByCategory AS confidence_by_category,
            @metricVersion AS metric_version,
            @analysisTruncated AS analysis_truncated,
            @framesSkipped AS frames_skipped,
            @framesAnalyzed AS frames_analyzed,
            @v3Diagnostics AS v3_diagnostics,
            @isShadow AS is_shadow,
            @shadowSampleRate AS shadow_sample_rate
        ) AS source
          ON target.run_id = source.run_id AND target.analysis_engine_version = source.analysis_engine_version
        WHEN MATCHED THEN
          UPDATE SET
            overall_scores = source.overall_scores,
            top_issues = source.top_issues,
            recommendations = source.recommendations,
            weighted_score_100 = source.weighted_score_100,
            critical_issue_count = source.critical_issue_count,
            quality_gate_status = source.quality_gate_status,
            confidence_by_category = source.confidence_by_category,
            metric_version = source.metric_version,
            analysis_truncated = source.analysis_truncated,
            frames_skipped = source.frames_skipped,
            frames_analyzed = source.frames_analyzed,
            v3_diagnostics = source.v3_diagnostics,
            is_shadow = source.is_shadow,
            shadow_sample_rate = source.shadow_sample_rate
        WHEN NOT MATCHED THEN
          INSERT (
            run_id, analysis_engine_version, overall_scores, top_issues, recommendations,
            weighted_score_100, critical_issue_count, quality_gate_status, confidence_by_category,
            metric_version, analysis_truncated, frames_skipped, frames_analyzed, v3_diagnostics,
            is_shadow, shadow_sample_rate
          )
          VALUES (
            source.run_id, source.analysis_engine_version, source.overall_scores, source.top_issues,
            source.recommendations, source.weighted_score_100, source.critical_issue_count,
            source.quality_gate_status, source.confidence_by_category, source.metric_version,
            source.analysis_truncated, source.frames_skipped, source.frames_analyzed, source.v3_diagnostics,
            source.is_shadow, source.shadow_sample_rate
          );
      `);

    console.log(`[Shadow] Inserted shadow summary for run ${data.runId} with engine ${data.engineVersion}`);

    trackEvent('shadow.summary_inserted', {
      runId: data.runId,
      engineVersion: data.engineVersion,
      qualityGate: data.qualityGateStatus,
      truncated: String(data.analysisTruncated),
    });

  } catch (error) {
    console.error(`[Shadow] Failed to insert shadow summary for run ${data.runId}:`, error);
    trackEvent('shadow.summary_insert_failed', {
      runId: data.runId,
      engineVersion: data.engineVersion,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw error;
  }
}

// =============================================================================
// Shadow Run Tracking
// =============================================================================

/**
 * Record a shadow run for monitoring
 */
export async function recordShadowRun(record: ShadowRunRecord): Promise<void> {
  const db = await getPool();

  try {
    await db
      .request()
      .input('runId', sql.UniqueIdentifier, record.runId)
      .input('timestamp', sql.DateTime2, new Date(record.timestamp))
      .input('primaryEngine', sql.NVarChar(50), record.primaryEngine)
      .input('shadowEngine', sql.NVarChar(50), record.shadowEngine)
      .input('primarySuccess', sql.Bit, record.primarySuccess ? 1 : 0)
      .input('shadowSuccess', sql.Bit, record.shadowSuccess ? 1 : 0)
      .input('primaryTruncated', sql.Bit, record.primaryTruncated ? 1 : 0)
      .input('shadowTruncated', sql.Bit, record.shadowTruncated ? 1 : 0)
      .input('primaryFramesSkipped', sql.Int, record.primaryFramesSkipped)
      .input('shadowFramesSkipped', sql.Int, record.shadowFramesSkipped)
      .input('primaryWeightedScore', sql.Float, record.primaryWeightedScore)
      .input('shadowWeightedScore', sql.Float, record.shadowWeightedScore)
      .input('primaryCriticalIssues', sql.Int, record.primaryCriticalIssues)
      .input('shadowCriticalIssues', sql.Int, record.shadowCriticalIssues)
      .input('primaryQualityGate', sql.NVarChar(10), record.primaryQualityGate)
      .input('shadowQualityGate', sql.NVarChar(10), record.shadowQualityGate)
      .input('gateChanged', sql.Bit, record.gateChanged ? 1 : 0)
      .input('weightedScoreDelta', sql.Float, record.weightedScoreDelta)
      .input('criticalIssueDelta', sql.Int, record.criticalIssueDelta)
      .input('primaryTokens', sql.Int, record.primaryTokens)
      .input('shadowTokens', sql.Int, record.shadowTokens)
      .query(`
        INSERT INTO shadow_run_records (
          run_id, timestamp, primary_engine, shadow_engine,
          primary_success, shadow_success, primary_truncated, shadow_truncated,
          primary_frames_skipped, shadow_frames_skipped,
          primary_weighted_score, shadow_weighted_score,
          primary_critical_issues, shadow_critical_issues,
          primary_quality_gate, shadow_quality_gate, gate_changed,
          weighted_score_delta, critical_issue_delta,
          primary_tokens, shadow_tokens
        ) VALUES (
          @runId, @timestamp, @primaryEngine, @shadowEngine,
          @primarySuccess, @shadowSuccess, @primaryTruncated, @shadowTruncated,
          @primaryFramesSkipped, @shadowFramesSkipped,
          @primaryWeightedScore, @shadowWeightedScore,
          @primaryCriticalIssues, @shadowCriticalIssues,
          @primaryQualityGate, @shadowQualityGate, @gateChanged,
          @weightedScoreDelta, @criticalIssueDelta,
          @primaryTokens, @shadowTokens
        )
      `);

    // Track telemetry
    trackMetric('shadow.run_recorded', 1, {
      primaryEngine: record.primaryEngine,
      shadowEngine: record.shadowEngine,
      gateChanged: String(record.gateChanged),
    });

    if (record.gateChanged) {
      trackEvent('shadow.gate_changed', {
        runId: record.runId,
        primaryGate: record.primaryQualityGate ?? 'null',
        shadowGate: record.shadowQualityGate ?? 'null',
        scoreDelta: String(record.weightedScoreDelta),
      });
    }

  } catch (error) {
    // Log but don't throw - shadow tracking shouldn't fail primary processing
    console.error(`[Shadow] Failed to record shadow run for ${record.runId}:`, error);
    trackEvent('shadow.record_failed', {
      runId: record.runId,
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }
}

/**
 * Get shadow run records for a time window
 */
export async function getShadowRunRecords(
  startTime: Date,
  endTime: Date
): Promise<ShadowRunRecord[]> {
  const db = await getPool();

  const result = await db
    .request()
    .input('startTime', sql.DateTime2, startTime)
    .input('endTime', sql.DateTime2, endTime)
    .query(`
      SELECT * FROM shadow_run_records
      WHERE timestamp >= @startTime AND timestamp < @endTime
      ORDER BY timestamp ASC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    runId: row.run_id as string,
    timestamp: (row.timestamp as Date).toISOString(),
    primaryEngine: row.primary_engine as AnalysisEngineVersion,
    shadowEngine: row.shadow_engine as AnalysisEngineVersion,
    primarySuccess: row.primary_success === true || row.primary_success === 1,
    shadowSuccess: row.shadow_success === true || row.shadow_success === 1,
    primaryTruncated: row.primary_truncated === true || row.primary_truncated === 1,
    shadowTruncated: row.shadow_truncated === true || row.shadow_truncated === 1,
    primaryFramesSkipped: row.primary_frames_skipped as number,
    shadowFramesSkipped: row.shadow_frames_skipped as number,
    primaryWeightedScore: row.primary_weighted_score as number | null,
    shadowWeightedScore: row.shadow_weighted_score as number | null,
    primaryCriticalIssues: row.primary_critical_issues as number | null,
    shadowCriticalIssues: row.shadow_critical_issues as number | null,
    primaryQualityGate: row.primary_quality_gate as 'pass' | 'warn' | 'block' | null,
    shadowQualityGate: row.shadow_quality_gate as 'pass' | 'warn' | 'block' | null,
    gateChanged: row.gate_changed === true || row.gate_changed === 1,
    weightedScoreDelta: row.weighted_score_delta as number | null,
    criticalIssueDelta: row.critical_issue_delta as number | null,
    primaryTokens: row.primary_tokens as number,
    shadowTokens: row.shadow_tokens as number,
  }));
}

// =============================================================================
// Monitoring Dashboard
// =============================================================================

/**
 * Get current monitoring metrics for a time window
 */
export async function getMonitoringMetrics(
  hoursBack: number = 24
): Promise<ShadowMonitoringMetrics> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);

  const records = await getShadowRunRecords(startTime, endTime);
  return computeMonitoringMetrics(records, startTime, endTime);
}

/**
 * Evaluate release gates and optionally promote
 */
export async function evaluateReleaseGates(
  benchmarkMetrics: {
    meanKappa: number;
    kappaUplift: number;
    issueF1: number;
    blockPrecision: number;
    falseBlockRate: number;
  }
): Promise<ReleaseGateResult> {
  const config = getShadowConfig();
  const metrics = await getMonitoringMetrics(24); // Last 24 hours

  // Check minimum samples
  if (metrics.totalRuns < config.minSamplesForPromotion) {
    return {
      allGatesPass: false,
      gates: [],
      recommendation: 'hold',
      reasoning: `Insufficient samples: ${metrics.totalRuns}/${config.minSamplesForPromotion} required`,
      evaluatedAt: new Date().toISOString(),
    };
  }

  const result = checkReleaseGates(metrics, benchmarkMetrics);

  // Track evaluation
  trackEvent('shadow.release_gates_evaluated', {
    allGatesPass: String(result.allGatesPass),
    recommendation: result.recommendation,
    totalRuns: String(metrics.totalRuns),
    gateChangeFreq: String(metrics.gateChanges.gateChangeFrequency),
  });

  // Auto-promote if enabled and all gates pass
  if (config.autoPromote && result.allGatesPass) {
    console.log('[Shadow] All release gates passed, auto-promoting V3 to active');
    await promoteV3ToActive();
    trackEvent('shadow.auto_promoted', {
      previousActive: config.activeEngine,
      newActive: config.shadowEngine,
    });
  }

  return result;
}

/**
 * Promote V3 to active engine
 */
export async function promoteV3ToActive(): Promise<void> {
  const config = getShadowConfig();

  // Swap active and shadow engines
  const newConfig: Partial<ShadowRolloutConfig> = {
    activeEngine: config.shadowEngine,
    shadowEngine: config.activeEngine,
    // Disable shadow after promotion (can be re-enabled later)
    enabled: false,
    sampleRate: 0,
  };

  updateShadowConfig(newConfig);

  console.log(`[Shadow] Promoted ${config.shadowEngine} to active, ${config.activeEngine} is now shadow`);

  trackEvent('shadow.engine_promoted', {
    newActive: config.shadowEngine,
    previousActive: config.activeEngine,
  });
}

// =============================================================================
// Shadow Analysis Helper
// =============================================================================

/**
 * Check if shadow analysis should run for a given run
 */
export function shouldRunShadow(runId: string): boolean {
  const config = getShadowConfig();
  return shouldRunShadowAnalysis(config, runId);
}

/**
 * Get shadow diff between primary and shadow summaries
 */
export function computeShadowDiff(
  primary: { weightedScore100: number; criticalIssueCount: number; qualityGateStatus: 'pass' | 'warn' | 'block' },
  shadow: { weightedScore100: number; criticalIssueCount: number; qualityGateStatus: 'pass' | 'warn' | 'block' }
): { weightedScoreDelta: number; criticalIssueDelta: number; gateChanged: boolean } {
  return {
    weightedScoreDelta: Number((shadow.weightedScore100 - primary.weightedScore100).toFixed(2)),
    criticalIssueDelta: shadow.criticalIssueCount - primary.criticalIssueCount,
    gateChanged: shadow.qualityGateStatus !== primary.qualityGateStatus,
  };
}

// =============================================================================
// SQL Migration Helper
// =============================================================================

/**
 * Create shadow_run_records table if not exists
 * (Should be part of migration but included here for convenience)
 */
export async function ensureShadowRunRecordsTable(): Promise<void> {
  const db = await getPool();

  try {
    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'shadow_run_records')
      BEGIN
        CREATE TABLE shadow_run_records (
          id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
          run_id UNIQUEIDENTIFIER NOT NULL,
          timestamp DATETIME2 NOT NULL,
          primary_engine NVARCHAR(50) NOT NULL,
          shadow_engine NVARCHAR(50) NOT NULL,
          primary_success BIT NOT NULL,
          shadow_success BIT NOT NULL,
          primary_truncated BIT NOT NULL DEFAULT 0,
          shadow_truncated BIT NOT NULL DEFAULT 0,
          primary_frames_skipped INT NOT NULL DEFAULT 0,
          shadow_frames_skipped INT NOT NULL DEFAULT 0,
          primary_weighted_score FLOAT NULL,
          shadow_weighted_score FLOAT NULL,
          primary_critical_issues INT NULL,
          shadow_critical_issues INT NULL,
          primary_quality_gate NVARCHAR(10) NULL,
          shadow_quality_gate NVARCHAR(10) NULL,
          gate_changed BIT NOT NULL DEFAULT 0,
          weighted_score_delta FLOAT NULL,
          critical_issue_delta INT NULL,
          primary_tokens INT NOT NULL DEFAULT 0,
          shadow_tokens INT NOT NULL DEFAULT 0,
          created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

          INDEX IX_shadow_run_records_timestamp (timestamp),
          INDEX IX_shadow_run_records_run_id (run_id)
        );
      END
    `);
    console.log('[Shadow] Ensured shadow_run_records table exists');
  } catch (error) {
    console.error('[Shadow] Failed to create shadow_run_records table:', error);
  }
}
