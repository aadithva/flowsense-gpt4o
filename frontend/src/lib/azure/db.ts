import sql, { ConnectionPool } from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import type { RubricScores, RunSummary, ShadowSummary, V3Diagnostics } from '@interactive-flow/shared';
import { getServerEnv } from '@/lib/env/server';

let pool: ConnectionPool | null = null;
let tokenExpiry = 0;

const credential = new DefaultAzureCredential();

const ALLOWED_RUN_UPDATE_COLUMNS = new Set([
  'status',
  'progress_percentage',
  'progress_message',
  'error_message',
  'cancel_requested',
]);

function defaultConfidence(): Record<keyof RubricScores, number> {
  return {
    cat1: 0.5,
    cat2: 0.5,
    cat3: 0.5,
    cat4: 0.5,
    cat5: 0.5,
    cat6: 0.5,
    cat7: 0.5,
  };
}

function normalizeRunSummaryRow(row: Record<string, unknown>): RunSummary {
  // Parse V3 diagnostics if available
  let v3Diagnostics: V3Diagnostics | undefined;
  if (typeof row.v3_diagnostics === 'string' && row.v3_diagnostics) {
    try {
      v3Diagnostics = JSON.parse(row.v3_diagnostics);
    } catch {
      v3Diagnostics = undefined;
    }
  }

  // Parse video flow description if available
  let videoFlowDescription: RunSummary['video_flow_description'] | undefined;
  if (typeof row.video_flow_description === 'string' && row.video_flow_description) {
    try {
      videoFlowDescription = JSON.parse(row.video_flow_description);
    } catch {
      videoFlowDescription = undefined;
    }
  }

  return {
    run_id: row.run_id as string,
    overall_scores: JSON.parse(row.overall_scores as string),
    top_issues: JSON.parse(row.top_issues as string),
    recommendations: JSON.parse(row.recommendations as string),
    weighted_score_100: typeof row.weighted_score_100 === 'number' ? row.weighted_score_100 : 0,
    critical_issue_count: typeof row.critical_issue_count === 'number' ? row.critical_issue_count : 0,
    quality_gate_status:
      row.quality_gate_status === 'pass' ||
      row.quality_gate_status === 'warn' ||
      row.quality_gate_status === 'block'
        ? row.quality_gate_status
        : 'warn',
    confidence_by_category:
      typeof row.confidence_by_category === 'string'
        ? JSON.parse(row.confidence_by_category)
        : defaultConfidence(),
    metric_version:
      typeof row.metric_version === 'string' && row.metric_version.trim().length > 0
        ? row.metric_version
        : 'v1',
    created_at: row.created_at as string,
    // V3 fields
    analysis_engine_version:
      typeof row.analysis_engine_version === 'string' && row.analysis_engine_version.trim().length > 0
        ? row.analysis_engine_version
        : 'v3_hybrid',
    analysis_truncated: row.analysis_truncated === true || row.analysis_truncated === 1,
    frames_skipped: typeof row.frames_skipped === 'number' ? row.frames_skipped : 0,
    frames_analyzed: typeof row.frames_analyzed === 'number' ? row.frames_analyzed : 0,
    v3_diagnostics: v3Diagnostics,
    video_flow_description: videoFlowDescription,
  };
}

async function getAzureAdToken(): Promise<string> {
  const token = await credential.getToken('https://database.windows.net/.default');
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return token?.token ?? '';
}

