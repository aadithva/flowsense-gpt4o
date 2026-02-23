#!/usr/bin/env node
/**
 * Benchmark CLI
 * V3 Accuracy Upgrade - Day 9: Validation + Benchmark Execution
 *
 * CLI tool for running benchmark evaluations on V2 and V3 engines.
 *
 * Usage:
 *   npm run benchmark -- --engine v3_hybrid --split calibration
 *   npm run benchmark -- --engine v3_hybrid --split holdout --baseline v2_baseline
 *   npm run benchmark -- --calibrate --engine v3_hybrid
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { downloadBlob } from './azure-storage';
import {
  runBenchmark,
  runCalibrationAndHoldout,
  type BenchmarkCaseData,
  type BenchmarkFrameData,
} from './benchmark-runner';
import {
  type BenchmarkManifest,
  type AdjudicatedLabel,
  type BenchmarkSplit,
  type AnalysisEngineVersion,
  ANALYSIS_ENGINE_VERSIONS,
  benchmarkManifestSchema,
  adjudicatedLabelSchema,
} from '@interactive-flow/shared';

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliOptions {
  engine: AnalysisEngineVersion;
  baseline?: AnalysisEngineVersion;
  split: BenchmarkSplit;
  manifestPath: string;
  labelsPath: string;
  outputDir: string;
  maxCases?: number;
  calibrate: boolean;
  help: boolean;
}

function printUsage() {
  console.log(`
Benchmark CLI - FlowSense V3 Accuracy Upgrade

USAGE:
  npm run benchmark -- [options]

OPTIONS:
  --engine <version>      Engine version to evaluate (required)
                          Values: v2_baseline, v3_hybrid
  --baseline <version>    Baseline engine for comparison (optional)
  --split <split>         Benchmark split to run (default: calibration)
                          Values: calibration, holdout
  --manifest <path>       Path to benchmark manifest JSON (default: ./benchmark/manifest.json)
  --labels <path>         Path to adjudicated labels JSON (default: ./benchmark/labels.json)
  --output <dir>          Output directory for reports (default: ./benchmark/reports)
  --max-cases <n>         Maximum cases to process (for testing)
  --calibrate             Run full calibration + holdout workflow
  --help                  Show this help message

EXAMPLES:
  # Run V3 on calibration set
  npm run benchmark -- --engine v3_hybrid --split calibration

  # Run V3 with V2 baseline comparison on holdout set
  npm run benchmark -- --engine v3_hybrid --baseline v2_baseline --split holdout

  # Run full calibration workflow (calibration set → threshold tuning → holdout set)
  npm run benchmark -- --calibrate --engine v3_hybrid --baseline v2_baseline

  # Quick test with limited cases
  npm run benchmark -- --engine v3_hybrid --max-cases 5
`);
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      engine: { type: 'string', short: 'e' },
      baseline: { type: 'string', short: 'b' },
      split: { type: 'string', short: 's', default: 'calibration' },
      manifest: { type: 'string', short: 'm', default: './benchmark/manifest.json' },
      labels: { type: 'string', short: 'l', default: './benchmark/labels.json' },
      output: { type: 'string', short: 'o', default: './benchmark/reports' },
      'max-cases': { type: 'string' },
      calibrate: { type: 'boolean', short: 'c', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    return {
      engine: ANALYSIS_ENGINE_VERSIONS.V3_HYBRID,
      split: 'calibration',
      manifestPath: '',
      labelsPath: '',
      outputDir: '',
      calibrate: false,
      help: true,
    };
  }

  if (!values.engine) {
    console.error('Error: --engine is required');
    printUsage();
    process.exit(1);
  }

  const validEngines = Object.values(ANALYSIS_ENGINE_VERSIONS);
  if (!validEngines.includes(values.engine as AnalysisEngineVersion)) {
    console.error(`Error: Invalid engine "${values.engine}". Valid values: ${validEngines.join(', ')}`);
    process.exit(1);
  }

  if (values.baseline && !validEngines.includes(values.baseline as AnalysisEngineVersion)) {
    console.error(`Error: Invalid baseline "${values.baseline}". Valid values: ${validEngines.join(', ')}`);
    process.exit(1);
  }

  const validSplits = ['calibration', 'holdout'];
  if (!validSplits.includes(values.split as string)) {
    console.error(`Error: Invalid split "${values.split}". Valid values: ${validSplits.join(', ')}`);
    process.exit(1);
  }

  return {
    engine: values.engine as AnalysisEngineVersion,
    baseline: values.baseline as AnalysisEngineVersion | undefined,
    split: values.split as BenchmarkSplit,
    manifestPath: values.manifest as string,
    labelsPath: values.labels as string,
    outputDir: values.output as string,
    maxCases: values['max-cases'] ? parseInt(values['max-cases'] as string, 10) : undefined,
    calibrate: values.calibrate as boolean,
    help: false,
  };
}

// =============================================================================
// Data Loading
// =============================================================================

async function loadManifest(manifestPath: string): Promise<BenchmarkManifest> {
  console.log(`Loading manifest from: ${manifestPath}`);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(content);
  const validated = benchmarkManifestSchema.parse(parsed);

  console.log(`  Loaded ${validated.total_cases} cases (${validated.calibration_count} calibration, ${validated.holdout_count} holdout)`);

  return validated as BenchmarkManifest;
}

async function loadLabels(labelsPath: string): Promise<AdjudicatedLabel[]> {
  console.log(`Loading labels from: ${labelsPath}`);

  if (!fs.existsSync(labelsPath)) {
    throw new Error(`Labels file not found: ${labelsPath}`);
  }

  const content = fs.readFileSync(labelsPath, 'utf-8');
  const parsed = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error('Labels file must contain an array');
  }

  const labels: AdjudicatedLabel[] = [];
  for (const item of parsed) {
    const validated = adjudicatedLabelSchema.parse(item);
    labels.push(validated as AdjudicatedLabel);
  }

  console.log(`  Loaded ${labels.length} adjudicated labels`);

  return labels;
}

/**
 * Create a case data loader that fetches frame data from Azure Storage
 */
