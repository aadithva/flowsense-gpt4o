#!/usr/bin/env npx tsx
/**
 * Build Benchmark Script
 * V3 Accuracy Upgrade - Day 2: Benchmark Set Build
 *
 * Samples cases from internal runs to create benchmark dataset.
 *
 * Usage:
 *   npx tsx scripts/eval/build-benchmark.ts [options]
 *
 * Options:
 *   --output <path>     Output path for manifest (default: ./benchmark/manifest.json)
 *   --count <n>         Target number of cases (default: 120)
 *   --seed <n>          Random seed for split assignment (default: 42)
 *   --domain <domain>   Filter by domain (default: web_app)
 *   --min-keyframes <n> Minimum keyframes per case (default: 3)
 *   --dry-run           Preview without writing files
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  type BenchmarkCase,
  type BenchmarkManifest,
  BENCHMARK_CONFIG,
  generateCaseId,
  assignSplit,
  benchmarkManifestSchema,
} from '@interactive-flow/shared';

// =============================================================================
// Configuration
// =============================================================================

interface BuildConfig {
  outputPath: string;
  targetCount: number;
  seed: number;
  domain: string;
  minKeyframes: number;
  dryRun: boolean;
  allowMock: boolean;
}

function parseArgs(): BuildConfig {
  const args = process.argv.slice(2);
  const config: BuildConfig = {
    outputPath: './benchmark/manifest.json',
    targetCount: BENCHMARK_CONFIG.TARGET_TOTAL_CASES,
    seed: 42,
    domain: 'web_app',
    minKeyframes: 3,
    dryRun: false,
    allowMock: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
        config.outputPath = args[++i];
        break;
      case '--count':
        config.targetCount = parseInt(args[++i], 10);
        break;
      case '--seed':
        config.seed = parseInt(args[++i], 10);
        break;
      case '--domain':
        config.domain = args[++i];
        break;
      case '--min-keyframes':
        config.minKeyframes = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--allow-mock':
        config.allowMock = true;
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
Build Benchmark Script - FlowSense V3 Accuracy Upgrade

Usage:
  npx tsx scripts/eval/build-benchmark.ts [options]

Options:
  --output <path>       Output path for manifest (default: ./benchmark/manifest.json)
  --count <n>           Target number of cases (default: 120)
  --seed <n>            Random seed for split assignment (default: 42)
  --domain <domain>     Filter by domain (default: web_app)
  --min-keyframes <n>   Minimum keyframes per case (default: 3)
  --dry-run             Preview without writing files
  --allow-mock          Allow mock data when database is unavailable (required for non-production use)
  --help                Show this help message

Examples:
  # Build default benchmark with 120 cases (requires database)
  npx tsx scripts/eval/build-benchmark.ts

  # Build smaller benchmark for testing with mock data
  npx tsx scripts/eval/build-benchmark.ts --count 20 --dry-run --allow-mock

  # Build with custom output path
  npx tsx scripts/eval/build-benchmark.ts --output ./data/benchmark-v1.json
`);
}

// =============================================================================
// Mock Data Source (Replace with actual DB queries in production)
// =============================================================================

interface RunCandidate {
  run_id: string;
  title: string;
  frame_ids: string[];
  keyframe_count: number;
  duration_ms: number;
  created_at: string;
  domain: string;
  status: string;
}

/**
 * Fetch run candidates from database.
 * Mock data requires explicit --allow-mock flag to prevent accidental use.
 */
