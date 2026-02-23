/**
 * Manual test script for the V4 frame extraction pipeline.
 * Run with: npx tsx src/test-extraction.ts
 */

import 'dotenv/config';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  validateVideoBuffer,
  detectCursor,
  computeMetrics,
  detectEvents,
  selectKeyframes,
  extractFrames,
} from './ffmpeg';

const TEST_VIDEO_PATH = path.join(__dirname, '../temp/eae5f51b-e4b7-4c7e-82a4-2c8ad1d8e285/video.mp4');

async function main() {
  console.log('=== V4 Frame Extraction Pipeline Test ===\n');

  // Check if test video exists
  if (!existsSync(TEST_VIDEO_PATH)) {
    console.error('Test video not found at:', TEST_VIDEO_PATH);
    console.log('\nLooking for other videos...');

    // Try to find any video in temp
    const { execSync } = require('child_process');
    try {
      const videos = execSync('find ../temp -name "*.mp4" -o -name "*.mov" -o -name "*.webm" 2>/dev/null', {
        cwd: __dirname,
        encoding: 'utf-8'
      });
      if (videos.trim()) {
        console.log('Found videos:\n', videos);
      } else {
        console.log('No videos found in temp directory');
      }
    } catch {
      console.log('Could not search for videos');
    }
    return;
  }

  const stats = await stat(TEST_VIDEO_PATH);
  console.log(`Test video: ${TEST_VIDEO_PATH}`);
  console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`);

  // Step 1: Validate video
  console.log('1. Validating video...');
  const videoBuffer = await readFile(TEST_VIDEO_PATH);

  try {
    const validation = await validateVideoBuffer(videoBuffer, 'test-run');
    console.log('   ✓ Valid video');
    console.log(`   Duration: ${validation.duration.toFixed(2)}s`);
    console.log(`   Resolution: ${validation.width}x${validation.height}`);
    console.log(`   Format: ${validation.formatName}\n`);
  } catch (err) {
    console.error('   ✗ Validation failed:', err);
    return;
  }

  // Step 2: Extract frames
  console.log('2. Extracting frames with V4 pipeline...');
  const startTime = Date.now();

  try {
    const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });
    const frames = await extractFrames(videoBlob, `test-${Date.now()}`);
    const duration = (Date.now() - startTime) / 1000;

    console.log(`   ✓ Extraction complete in ${duration.toFixed(2)}s`);
    console.log(`   Total keyframes: ${frames.length}\n`);

    // Analyze results
    console.log('3. Analysis of extracted frames:');

    // Event distribution (event is a DetectedEvent object with .event property)
    const eventCounts: Record<string, number> = {};
    for (const frame of frames) {
      const eventType = frame.event?.event || 'no_event';
      eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
    }

    console.log('   Event distribution:');
    for (const [event, count] of Object.entries(eventCounts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / frames.length) * 100).toFixed(1);
      console.log(`     - ${event}: ${count} (${pct}%)`);
    }

    // Cursor visibility
    const cursorVisible = frames.filter(f => f.cursor?.visible).length;
    console.log(`\n   Cursor detected: ${cursorVisible}/${frames.length} frames`);

    // Sample some frames
    console.log('\n   Sample frames (first 5):');
    for (let i = 0; i < Math.min(5, frames.length); i++) {
      const f = frames[i];
      const eventType = f.event?.event || 'no_event';
      console.log(`     [${i}] t=${f.timestampMs}ms, event=${eventType}, score=${f.metrics?.finalScore?.toFixed(3) || 'N/A'}`);
    }

    // Average metrics
    const avgMetrics = frames.reduce((acc, f) => {
      if (f.metrics) {
        acc.ssim += f.metrics.globalSSIM;
        acc.motion += f.metrics.motionMagnitude;
        acc.final += f.metrics.finalScore;
        acc.count++;
      }
      return acc;
    }, { ssim: 0, motion: 0, final: 0, count: 0 });

    if (avgMetrics.count > 0) {
      console.log('\n   Average metrics:');
      console.log(`     - Global SSIM: ${(avgMetrics.ssim / avgMetrics.count).toFixed(3)}`);
      console.log(`     - Motion magnitude: ${(avgMetrics.motion / avgMetrics.count).toFixed(2)}`);
      console.log(`     - Final score: ${(avgMetrics.final / avgMetrics.count).toFixed(3)}`);
    }

    console.log('\n=== Test Complete ===');

  } catch (err) {
    console.error('   ✗ Extraction failed:', err);
  }
}

main().catch(console.error);
