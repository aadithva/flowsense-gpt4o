import sql, { ConnectionPool } from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import type { RubricScores } from '@interactive-flow/shared';
import { getEnv } from './env';

let pool: ConnectionPool | null = null;
let tokenExpiry = 0;
const credential = new DefaultAzureCredential();

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
    const env = getEnv();
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

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('[Azure SQL] Connection closed');
  }
}

export async function getRunById(runId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query(`
      SELECT * FROM analysis_runs
      WHERE id = @runId
    `);
  return result.recordset[0] || null;
}

export async function updateRunStatus(
  runId: string,
  status: string,
  progress?: { percentage?: number; message?: string },
  errorMessage?: string
) {
  const db = await getPool();
  const request = db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .input('status', sql.NVarChar(20), status);

  let query = 'UPDATE analysis_runs SET status = @status';

  if (progress?.percentage !== undefined) {
    request.input('progressPercentage', sql.Int, progress.percentage);
    query += ', progress_percentage = @progressPercentage';
  }

  if (progress?.message !== undefined) {
    request.input('progressMessage', sql.NVarChar(255), progress.message);
    query += ', progress_message = @progressMessage';
  }

  if (errorMessage !== undefined) {
    request.input('errorMessage', sql.NVarChar(sql.MAX), errorMessage);
    query += ', error_message = @errorMessage';
  }

  query += ' WHERE id = @runId';

  await request.query(query);
}

export async function claimNextQueuedRun(workerId: string): Promise<string | null> {
  const db = await getPool();

  // Use a table variable to avoid OUTPUT clause conflict with triggers
  const result = await db
    .request()
    .input('workerId', sql.NVarChar(100), workerId)
    .query(`
      DECLARE @claimed TABLE (id UNIQUEIDENTIFIER);

      ;WITH run_to_claim AS (
        SELECT TOP 1 id
        FROM analysis_runs WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE status = 'queued' AND ISNULL(cancel_requested, 0) = 0
        ORDER BY created_at ASC
      )
      UPDATE analysis_runs
      SET
        status = 'processing',
        progress_percentage = 0,
        progress_message = CONCAT('Claimed by ', @workerId)
      OUTPUT inserted.id INTO @claimed
      WHERE id IN (SELECT id FROM run_to_claim);

      SELECT id FROM @claimed;
    `);

  return result.recordset[0]?.id || null;
}

export async function claimRunById(runId: string, workerId: string): Promise<boolean> {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .input('workerId', sql.NVarChar(100), workerId)
    .query(`
      UPDATE analysis_runs
      SET
        status = 'processing',
        progress_percentage = 0,
        progress_message = CONCAT('Claimed by ', @workerId)
      WHERE id = @runId
        AND status = 'queued'
        AND ISNULL(cancel_requested, 0) = 0
    `);

  return result.rowsAffected[0] > 0;
}

export async function isRunCancellationRequested(runId: string): Promise<boolean> {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query(`
      SELECT cancel_requested, status
      FROM analysis_runs
      WHERE id = @runId
    `);

  const row = result.recordset[0];
  if (!row) return false;
  return row.cancel_requested === true || row.cancel_requested === 1 || row.status === 'cancel_requested';
}

export async function getFramesByRunId(runId: string, keyframesOnly = false) {
  const db = await getPool();
  const request = db.request().input('runId', sql.UniqueIdentifier, runId);

  let query = 'SELECT * FROM frames WHERE run_id = @runId';
  if (keyframesOnly) {
    query += ' AND is_keyframe = 1';
  }
  query += ' ORDER BY timestamp_ms ASC';

  const result = await request.query(query);
  return result.recordset;
}

export async function insertFrame(data: {
  id: string;
  runId: string;
  storagePath: string;
  timestampMs: number;
  isKeyframe: boolean;
  diffScore: number;
}) {
  const db = await getPool();
  await db
    .request()
    .input('id', sql.UniqueIdentifier, data.id)
    .input('runId', sql.UniqueIdentifier, data.runId)
    .input('storagePath', sql.NVarChar(500), data.storagePath)
    .input('timestampMs', sql.Int, data.timestampMs)
    .input('isKeyframe', sql.Bit, data.isKeyframe)
    .input('diffScore', sql.Float, data.diffScore)
    .query(`
      INSERT INTO frames (id, run_id, storage_path, timestamp_ms, is_keyframe, diff_score)
      VALUES (@id, @runId, @storagePath, @timestampMs, @isKeyframe, @diffScore)
    `);
}