async function fetchRunCandidates(
  domain: string,
  minKeyframes: number,
  limit: number,
  allowMock: boolean
): Promise<RunCandidate[]> {
  // Check if we have a database connection configured
  const hasDbConfig = process.env.AZURE_SQL_SERVER && process.env.AZURE_SQL_DATABASE;

  if (hasDbConfig) {
    return fetchRunCandidatesFromDb(domain, minKeyframes, limit);
  }

  // No database - check if mock is explicitly allowed
  if (!allowMock) {
    console.error('[build-benchmark] ERROR: No database configured.');
    console.error('[build-benchmark] To use mock data for development, pass --allow-mock flag.');
    console.error('[build-benchmark] Mock data should NOT be used for production benchmark evaluation.');
    process.exit(1);
  }

  // Return mock data only when explicitly allowed
  console.warn('[build-benchmark] WARNING: Using mock data (--allow-mock flag set)');
  console.warn('[build-benchmark] This benchmark should NOT be used for production accuracy claims.');
  return generateMockCandidates(limit);
}

async function fetchRunCandidatesFromDb(
  domain: string,
  minKeyframes: number,
  limit: number
): Promise<RunCandidate[]> {
  // Dynamic import to avoid issues when DB isn't configured
  const { getPool } = await import('../../backend/src/azure-db.js');
  const sql = await import('mssql');

  const pool = await getPool();

  const result = await pool.request()
    .input('domain', sql.default.NVarChar(50), domain)
    .input('minKeyframes', sql.default.Int, minKeyframes)
    .input('limit', sql.default.Int, limit)
    .query(`
      SELECT TOP (@limit)
        r.id AS run_id,
        r.title,
        r.created_at,
        r.status,
        (
          SELECT COUNT(*) FROM frames f
          WHERE f.run_id = r.id AND f.is_keyframe = 1
        ) AS keyframe_count,
        (
          SELECT MAX(f.timestamp_ms) FROM frames f WHERE f.run_id = r.id
        ) AS duration_ms
      FROM analysis_runs r
      WHERE r.status = 'completed'
        AND (
          SELECT COUNT(*) FROM frames f
          WHERE f.run_id = r.id AND f.is_keyframe = 1
        ) >= @minKeyframes
      ORDER BY r.created_at DESC
    `);

  const candidates: RunCandidate[] = [];

  for (const row of result.recordset) {
    // Fetch frame IDs for each run
    const framesResult = await pool.request()
      .input('runId', sql.default.UniqueIdentifier, row.run_id)
      .query(`
        SELECT id FROM frames
        WHERE run_id = @runId AND is_keyframe = 1
        ORDER BY timestamp_ms
      `);

    candidates.push({
      run_id: row.run_id,
      title: row.title || 'Untitled',
      frame_ids: framesResult.recordset.map((f: any) => f.id),
      keyframe_count: row.keyframe_count,
      duration_ms: row.duration_ms || 0,
      created_at: row.created_at,
      domain: domain,
      status: row.status,
    });
  }

  return candidates;
}

function generateMockCandidates(count: number): RunCandidate[] {
  const candidates: RunCandidate[] = [];

  for (let i = 0; i < count; i++) {
    const runId = `mock-run-${i.toString().padStart(4, '0')}-${Date.now()}`;
    const keyframeCount = 3 + Math.floor(Math.random() * 10);
    const frameIds = Array.from({ length: keyframeCount }, (_, j) =>
      `mock-frame-${i}-${j}-${Date.now()}`
    );

    candidates.push({
      run_id: runId,
      title: `Mock Task Flow ${i + 1}`,
      frame_ids: frameIds,
      keyframe_count: keyframeCount,
      duration_ms: 5000 + Math.floor(Math.random() * 30000),
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      domain: 'web_app',
      status: 'completed',
    });
  }

  return candidates;
}

// =============================================================================
// Benchmark Building Logic
// =============================================================================

function buildBenchmarkCases(
  candidates: RunCandidate[],
  targetCount: number,
  seed: number
): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];

  // Sample up to targetCount candidates
  const sampled = candidates.slice(0, targetCount);

  for (let i = 0; i < sampled.length; i++) {
    const candidate = sampled[i];
    const caseId = generateCaseId(candidate.run_id, i);
    const split = assignSplit(i, targetCount, seed);

    cases.push({
      case_id: caseId,
      source_run_id: candidate.run_id,
      frame_ids: candidate.frame_ids,
      split,
      domain: candidate.domain,
      description: candidate.title,
      created_at: new Date().toISOString(),
      duration_ms: candidate.duration_ms,
      keyframe_count: candidate.keyframe_count,
    });
  }

  return cases;
}