export async function getPool(): Promise<ConnectionPool> {
  if (pool && Date.now() > tokenExpiry) {
    console.log('[Azure SQL] Token expiring, refreshing connection...');
    await pool.close();
    pool = null;
  }

  if (!pool) {
    const env = getServerEnv();
    console.log('[Azure SQL] Getting Azure AD token...');
    const token = await getAzureAdToken();

    const config = {
      server: env.AZURE_SQL_SERVER,
      database: env.AZURE_SQL_DATABASE,
      options: {
        encrypt: true,
        trustServerCertificate: false,
      },
      authentication: {
        type: 'azure-active-directory-access-token' as const,
        options: {
          token,
        },
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    pool = await new ConnectionPool(config).connect();
    console.log('[Azure SQL] Connected to database with Azure AD');
  }
  return pool;
}

export async function ensureProfile(userId: string, fullName?: string | null) {
  const db = await getPool();
  await db
    .request()
    .input('id', sql.UniqueIdentifier, userId)
    .input('fullName', sql.NVarChar(255), fullName ?? null)
    .query(`
      MERGE profiles AS target
      USING (SELECT @id AS id, @fullName AS full_name) AS source
        ON target.id = source.id
      WHEN NOT MATCHED THEN
        INSERT (id, full_name)
        VALUES (source.id, source.full_name)
      WHEN MATCHED AND source.full_name IS NOT NULL AND (target.full_name IS NULL OR target.full_name = '') THEN
        UPDATE SET full_name = source.full_name;
    `);
}

export async function createRun(data: {
  id: string;
  userId: string;
  title: string;
  videoStoragePath: string;
}) {
  const db = await getPool();
  await db
    .request()
    .input('id', sql.UniqueIdentifier, data.id)
    .input('userId', sql.UniqueIdentifier, data.userId)
    .input('title', sql.NVarChar(255), data.title)
    .input('videoPath', sql.NVarChar(500), data.videoStoragePath)
    .query(`
      INSERT INTO analysis_runs (id, user_id, title, video_storage_path, status, cancel_requested)
      VALUES (@id, @userId, @title, @videoPath, 'uploaded', 0)
    `);

  return getRunById(data.id);
}

export async function getRunById(runId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query('SELECT * FROM analysis_runs WHERE id = @runId');
  return result.recordset[0] || null;
}

export async function getRunByIdAndUser(runId: string, userId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .input('userId', sql.UniqueIdentifier, userId)
    .query('SELECT * FROM analysis_runs WHERE id = @runId AND user_id = @userId');
  return result.recordset[0] || null;
}

export async function getRunsByUser(userId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.UniqueIdentifier, userId)
    .query(`
      SELECT * FROM analysis_runs
      WHERE user_id = @userId
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

export async function getPreviousCompletedRunSummaryByTitle(params: {
  userId: string;
  title: string;
  currentRunId: string;
}): Promise<RunSummary | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.UniqueIdentifier, params.userId)
    .input('title', sql.NVarChar(255), params.title)
    .input('currentRunId', sql.UniqueIdentifier, params.currentRunId)
    .query(`
      SELECT TOP 1 rs.*
      FROM analysis_runs ar
      INNER JOIN run_summaries rs ON rs.run_id = ar.id
      WHERE ar.user_id = @userId
        AND ar.title = @title
        AND ar.id <> @currentRunId
        AND ar.status = 'completed'
      ORDER BY ar.created_at DESC
    `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return normalizeRunSummaryRow(row);
}

export async function updateRun(runId: string, updates: Record<string, unknown>) {
  const db = await getPool();
  const request = db.request().input('runId', sql.UniqueIdentifier, runId);

  const setClauses: string[] = [];
  let index = 0;

  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_RUN_UPDATE_COLUMNS.has(key)) {
      throw new Error(`Unsupported update column: ${key}`);
    }

    const paramName = `param${index++}`;

    if (key === 'cancel_requested') {
      request.input(paramName, sql.Bit, value ? 1 : 0);
    } else if (key === 'progress_percentage') {
      request.input(paramName, sql.Int, typeof value === 'number' ? value : 0);
    } else if (value === null) {
      request.input(paramName, sql.NVarChar(sql.MAX), null);
    } else {
      request.input(paramName, sql.NVarChar(sql.MAX), String(value));
    }

    setClauses.push(`${key} = @${paramName}`);
  }

  if (setClauses.length === 0) return;

  await request.query(`
    UPDATE analysis_runs SET ${setClauses.join(', ')}
    WHERE id = @runId
  `);
}

export async function deleteRun(runId: string, userId: string) {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .input('userId', sql.UniqueIdentifier, userId)
    .query('DELETE FROM analysis_runs WHERE id = @runId AND user_id = @userId');
}

export async function getFrameCountForRun(runId: string): Promise<number> {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query('SELECT COUNT(*) as count FROM frames WHERE run_id = @runId');
  return result.recordset[0]?.count || 0;
}

export async function getKeyframesWithAnalyses(runId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query(`
      SELECT f.*, fa.id as analysis_id, fa.rubric_scores, fa.justifications, fa.issue_tags, fa.suggestions
      FROM frames f
      LEFT JOIN frame_analyses fa ON f.id = fa.frame_id
      WHERE f.run_id = @runId AND f.is_keyframe = 1
      ORDER BY f.timestamp_ms ASC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    run_id: row.run_id as string,
    storage_path: row.storage_path as string,
    timestamp_ms: row.timestamp_ms as number,
    is_keyframe: row.is_keyframe as boolean,
    diff_score: row.diff_score as number,
    created_at: row.created_at as string,
    analysis: row.analysis_id
      ? [
          {
            id: row.analysis_id as string,
            rubric_scores: JSON.parse(row.rubric_scores as string),
            justifications: JSON.parse(row.justifications as string),
            issue_tags: JSON.parse(row.issue_tags as string),
            suggestions: JSON.parse(row.suggestions as string),
          },
        ]
      : [],
  }));
}