export async function insertFrameAnalysis(data: {
  frameId: string;
  rubricScores: Record<string, number>;
  justifications: Record<string, string>;
  issueTags: string[];
  suggestions: unknown[];
}) {
  const db = await getPool();
  await db
    .request()
    .input('frameId', sql.UniqueIdentifier, data.frameId)
    .input('rubricScores', sql.NVarChar(sql.MAX), JSON.stringify(data.rubricScores))
    .input('justifications', sql.NVarChar(sql.MAX), JSON.stringify(data.justifications))
    .input('issueTags', sql.NVarChar(sql.MAX), JSON.stringify(data.issueTags))
    .input('suggestions', sql.NVarChar(sql.MAX), JSON.stringify(data.suggestions))
    .query(`
      INSERT INTO frame_analyses (frame_id, rubric_scores, justifications, issue_tags, suggestions)
      VALUES (@frameId, @rubricScores, @justifications, @issueTags, @suggestions)
    `);
}

export async function getFrameAnalysesForRun(runId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query(`
      SELECT fa.*, f.timestamp_ms, f.storage_path
      FROM frame_analyses fa
      INNER JOIN frames f ON fa.frame_id = f.id
      WHERE f.run_id = @runId
      ORDER BY f.timestamp_ms ASC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    ...row,
    rubric_scores: JSON.parse(row.rubric_scores as string),
    justifications: JSON.parse(row.justifications as string),
    issue_tags: JSON.parse(row.issue_tags as string),
    suggestions: JSON.parse(row.suggestions as string),
  }));
}

export async function insertRunSummary(data: {
  runId: string;
  overallScores: Record<string, number>;
  topIssues: unknown[];
  recommendations: unknown[];
  weightedScore100: number;
  criticalIssueCount: number;
  qualityGateStatus: 'pass' | 'warn' | 'block';
  confidenceByCategory: Record<keyof RubricScores, number>;
  metricVersion: string;
  videoFlowDescription?: {
    application: string;
    user_intent: string;
    key_actions: string[];
    flow_narrative: string;
    synthesis_confidence: number;
  };
}) {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.UniqueIdentifier, data.runId)
    .input('overallScores', sql.NVarChar(sql.MAX), JSON.stringify(data.overallScores))
    .input('topIssues', sql.NVarChar(sql.MAX), JSON.stringify(data.topIssues))
    .input('recommendations', sql.NVarChar(sql.MAX), JSON.stringify(data.recommendations))
    .input('weightedScore100', sql.Float, data.weightedScore100)
    .input('criticalIssueCount', sql.Int, data.criticalIssueCount)
    .input('qualityGateStatus', sql.NVarChar(10), data.qualityGateStatus)
    .input('confidenceByCategory', sql.NVarChar(sql.MAX), JSON.stringify(data.confidenceByCategory))
    .input('metricVersion', sql.NVarChar(20), data.metricVersion)
    .input('videoFlowDescription', sql.NVarChar(sql.MAX), data.videoFlowDescription ? JSON.stringify(data.videoFlowDescription) : null)
    .query(`
      MERGE run_summaries AS target
      USING (
        SELECT
          @runId AS run_id,
          @overallScores AS overall_scores,
          @topIssues AS top_issues,
          @recommendations AS recommendations,
          @weightedScore100 AS weighted_score_100,
          @criticalIssueCount AS critical_issue_count,
          @qualityGateStatus AS quality_gate_status,
          @confidenceByCategory AS confidence_by_category,
          @metricVersion AS metric_version,
          @videoFlowDescription AS video_flow_description
      ) AS source
        ON target.run_id = source.run_id
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
          video_flow_description = source.video_flow_description
      WHEN NOT MATCHED THEN
        INSERT (
          run_id,
          overall_scores,
          top_issues,
          recommendations,
          weighted_score_100,
          critical_issue_count,
          quality_gate_status,
          confidence_by_category,
          metric_version,
          video_flow_description
        )
        VALUES (
          source.run_id,
          source.overall_scores,
          source.top_issues,
          source.recommendations,
          source.weighted_score_100,
          source.critical_issue_count,
          source.quality_gate_status,
          source.confidence_by_category,
          source.metric_version,
          source.video_flow_description
        );
    `);
}

export async function getRunSummary(runId: string) {
  const db = await getPool();
  const result = await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query(`
      SELECT * FROM run_summaries WHERE run_id = @runId
    `);

  const row = result.recordset[0];
  if (!row) return null;

  return {
    ...row,
    overall_scores: JSON.parse(row.overall_scores),
    top_issues: JSON.parse(row.top_issues),
    recommendations: JSON.parse(row.recommendations),
    confidence_by_category: row.confidence_by_category
      ? JSON.parse(row.confidence_by_category)
      : null,
    video_flow_description: row.video_flow_description
      ? JSON.parse(row.video_flow_description)
      : undefined,
  };
}

export async function deleteRun(runId: string) {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.UniqueIdentifier, runId)
    .query('DELETE FROM analysis_runs WHERE id = @runId');
}

export { sql };