function createManifest(cases: BenchmarkCase[], seed: number): BenchmarkManifest {
  const calibrationCases = cases.filter(c => c.split === 'calibration');
  const holdoutCases = cases.filter(c => c.split === 'holdout');

  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    total_cases: cases.length,
    calibration_count: calibrationCases.length,
    holdout_count: holdoutCases.length,
    cases,
    split_seed: seed,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('FlowSense Benchmark Builder - V3 Accuracy Upgrade');
  console.log('='.repeat(60));
  console.log();
  console.log('Configuration:');
  console.log(`  Target cases: ${config.targetCount}`);
  console.log(`  Domain: ${config.domain}`);
  console.log(`  Min keyframes: ${config.minKeyframes}`);
  console.log(`  Split seed: ${config.seed}`);
  console.log(`  Output: ${config.outputPath}`);
  console.log(`  Dry run: ${config.dryRun}`);
  console.log(`  Allow mock: ${config.allowMock}`);
  console.log();

  // Fetch candidates
  console.log('[1/4] Fetching run candidates...');
  const candidates = await fetchRunCandidates(
    config.domain,
    config.minKeyframes,
    config.targetCount * 2, // Fetch extra in case some are filtered
    config.allowMock
  );
  console.log(`  Found ${candidates.length} candidates`);

  if (candidates.length < config.targetCount) {
    console.warn(`  Warning: Only ${candidates.length} candidates available (target: ${config.targetCount})`);
  }

  // Build benchmark cases
  console.log('[2/4] Building benchmark cases...');
  const cases = buildBenchmarkCases(candidates, config.targetCount, config.seed);
  console.log(`  Created ${cases.length} benchmark cases`);

  // Create manifest
  console.log('[3/4] Creating manifest...');
  const manifest = createManifest(cases, config.seed);

  // Validate manifest
  const validation = benchmarkManifestSchema.safeParse(manifest);
  if (!validation.success) {
    console.error('Manifest validation failed:');
    console.error(validation.error.issues);
    process.exit(1);
  }

  console.log(`  Calibration set: ${manifest.calibration_count} cases`);
  console.log(`  Holdout set: ${manifest.holdout_count} cases`);

  // Write output
  console.log('[4/4] Writing output...');
  if (config.dryRun) {
    console.log('  (Dry run - not writing files)');
    console.log();
    console.log('Preview of first 3 cases:');
    manifest.cases.slice(0, 3).forEach(c => {
      console.log(`  - ${c.case_id}: ${c.description} (${c.split}, ${c.keyframe_count} keyframes)`);
    });
  } else {
    const outputDir = path.dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(config.outputPath, JSON.stringify(manifest, null, 2));
    console.log(`  Wrote manifest to ${config.outputPath}`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Benchmark build complete!');
  console.log('='.repeat(60));

  // Print summary statistics
  console.log();
  console.log('Summary:');
  console.log(`  Total cases: ${manifest.total_cases}`);
  console.log(`  Calibration: ${manifest.calibration_count} (${((manifest.calibration_count / manifest.total_cases) * 100).toFixed(1)}%)`);
  console.log(`  Holdout: ${manifest.holdout_count} (${((manifest.holdout_count / manifest.total_cases) * 100).toFixed(1)}%)`);

  const avgKeyframes = cases.reduce((sum, c) => sum + c.keyframe_count, 0) / cases.length;
  const avgDuration = cases.reduce((sum, c) => sum + c.duration_ms, 0) / cases.length;
  console.log(`  Avg keyframes per case: ${avgKeyframes.toFixed(1)}`);
  console.log(`  Avg duration per case: ${(avgDuration / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