export async function deleteFramesForRun(runId: string) {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query('DELETE FROM frames WHERE run_id = @runId');
}

export async function getRunSummary(runId: string): Promise<RunSummary | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query('SELECT * FROM run_summaries WHERE run_id = @runId');

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return normalizeRunSummaryRow(row);
}

export async function deleteSummaryForRun(runId: string) {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query('DELETE FROM run_summaries WHERE run_id = @runId');
}

/**
 * V3: Get shadow summary for a run (if exists)
 */
export async function getShadowSummary(runId: string): Promise<ShadowSummary | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query(`
      SELECT * FROM run_summaries_versions
      WHERE run_id = @runId AND is_shadow = 1
    `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  // Parse V3 diagnostics if available
  let v3Diagnostics: V3Diagnostics | undefined;
  if (typeof row.v3_diagnostics === 'string' && row.v3_diagnostics) {
    try {
      v3Diagnostics = JSON.parse(row.v3_diagnostics);
    } catch {
      v3Diagnostics = undefined;
    }
  }

  return {
    overall_scores: JSON.parse(row.overall_scores as string),
    top_issues: JSON.parse(row.top_issues as string),
    recommendations: JSON.parse(row.recommendations as string),
    weighted_score_100: typeof row.weighted_score_100 === 'number' ? row.weighted_score_100 : 0,
    critical_issue_count: typeof row.critical_issue_count === 'number' ? row.critical_issue_count : 0,
    quality_gate_status:
      row.quality_gate_status === 'pass' ||
      row.quality_gate_status === 'warn' ||
      row.quality_gate_status === 'block'
        ? row.quality_gate_status
        : 'warn',
    confidence_by_category:
      typeof row.confidence_by_category === 'string'
        ? JSON.parse(row.confidence_by_category)
        : defaultConfidence(),
    metric_version:
      typeof row.metric_version === 'string' && row.metric_version.trim().length > 0
        ? row.metric_version
        : 'v2',
    analysis_engine_version:
      typeof row.analysis_engine_version === 'string' && row.analysis_engine_version.trim().length > 0
        ? row.analysis_engine_version
        : 'v3_hybrid',
    analysis_truncated: row.analysis_truncated === true || row.analysis_truncated === 1,
    frames_skipped: typeof row.frames_skipped === 'number' ? row.frames_skipped : 0,
    frames_analyzed: typeof row.frames_analyzed === 'number' ? row.frames_analyzed : 0,
    v3_diagnostics: v3Diagnostics,
    is_shadow: true,
    shadow_sample_rate: typeof row.shadow_sample_rate === 'number' ? row.shadow_sample_rate : undefined,
  };
}

/**
 * V3: Insert shadow summary (V3 analysis result)
 */
