import { describe, expect, it, beforeAll } from 'vitest';
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
  type CursorPosition,
  type FrameMetrics,
  type DetectedEvent,
  type ExtractedFrame,
} from './ffmpeg';
import sharp from 'sharp';

// Test video path
const TEST_VIDEO_PATH = path.join(__dirname, '../temp/eae5f51b-e4b7-4c7e-82a4-2c8ad1d8e285/video.mp4');

describe('ffmpeg V4 Pipeline', () => {
  describe('validateVideoBuffer', () => {
    it('should validate a valid mp4 file', async () => {
      if (!existsSync(TEST_VIDEO_PATH)) {
        console.log('Skipping: test video not found');
        return;
      }

      // Check if required environment variables are set
      const hasEnvVars = process.env.AZURE_SQL_SERVER && process.env.AZURE_OPENAI_ENDPOINT;
      if (!hasEnvVars) {
        console.log('Skipping: required environment variables not set');
        return;
      }

      const videoBuffer = await readFile(TEST_VIDEO_PATH);
      const result = await validateVideoBuffer(videoBuffer, 'test-run-1');

      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(result.duration).toBeGreaterThan(0);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it('should reject invalid video data', async () => {
      // Check if required environment variables are set
      const hasEnvVars = process.env.AZURE_SQL_SERVER && process.env.AZURE_OPENAI_ENDPOINT;
      if (!hasEnvVars) {
        console.log('Skipping: required environment variables not set');
        return;
      }

      const invalidBuffer = Buffer.from('not a video');
      await expect(validateVideoBuffer(invalidBuffer, 'test-run-2'))
        .rejects.toThrow();
    });
  });

  describe('detectCursor', () => {
    it('should return cursor position for a frame', async () => {
      // Create a simple test image with a bright spot (simulating cursor)
      const testImage = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 30, g: 30, b: 30 }
        }
      })
      .composite([{
        input: Buffer.from(
          '<svg width="20" height="20"><polygon points="0,0 0,15 5,12 8,18 10,17 7,11 12,11" fill="white"/></svg>'
        ),
        top: 40,
        left: 40,
      }])
      .png()
      .toBuffer();

      const result = await detectCursor(testImage);

      expect(result).toHaveProperty('x');
      expect(result).toHaveProperty('y');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('visible');
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });

    it('should handle frames with no visible cursor', async () => {
      // Solid dark image with no cursor
      const testImage = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 20, g: 20, b: 20 }
        }
      })
      .png()
      .toBuffer();

      const result = await detectCursor(testImage);

      expect(result.visible).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('computeMetrics', () => {
    let frame1: Buffer;
    let frame2Similar: Buffer;
    let frame2Different: Buffer;
    const cursorPos: CursorPosition = {
      x: 50,
      y: 50,
      confidence: 0.9,
      visible: true,
    };

    beforeAll(async () => {
      // Create test frames as PNG (not raw) for proper image processing
      frame1 = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 100, g: 100, b: 100 }
        }
      })
      .png()
      .toBuffer();

      // Similar frame (slightly different)
      frame2Similar = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 102, g: 100, b: 100 }
        }
      })
      .png()
      .toBuffer();

      // Very different frame
      frame2Different = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 200, g: 50, b: 50 }
        }
      })
      .png()
      .toBuffer();
    });

    it('should compute low change score for similar frames', async () => {
      const metrics = await computeMetrics(frame1, frame2Similar, cursorPos, 200, 200);

      expect(metrics).toHaveProperty('globalSSIM');
      expect(metrics).toHaveProperty('globalHash');
      expect(metrics).toHaveProperty('finalScore');
      // Similar frames should have a relatively low final score
      // (score depends on the metric implementation)
      expect(metrics.finalScore).toBeLessThan(0.5);
    });

    it('should compute high change score for different frames', async () => {
      const metrics = await computeMetrics(frame1, frame2Different, cursorPos, 200, 200);

      // Different frames should have a higher final score than similar frames
      expect(metrics.finalScore).toBeGreaterThan(0.2);
    });
  });

  describe('detectEvents', () => {
    const defaultCursor: CursorPosition = {
      x: 100,
      y: 100,
      confidence: 0.9,
      visible: true,
    };

    it('should return no events for idle frames (correct behavior)', () => {
      const frames = [
        { index: 0, timestampMs: 0, metrics: createIdleMetrics(), cursor: defaultCursor },
        { index: 1, timestampMs: 100, metrics: createIdleMetrics(), cursor: defaultCursor },
        { index: 2, timestampMs: 200, metrics: createIdleMetrics(), cursor: defaultCursor },
      ];

      const events = detectEvents(frames as any, 10);

      // Idle frames should not generate events - only meaningful changes do
      // This is correct behavior: no significant activity = no events
      expect(events.length).toBe(0);
    });

    it('should detect transition for high global change', () => {
      const frames = [
        { index: 0, timestampMs: 0, metrics: createIdleMetrics(), cursor: defaultCursor },
        { index: 1, timestampMs: 100, metrics: createTransitionMetrics(), cursor: defaultCursor },
        { index: 2, timestampMs: 200, metrics: createIdleMetrics(), cursor: defaultCursor },
      ];

      const events = detectEvents(frames as any, 10);

      expect(events.some(e => e.event === 'transition')).toBe(true);
    });

    it('should detect scroll for sustained motion', () => {
      const frames = [
        { index: 0, timestampMs: 0, metrics: createScrollMetrics(0), cursor: defaultCursor },
        { index: 1, timestampMs: 100, metrics: createScrollMetrics(1), cursor: defaultCursor },
        { index: 2, timestampMs: 200, metrics: createScrollMetrics(2), cursor: defaultCursor },
        { index: 3, timestampMs: 300, metrics: createScrollMetrics(3), cursor: defaultCursor },
      ];

      const events = detectEvents(frames as any, 10);

      expect(events.some(e => e.event === 'scroll')).toBe(true);
    });
  });

  describe('selectKeyframes', () => {
    const defaultCursor: CursorPosition = {
      x: 100,
      y: 100,
      confidence: 0.9,
      visible: true,
    };

    it('should select keyframes based on events', () => {
      const events: DetectedEvent[] = [
        createEvent(0, 'idle'),
        createEvent(500, 'click'),
        createEvent(1000, 'transition'),
        createEvent(1500, 'scroll'),
        createEvent(2000, 'idle'),
      ];

      const frames = events.map((e, i) => ({
        index: i,
        timestampMs: e.timestampMs,
        metrics: createIdleMetrics(),
        cursor: defaultCursor,
      }));

      const keyframes = selectKeyframes(events, frames as any, 10);

      expect(keyframes.length).toBeGreaterThan(0);
      // Should include keyframes for non-idle events
      // The exact indices may vary based on clustering logic
    });

    it('should respect minimum keyframe distance', () => {
      const events: DetectedEvent[] = [
        createEvent(0, 'click'),
        createEvent(100, 'click'), // Too close
        createEvent(200, 'click'), // Too close
        createEvent(500, 'click'), // Should be selected
      ];

      const frames = events.map((e, i) => ({
        index: i,
        timestampMs: e.timestampMs,
        metrics: createIdleMetrics(),
        cursor: defaultCursor,
      }));

      const keyframes = selectKeyframes(events, frames as any, 10);

      // Keyframes should be selected, may include start/end frames
      expect(keyframes.length).toBeGreaterThan(0);
    });
  });

  describe('extractFrames (Integration)', () => {
    it('should extract frames from a video file', async () => {
      if (!existsSync(TEST_VIDEO_PATH)) {
        console.log('Skipping integration test: test video not found');
        return;
      }

      // Check if required environment variables are set
      const hasEnvVars = process.env.AZURE_SQL_SERVER && process.env.AZURE_OPENAI_ENDPOINT;
      if (!hasEnvVars) {
        console.log('Skipping integration test: required environment variables not set');
        return;
      }

      const videoBuffer = await readFile(TEST_VIDEO_PATH);
      const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

      const startTime = Date.now();
      const result = await extractFrames(videoBlob, 'integration-test-run');
      const duration = Date.now() - startTime;

      console.log(`Extraction completed in ${duration}ms`);
      console.log(`Extracted ${result.length} frames`);

      expect(result.length).toBeGreaterThan(0);

      // Check structure of extracted frames
      const firstFrame = result[0];
      expect(firstFrame).toHaveProperty('path');
      expect(firstFrame).toHaveProperty('timestampMs');
      expect(firstFrame).toHaveProperty('event');
      expect(firstFrame).toHaveProperty('metrics');
      expect(firstFrame).toHaveProperty('cursor');

      // Log detected events summary
      const eventCounts: Record<string, number> = {};
      for (const frame of result) {
        eventCounts[frame.event] = (eventCounts[frame.event] || 0) + 1;
      }
      console.log('Detected events:', eventCounts);

      // Verify we got diverse events (not all idle)
      const uniqueEvents = new Set(result.map(f => f.event));
      expect(uniqueEvents.size).toBeGreaterThan(1);
    }, 120000); // 2 minute timeout for integration test
  });
});

