import sql, { ConnectionPool } from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import type { RubricScores, RunSummary } from '@interactive-flow/shared';
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

export { sql };