export async function insertShadowSummary(data: {
  runId: string;
  analysisEngineVersion: 'v2_baseline' | 'v3_hybrid';
  overallScores: Record<string, number>;
  topIssues: Array<{ category: string; severity: string; description: string }>;
  recommendations: Array<{ title: string; description: string; priority: string }>;
  weightedScore100: number;
  criticalIssueCount: number;
  qualityGateStatus: 'pass' | 'warn' | 'block';
  confidenceByCategory: Record<string, number>;
  metricVersion: string;
  analysisTruncated: boolean;
  framesSkipped: number;
  framesAnalyzed: number;
  v3Diagnostics?: Record<string, unknown>;
  isShadow: boolean;
  shadowSampleRate?: number;
}): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.UniqueIdentifier, data.runId)
    .input('analysisEngineVersion', sql.NVarChar(20), data.analysisEngineVersion)
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
    .input('isShadow', sql.Bit, data.isShadow ? 1 : 0)
    .input('shadowSampleRate', sql.Float, data.shadowSampleRate ?? null)
    .query(`
      MERGE run_summaries_versions AS target
      USING (SELECT @runId AS run_id, @analysisEngineVersion AS analysis_engine_version) AS source
      ON target.run_id = source.run_id AND target.analysis_engine_version = source.analysis_engine_version
      WHEN MATCHED THEN
        UPDATE SET
          overall_scores = @overallScores,
          top_issues = @topIssues,
          recommendations = @recommendations,
          weighted_score_100 = @weightedScore100,
          critical_issue_count = @criticalIssueCount,
          quality_gate_status = @qualityGateStatus,
          confidence_by_category = @confidenceByCategory,
          metric_version = @metricVersion,
          analysis_truncated = @analysisTruncated,
          frames_skipped = @framesSkipped,
          frames_analyzed = @framesAnalyzed,
          v3_diagnostics = @v3Diagnostics,
          is_shadow = @isShadow,
          shadow_sample_rate = @shadowSampleRate
      WHEN NOT MATCHED THEN
        INSERT (
          run_id, analysis_engine_version, overall_scores, top_issues, recommendations,
          weighted_score_100, critical_issue_count, quality_gate_status, confidence_by_category,
          metric_version, analysis_truncated, frames_skipped, frames_analyzed, v3_diagnostics,
          is_shadow, shadow_sample_rate
        ) VALUES (
          @runId, @analysisEngineVersion, @overallScores, @topIssues, @recommendations,
          @weightedScore100, @criticalIssueCount, @qualityGateStatus, @confidenceByCategory,
          @metricVersion, @analysisTruncated, @framesSkipped, @framesAnalyzed, @v3Diagnostics,
          @isShadow, @shadowSampleRate
        );
    `);
}

/**
 * V3: Compute shadow diff between primary and shadow summaries
 */
export function computeShadowDiffFromSummaries(
  primary: RunSummary,
  shadow: ShadowSummary | null
): {
  shadow_enabled: boolean;
  shadow_engine_version: string | null;
  weighted_score_delta: number | null;
  critical_issue_delta: number | null;
  quality_gate_changed: boolean;
  primary_quality_gate: 'pass' | 'warn' | 'block';
  shadow_quality_gate: 'pass' | 'warn' | 'block' | null;
} {
  if (!shadow) {
    return {
      shadow_enabled: false,
      shadow_engine_version: null,
      weighted_score_delta: null,
      critical_issue_delta: null,
      quality_gate_changed: false,
      primary_quality_gate: primary.quality_gate_status,
      shadow_quality_gate: null,
    };
  }

  return {
    shadow_enabled: true,
    shadow_engine_version: shadow.analysis_engine_version,
    weighted_score_delta: Number((shadow.weighted_score_100 - primary.weighted_score_100).toFixed(2)),
    critical_issue_delta: shadow.critical_issue_count - primary.critical_issue_count,
    quality_gate_changed: shadow.quality_gate_status !== primary.quality_gate_status,
    primary_quality_gate: primary.quality_gate_status,
    shadow_quality_gate: shadow.quality_gate_status,
  };
}

export { sql };
