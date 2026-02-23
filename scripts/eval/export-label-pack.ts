#!/usr/bin/env npx tsx
/**
 * Export Label Pack Script
 * V3 Accuracy Upgrade - Day 2: Label Protocol
 *
 * Generates JSON/CSV labeling packs for UX raters.
 *
 * Usage:
 *   npx tsx scripts/eval/export-label-pack.ts [options]
 *
 * Options:
 *   --manifest <path>   Path to benchmark manifest (default: ./benchmark/manifest.json)
 *   --output <dir>      Output directory for packs (default: ./benchmark/label-packs)
 *   --rater <id>        Rater ID to generate pack for (required)
 *   --split <split>     Only include cases from split (calibration|holdout|all)
 *   --format <format>   Output format: json, csv, or both (default: both)
 *   --include-urls      Include signed URLs for frames (requires Azure config)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  type BenchmarkManifest,
  type BenchmarkCase,
  type LabelPack,
  type BenchmarkSplit,
  benchmarkManifestSchema,
  RUBRIC_CATEGORIES,
} from '@interactive-flow/shared';

// =============================================================================
// Configuration
// =============================================================================

interface ExportConfig {
  manifestPath: string;
  outputDir: string;
  raterId: string;
  split: BenchmarkSplit | 'all';
  format: 'json' | 'csv' | 'both';
  includeUrls: boolean;
}

function parseArgs(): ExportConfig {
  const args = process.argv.slice(2);
  const config: ExportConfig = {
    manifestPath: './benchmark/manifest.json',
    outputDir: './benchmark/label-packs',
    raterId: '',
    split: 'all',
    format: 'both',
    includeUrls: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--manifest':
        config.manifestPath = args[++i];
        break;
      case '--output':
        config.outputDir = args[++i];
        break;
      case '--rater':
        config.raterId = args[++i];
        break;
      case '--split':
        config.split = args[++i] as BenchmarkSplit | 'all';
        break;
      case '--format':
        config.format = args[++i] as 'json' | 'csv' | 'both';
        break;
      case '--include-urls':
        config.includeUrls = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (!config.raterId) {
    console.error('Error: --rater is required');
    printHelp();
    process.exit(1);
  }

  return config;
}

function printHelp() {
  console.log(`
Export Label Pack Script - FlowSense V3 Accuracy Upgrade

Usage:
  npx tsx scripts/eval/export-label-pack.ts --rater <id> [options]

Options:
  --manifest <path>   Path to benchmark manifest (default: ./benchmark/manifest.json)
  --output <dir>      Output directory for packs (default: ./benchmark/label-packs)
  --rater <id>        Rater ID to generate pack for (required)
  --split <split>     Only include cases from split (calibration|holdout|all, default: all)
  --format <format>   Output format: json, csv, or both (default: both)
  --include-urls      Include signed URLs for frames (requires Azure config)
  --help              Show this help message

Examples:
  # Generate pack for rater "ux-reviewer-1"
  npx tsx scripts/eval/export-label-pack.ts --rater ux-reviewer-1

  # Generate CSV only for calibration set
  npx tsx scripts/eval/export-label-pack.ts --rater ux-reviewer-2 --split calibration --format csv
`);
}

// =============================================================================
// Label Pack Generation
// =============================================================================

function filterCases(cases: BenchmarkCase[], split: BenchmarkSplit | 'all'): BenchmarkCase[] {
  if (split === 'all') return cases;
  return cases.filter(c => c.split === split);
}

function createLabelPack(cases: BenchmarkCase[], raterId: string): LabelPack {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    assigned_rater_id: raterId,
    cases: cases.map(c => ({
      case_id: c.case_id,
      description: c.description,
      frame_urls: c.frame_ids.map(fid => `[Frame: ${fid}]`), // Placeholder URLs
      video_url: undefined,
    })),
  };
}

function generateJsonPack(pack: LabelPack): string {
  return JSON.stringify(pack, null, 2);
}

function generateCsvPack(cases: BenchmarkCase[]): string {
  const headers = [
    'case_id',
    'description',
    'keyframe_count',
    'duration_ms',
    'split',
    // Rubric score columns (to be filled by rater)
    'cat1_action_response',
    'cat2_feedback_status',
    'cat3_predictability',
    'cat4_flow_continuity',
    'cat5_error_handling',
    'cat6_microinteraction',
    'cat7_efficiency',
    // Issue tags and notes
    'issue_tags',
    'quality_gate_status',
    'rater_notes',
  ];

  const rows = cases.map(c => [
    c.case_id,
    `"${c.description.replace(/"/g, '""')}"`,
    c.keyframe_count,
    c.duration_ms,
    c.split,
    '', // cat1
    '', // cat2
    '', // cat3
    '', // cat4
    '', // cat5
    '', // cat6
    '', // cat7
    '', // issue_tags
    '', // quality_gate_status
    '', // rater_notes
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

function generateLabelingInstructions(): string {
  return `
# FlowSense Benchmark Labeling Instructions

## Overview
You are rating the UX interaction quality of recorded task flows.
For each case, watch the recording and score across 7 categories.

## Scoring Rubric

Each category is scored 0, 1, or 2:
- **0 (Poor)**: Significant issues present
- **1 (Fair)**: Minor issues or room for improvement
- **2 (Good)**: Meets best practices

### Categories

1. **Action → Response Integrity (cat1)**
   - Does every click/action produce immediate visual feedback?
   - Look for: button press states, loading indicators, confirmations

2. **Feedback & System Status Visibility (cat2)**
   - Is the system state always clear?
   - Look for: spinners, progress bars, disabled state styling

3. **Interaction Predictability & Affordance (cat3)**
   - Do interactive elements look interactive?
   - Look for: clear button styling, hover states, cursor changes

4. **Flow Continuity & Friction (cat4)**
   - Is the task flow smooth without unnecessary steps?
   - Look for: backtracking, repeated actions, context loss

5. **Error Handling & Recovery (cat5)**
   - Are errors clearly shown with recovery paths?
   - Look for: error messages, inline validation, fix suggestions

6. **Micro-interaction Quality (cat6)**
   - Are transitions smooth and focus clear?
   - Look for: animations, focus management, visual polish

7. **Efficiency & Interaction Cost (cat7)**
   - Is the task achievable with minimal effort?
   - Look for: number of clicks, smart defaults, shortcuts

## Issue Tags

Select all that apply from this list:
- dead_click, delayed_response, ambiguous_response
- missing_spinner, unclear_disabled_state, no_progress_feedback
- misleading_affordance, surprise_navigation, mode_switch_surprise
- backtracking, repeated_actions, context_loss
- silent_error, blocking_error, recovery_unclear
- jarring_transition, distracting_animation, focus_confusion
- too_many_steps, over_clicking, excessive_cursor_travel, redundant_confirmations

## Quality Gate Status

Based on your scores, assign one of:
- **pass**: Score >= 80, no critical issues
- **warn**: Score 65-79 or minor issues
- **block**: Score < 65 or critical issues present

## Tips

1. Watch the entire recording before scoring
2. Be specific in your notes about what you observed
3. Use the issue tags to highlight specific problems
4. If unsure between two scores, choose the lower one
5. Note the timestamp when you observe issues

Thank you for contributing to FlowSense accuracy!
`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('FlowSense Label Pack Exporter - V3 Accuracy Upgrade');
  console.log('='.repeat(60));
  console.log();
  console.log('Configuration:');
  console.log(`  Manifest: ${config.manifestPath}`);
  console.log(`  Output dir: ${config.outputDir}`);
  console.log(`  Rater ID: ${config.raterId}`);
  console.log(`  Split filter: ${config.split}`);
  console.log(`  Format: ${config.format}`);
  console.log();

  // Load manifest
  console.log('[1/4] Loading benchmark manifest...');
  if (!fs.existsSync(config.manifestPath)) {
    console.error(`Error: Manifest not found at ${config.manifestPath}`);
    console.error('Run build-benchmark.ts first to create the manifest.');
    process.exit(1);
  }

  const manifestData = JSON.parse(fs.readFileSync(config.manifestPath, 'utf-8'));
  const validation = benchmarkManifestSchema.safeParse(manifestData);
  if (!validation.success) {
    console.error('Manifest validation failed:', validation.error.issues);
    process.exit(1);
  }

  const manifest: BenchmarkManifest = validation.data;
  console.log(`  Loaded ${manifest.total_cases} cases`);

  // Filter cases
  console.log('[2/4] Filtering cases...');
  const filteredCases = filterCases(manifest.cases, config.split);
  console.log(`  Selected ${filteredCases.length} cases for ${config.split} split`);

  // Create output directory
  console.log('[3/4] Creating output directory...');
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  // Generate and write packs
  console.log('[4/4] Generating label packs...');

  const raterDir = path.join(config.outputDir, config.raterId);
  if (!fs.existsSync(raterDir)) {
    fs.mkdirSync(raterDir, { recursive: true });
  }

  // Write instructions
  const instructionsPath = path.join(raterDir, 'INSTRUCTIONS.md');
  fs.writeFileSync(instructionsPath, generateLabelingInstructions());
  console.log(`  Wrote instructions to ${instructionsPath}`);

  // Write JSON pack
  if (config.format === 'json' || config.format === 'both') {
    const pack = createLabelPack(filteredCases, config.raterId);
    const jsonPath = path.join(raterDir, 'label-pack.json');
    fs.writeFileSync(jsonPath, generateJsonPack(pack));
    console.log(`  Wrote JSON pack to ${jsonPath}`);
  }

  // Write CSV pack
  if (config.format === 'csv' || config.format === 'both') {
    const csvPath = path.join(raterDir, 'label-pack.csv');
    fs.writeFileSync(csvPath, generateCsvPack(filteredCases));
    console.log(`  Wrote CSV pack to ${csvPath}`);
  }

  // Write label template (empty JSON for responses)
  const templatePath = path.join(raterDir, 'labels-template.json');
  const labelTemplate = {
    version: '1.0.0',
    rater_id: config.raterId,
    labels: filteredCases.map(c => ({
      case_id: c.case_id,
      rubric_scores: { cat1: null, cat2: null, cat3: null, cat4: null, cat5: null, cat6: null, cat7: null },
      issue_tags: [],
      quality_gate_status: null,
      rater_notes: '',
      labeled_at: null,
    })),
  };
  fs.writeFileSync(templatePath, JSON.stringify(labelTemplate, null, 2));
  console.log(`  Wrote label template to ${templatePath}`);

  console.log();
  console.log('='.repeat(60));
  console.log('Label pack export complete!');
  console.log('='.repeat(60));
  console.log();
  console.log('Next steps:');
  console.log(`  1. Share ${raterDir} with rater ${config.raterId}`);
  console.log(`  2. Rater reviews INSTRUCTIONS.md`);
  console.log(`  3. Rater fills in label-pack.csv or labels-template.json`);
  console.log(`  4. Collect completed labels for scoring`);
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