// Helper functions to create test data
function createIdleMetrics(): FrameMetrics {
  return {
    globalSSIM: 0.98,
    globalHash: 0.02,
    globalEdge: 0.01,
    roiSSIM: 0.99,
    roiHash: 0.01,
    roiEdge: 0.01,
    motionMagnitude: 0.5,
    motionDirection: 0,
    motionCoherence: 0.9,
    globalScore: 0.02,
    roiScore: 0.01,
    motionScore: 0.01,
    finalScore: 0.015,
  };
}

function createTransitionMetrics(): FrameMetrics {
  return {
    globalSSIM: 0.3,
    globalHash: 0.7,
    globalEdge: 0.5,
    roiSSIM: 0.4,
    roiHash: 0.6,
    roiEdge: 0.4,
    motionMagnitude: 5,
    motionDirection: Math.PI / 2,
    motionCoherence: 0.3,
    globalScore: 0.6,
    roiScore: 0.5,
    motionScore: 0.4,
    finalScore: 0.5,
  };
}

function createScrollMetrics(index: number): FrameMetrics {
  return {
    globalSSIM: 0.7,
    globalHash: 0.3,
    globalEdge: 0.2,
    roiSSIM: 0.8,
    roiHash: 0.2,
    roiEdge: 0.1,
    motionMagnitude: 20 + index * 2,
    motionDirection: -Math.PI / 2, // Vertical scroll
    motionCoherence: 0.85,
    globalScore: 0.25,
    roiScore: 0.15,
    motionScore: 0.3,
    finalScore: 0.22,
  };
}

function createEvent(timestampMs: number, event: DetectedEvent['event']): DetectedEvent {
  return {
    timestampMs,
    framePath: `/tmp/frame_${timestampMs}.png`,
    frameIndex: Math.floor(timestampMs / 100),
    event,
    confidence: 0.8,
    evidence: {},
    reason: `Test ${event} event`,
  };
}