function createCaseDataLoader(manifest: BenchmarkManifest): (caseId: string) => Promise<BenchmarkCaseData> {
  const caseMap = new Map(manifest.cases.map(c => [c.case_id, c]));

  return async (caseId: string): Promise<BenchmarkCaseData> => {
    const benchmarkCase = caseMap.get(caseId);
    if (!benchmarkCase) {
      throw new Error(`Case not found: ${caseId}`);
    }

    const frames: BenchmarkFrameData[] = [];

    // Load frames from storage
    // Assumes frame storage paths follow pattern: benchmark/{case_id}/frames/{frame_id}.jpg
    for (let i = 0; i < benchmarkCase.frame_ids.length; i++) {
      const frameId = benchmarkCase.frame_ids[i];
      const storagePath = `benchmark/${caseId}/frames/${frameId}.jpg`;

      try {
        const buffer = await downloadBlob(storagePath);
        frames.push({
          frameId,
          buffer,
          timestampMs: i * 100, // Estimated timestamps (100ms apart)
          isKeyframe: true, // Treat all benchmark frames as keyframes
          storagePath,
        });
      } catch (error) {
        console.warn(`  Warning: Could not load frame ${frameId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (frames.length === 0) {
      throw new Error(`No frames loaded for case ${caseId}`);
    }

    return {
      case: benchmarkCase,
      frames,
    };
  };
}

/**
 * Create a mock case data loader for testing without Azure Storage
 */
function createMockCaseDataLoader(manifest: BenchmarkManifest): (caseId: string) => Promise<BenchmarkCaseData> {
  const caseMap = new Map(manifest.cases.map(c => [c.case_id, c]));

  return async (caseId: string): Promise<BenchmarkCaseData> => {
    const benchmarkCase = caseMap.get(caseId);
    if (!benchmarkCase) {
      throw new Error(`Case not found: ${caseId}`);
    }

    // Generate mock frames (1x1 pixel black JPEG for testing)
    const mockJpegBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
      0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
      0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
      0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
      0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
      0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
      0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
      0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
      0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
      0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
      0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
      0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
      0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
      0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
      0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
      0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
      0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xff, 0xd9,
    ]);

    const frames: BenchmarkFrameData[] = [];
    for (let i = 0; i < benchmarkCase.frame_ids.length; i++) {
      const frameId = benchmarkCase.frame_ids[i];
      frames.push({
        frameId,
        buffer: mockJpegBuffer,
        timestampMs: i * 100,
        isKeyframe: true,
        storagePath: `benchmark/${caseId}/frames/${frameId}.jpg`,
      });
    }

    return {
      case: benchmarkCase,
      frames,
    };
  };
}

// =============================================================================
// Report Output
// =============================================================================

function saveReport(outputDir: string, filename: string, content: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`Report saved: ${outputPath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const options = parseCliArgs();

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         FlowSense Benchmark Evaluation CLI                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Load data
    const manifest = await loadManifest(options.manifestPath);
    const labels = await loadLabels(options.labelsPath);

    // Create case data loader
    // Try Azure Storage first, fall back to mock for testing
    let caseDataLoader: (caseId: string) => Promise<BenchmarkCaseData>;
    try {
      // Test Azure connection
      caseDataLoader = createCaseDataLoader(manifest);
      console.log('Using Azure Storage for frame data');
    } catch {
      console.log('Azure Storage not available, using mock data loader');
      caseDataLoader = createMockCaseDataLoader(manifest);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (options.calibrate) {
      // Full calibration workflow
      console.log('');
      console.log('Running full calibration + holdout workflow...');
      console.log('');

      const result = await runCalibrationAndHoldout(
        manifest,
        caseDataLoader,
        labels,
        options.engine,
        options.baseline,
        (phase, current, total) => {
          process.stdout.write(`\r  [${phase}] Processing case ${current}/${total}...`);
        }
      );

      // Save reports
      saveReport(
        options.outputDir,
        `calibration-report-${options.engine}-${timestamp}.txt`,
        formatCalibrationReport(result.calibrationReport)
      );

      saveReport(
        options.outputDir,
        `holdout-report-${options.engine}-${timestamp}.txt`,
        result.finalReportText
      );

      saveReport(
        options.outputDir,
        `calibration-report-${options.engine}-${timestamp}.json`,
        JSON.stringify(result.calibrationReport, null, 2)
      );

      saveReport(
        options.outputDir,
        `holdout-report-${options.engine}-${timestamp}.json`,
        JSON.stringify(result.holdoutReport, null, 2)
      );

      saveReport(
        options.outputDir,
        `calibrated-thresholds-${timestamp}.json`,
        JSON.stringify(result.calibratedThresholds, null, 2)
      );

      // Print final results
      console.log('');
      console.log(result.finalReportText);

    } else {
      // Single split benchmark
      const result = await runBenchmark(manifest, caseDataLoader, labels, {
        engineVersion: options.engine,
        baselineEngine: options.baseline,
        split: options.split,
        maxCases: options.maxCases,
        runBaseline: !!options.baseline,
        onProgress: (current, total, caseId) => {
          process.stdout.write(`\rProcessing case ${current}/${total}: ${caseId}...`);
        },
      });

      // Save reports
      saveReport(
        options.outputDir,
        `benchmark-report-${options.engine}-${options.split}-${timestamp}.txt`,
        result.reportText
      );

      saveReport(
        options.outputDir,
        `benchmark-report-${options.engine}-${options.split}-${timestamp}.json`,
        JSON.stringify(result.report, null, 2)
      );

      saveReport(
        options.outputDir,
        `predictions-${options.engine}-${options.split}-${timestamp}.json`,
        JSON.stringify(result.predictions, null, 2)
      );

      if (result.baselineReport) {
        saveReport(
          options.outputDir,
          `benchmark-report-${options.baseline}-${options.split}-${timestamp}.json`,
          JSON.stringify(result.baselineReport, null, 2)
        );
      }

      // Print final results
      console.log('');
      console.log(result.reportText);
    }

    console.log('');
    console.log('Benchmark evaluation complete!');
    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('Benchmark evaluation failed:');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function formatCalibrationReport(report: any): string {
  const lines: string[] = [];
  lines.push('CALIBRATION SET REPORT');
  lines.push('═'.repeat(40));
  lines.push(`Mean QWK: ${report.mean_quadratic_weighted_kappa.toFixed(4)}`);
  lines.push(`Macro F1: ${report.issue_tag_metrics.macro_f1.toFixed(4)}`);
  lines.push(`Gate Accuracy: ${(report.gate_metrics.gate_accuracy * 100).toFixed(2)}%`);
  lines.push(`False Block Rate: ${(report.gate_metrics.false_block_rate * 100).toFixed(2)}%`);
  return lines.join('\n');
}

main();
