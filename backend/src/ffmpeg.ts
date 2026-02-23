/**
 * Frame Extraction & Event Detection Pipeline (V4)
 *
 * Two-pass extraction with cursor tracking, multi-signal metrics,
 * and intelligent event inference for high-accuracy keyframe selection.
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { writeFile, readFile, readdir, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  type FrameChangeContext,
  createEmptyChangeContext,
} from '@interactive-flow/shared';
import { getEnv, getPreprocessingConfig } from './env';

const execFileAsync = promisify(execFile);

// =============================================================================
// Configuration Constants
// =============================================================================

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_FORMAT_MARKERS = ['mov', 'mp4', 'matroska', 'webm'];

// Two-pass extraction config
const COARSE_FPS = 10;              // Pass 1: coarse scan
const FINE_FPS = 30;                // Pass 2: fine scan around candidates
const FINE_WINDOW_MS = 800;         // +/- ms around candidate for fine scan

// Cursor detection config
const CURSOR_ROI_RADIUS = 300;      // Pixels around cursor for ROI
const CURSOR_TEMPLATES = [          // Common cursor shapes (simplified detection)
  'arrow', 'pointer', 'text', 'wait'
];

// Metric weights for final score
const WEIGHT_ROI = 0.45;            // Cursor ROI weight (highest)
const WEIGHT_GLOBAL = 0.25;         // Global frame weight
const WEIGHT_MOTION = 0.20;         // Motion/flow weight
const WEIGHT_EDGE = 0.10;           // Edge change weight

// Event detection thresholds (tune these based on testing)
const THRESHOLDS = {
  hoverMinScore: 0.03,              // Min ROI change for hover
  hoverMaxCursorSpeed: 15,          // Max cursor speed (px/frame) for hover
  clickCursorJitter: 8,             // Cursor micro-movement during click
  clickResponseWindowMs: 200,       // Time window for click response
  scrollMinMotion: 0.15,            // Min motion score for scroll
  scrollDirectionRatio: 0.7,        // % of motion in same direction
  transitionMinGlobal: 0.35,        // Min global change for transition
  flickerFrameWindow: 3,            // Frames to check for flicker
  flickerToggleThreshold: 0.8,      // Similarity ratio for flicker detection
  jitterEdgeVariance: 0.02,         // Edge variance threshold for jitter
  minKeyframeDistanceMs: 300,       // Min time between keyframes
  eventClusterWindowMs: 500,        // Window to cluster events
  // Cursor on element detection (for capturing interaction-ready states)
  cursorOnElementMaxSpeed: 5,       // Max cursor speed (px/frame) for static positioning
  cursorOnElementMinEdge: 0.15,     // Min ROI edge density (high = UI element)
  cursorOnElementMaxChange: 0.05,   // Max overall change (cursor just sitting there)
};

// =============================================================================
// Types
// =============================================================================

export type EventType =
  | 'hover'
  | 'click'
  | 'scroll'
  | 'transition'
  | 'animation_anomaly'
  | 'state_change'
  | 'cursor_on_element'
  | 'idle';

export interface CursorPosition {
  x: number;
  y: number;
  confidence: number;
  shape?: 'arrow' | 'pointer' | 'text' | 'wait' | 'unknown';
  visible: boolean;
}

export interface FrameMetrics {
  // Global metrics (full frame)
  globalSSIM: number;           // 0-1, structural similarity
  globalHash: number;           // 0-1, perceptual hash delta
  globalEdge: number;           // 0-1, edge map difference

  // ROI metrics (cursor region)
  roiSSIM: number;
  roiHash: number;
  roiEdge: number;

  // Motion metrics
  motionMagnitude: number;      // Average optical flow magnitude
  motionDirection: number;      // Dominant direction (radians)
  motionCoherence: number;      // 0-1, how uniform is the motion

  // Composite scores
  globalScore: number;
  roiScore: number;
  motionScore: number;
  finalScore: number;
}

export interface DetectedEvent {
  timestampMs: number;
  framePath: string;
  frameIndex: number;
  event: EventType;
  confidence: number;
  evidence: {
    cursor?: CursorPosition;
    metrics?: Partial<FrameMetrics>;
    roi?: { x: number; y: number; width: number; height: number };
    details?: string[];
  };
  reason: string;
}

export interface ExtractedFrame {
  id: string;
  timestampMs: number;
  buffer: Buffer;
  isKeyframe: boolean;
  diffScore: number;
  changeContext?: FrameChangeContext;
  // V4 additions
  cursor?: CursorPosition;
  metrics?: FrameMetrics;
  event?: DetectedEvent;
}

interface FrameData {
  index: number;
  timestampMs: number;
  path: string;
  buffer: Buffer;
  cursor: CursorPosition;
  metrics?: FrameMetrics;
}

interface CandidateWindow {
  startMs: number;
  endMs: number;
  peakMs: number;
  reason: string;
  score: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

function getFfmpegPath(): string {
  return getEnv().FFMPEG_PATH || 'ffmpeg';
}

function getFfprobePath(): string {
  const configured = getEnv().FFMPEG_PATH;
  if (!configured) return 'ffprobe';
  return configured.replace(/ffmpeg$/, 'ffprobe');
}

// =============================================================================
// Video Validation
// =============================================================================

export async function validateVideoBuffer(videoBuffer: Buffer, runId: string) {
  if (videoBuffer.length <= 0) {
    throw new Error('Uploaded video is empty');
  }

  if (videoBuffer.length > MAX_VIDEO_BYTES) {
    throw new Error('Uploaded video exceeds maximum allowed size (500MB)');
  }

  const tempDir = path.join(process.cwd(), 'temp', runId, 'validation');
  const probePath = path.join(tempDir, 'video.bin');

  await mkdir(tempDir, { recursive: true });

  try {
    await writeFile(probePath, videoBuffer);

    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration,size',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      probePath,
    ]);

    const parsed = JSON.parse(stdout);
    const formatName = String(parsed?.format?.format_name || '').toLowerCase();

    if (!ALLOWED_VIDEO_FORMAT_MARKERS.some(marker => formatName.includes(marker))) {
      throw new Error(`Unsupported video format: ${formatName || 'unknown'}`);
    }

    const duration = Number(parsed?.format?.duration || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not determine video duration');
    }

    const stream = parsed?.streams?.[0];
    const width = Number(stream?.width || 1920);
    const height = Number(stream?.height || 1080);

    return { formatName, duration, sizeBytes: videoBuffer.length, width, height };
  } finally {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

// =============================================================================
// Cursor Detection
// =============================================================================

/**
 * Detect cursor position in a frame using edge-based template matching.
 * Returns position with confidence, or visible=false if not found.
 */
export async function detectCursor(frameBuffer: Buffer): Promise<CursorPosition> {
  try {
    // First get metadata to determine resize dimensions
    const metadata = await sharp(frameBuffer).metadata();
    const targetWidth = Math.min(metadata.width || 1920, 1920);

    const { data, info } = await sharp(frameBuffer)
      .resize(targetWidth, null, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    // Scan for cursor-like patterns (high contrast small regions)
    // Look for arrow/pointer shapes via edge density in small windows
    let bestX = -1, bestY = -1, bestScore = 0;

    const windowSize = 32;
    const step = 8;

    for (let y = 0; y < height - windowSize; y += step) {
      for (let x = 0; x < width - windowSize; x += step) {
        const edgeScore = computeLocalEdgeDensity(data, width, height, channels, x, y, windowSize);
        const contrastScore = computeLocalContrast(data, width, height, channels, x, y, windowSize);

        // Cursor typically has high edge density + high contrast in small area
        const score = edgeScore * 0.6 + contrastScore * 0.4;

        if (score > bestScore && score > 0.15) {
          bestScore = score;
          bestX = x + windowSize / 2;
          bestY = y + windowSize / 2;
        }
      }
    }

    if (bestScore > 0.15) {
      return {
        x: bestX,
        y: bestY,
        confidence: Math.min(bestScore * 2, 1),
        shape: 'unknown',
        visible: true,
      };
    }

    return { x: 0, y: 0, confidence: 0, visible: false };
  } catch (error) {
    console.warn('[Cursor] Detection failed:', error);
    return { x: 0, y: 0, confidence: 0, visible: false };
  }
}

function computeLocalEdgeDensity(
  data: Buffer, width: number, height: number, channels: number,
  startX: number, startY: number, size: number
): number {
  let edgeCount = 0;
  let total = 0;
  const threshold = 30;

  for (let y = startY; y < startY + size - 1 && y < height - 1; y++) {
    for (let x = startX; x < startX + size - 1 && x < width - 1; x++) {
      const idx = (y * width + x) * channels;
      const idxRight = (y * width + x + 1) * channels;
      const idxDown = ((y + 1) * width + x) * channels;

      const gx = Math.abs(data[idx] - data[idxRight]);
      const gy = Math.abs(data[idx] - data[idxDown]);
      const gradient = Math.sqrt(gx * gx + gy * gy);

      if (gradient > threshold) edgeCount++;
      total++;
    }
  }

  return total > 0 ? edgeCount / total : 0;
}

function computeLocalContrast(
  data: Buffer, width: number, height: number, channels: number,
  startX: number, startY: number, size: number
): number {
  let min = 255, max = 0;

  for (let y = startY; y < startY + size && y < height; y++) {
    for (let x = startX; x < startX + size && x < width; x++) {
      const idx = (y * width + x) * channels;
      const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      min = Math.min(min, luma);
      max = Math.max(max, luma);
    }
  }

  return (max - min) / 255;
}

// =============================================================================
// Metric Computation
// =============================================================================

/**
 * Compute comprehensive metrics between two frames.
 * Uses SSIM, perceptual hash, edge diff, and motion estimation.
 */
export async function computeMetrics(
  prevBuffer: Buffer,
  currBuffer: Buffer,
  cursorPos: CursorPosition | null,
  frameWidth: number = 1920,
  frameHeight: number = 1080
): Promise<FrameMetrics> {
  // Use 0.75x scale to preserve UI detail while being efficient
  const analysisScale = 0.75;
  const analysisWidth = Math.round(frameWidth * analysisScale);
  const analysisHeight = Math.round(frameHeight * analysisScale);

  // Get raw buffers at analysis resolution
  const [prev, curr] = await Promise.all([
    sharp(prevBuffer).resize(analysisWidth, analysisHeight).raw().toBuffer(),
    sharp(currBuffer).resize(analysisWidth, analysisHeight).raw().toBuffer(),
  ]);

  // Global metrics
  const globalSSIM = computeSSIM(prev, curr, analysisWidth, analysisHeight);
  const globalHash = computeHashDelta(prev, curr, analysisWidth, analysisHeight);
  const globalEdge = computeEdgeDiff(prev, curr, analysisWidth, analysisHeight);

  // ROI metrics (around cursor if available)
  let roiSSIM = globalSSIM, roiHash = globalHash, roiEdge = globalEdge;

  if (cursorPos?.visible) {
    const roiX = Math.max(0, Math.round(cursorPos.x * analysisScale - CURSOR_ROI_RADIUS * analysisScale));
    const roiY = Math.max(0, Math.round(cursorPos.y * analysisScale - CURSOR_ROI_RADIUS * analysisScale));
    const roiSize = Math.round(CURSOR_ROI_RADIUS * 2 * analysisScale);

    const prevROI = extractROI(prev, analysisWidth, analysisHeight, roiX, roiY, roiSize);
    const currROI = extractROI(curr, analysisWidth, analysisHeight, roiX, roiY, roiSize);

    if (prevROI && currROI) {
      roiSSIM = computeSSIM(prevROI, currROI, roiSize, roiSize);
      roiHash = computeHashDelta(prevROI, currROI, roiSize, roiSize);
      roiEdge = computeEdgeDiff(prevROI, currROI, roiSize, roiSize);
    }
  }

  // Motion metrics (simplified optical flow)
  const { magnitude, direction, coherence } = computeMotion(prev, curr, analysisWidth, analysisHeight);

  // Composite scores (invert SSIM since 1=identical)
  const globalScore = (1 - globalSSIM) * 0.4 + globalHash * 0.3 + globalEdge * 0.3;
  const roiScore = (1 - roiSSIM) * 0.4 + roiHash * 0.3 + roiEdge * 0.3;
  const motionScore = magnitude;

  const finalScore =
    WEIGHT_ROI * roiScore +
    WEIGHT_GLOBAL * globalScore +
    WEIGHT_MOTION * motionScore +
    WEIGHT_EDGE * globalEdge;

  return {
    globalSSIM, globalHash, globalEdge,
    roiSSIM, roiHash, roiEdge,
    motionMagnitude: magnitude,
    motionDirection: direction,
    motionCoherence: coherence,
    globalScore, roiScore, motionScore, finalScore,
  };
}

/**
 * SSIM computation (simplified but effective)
 */
function computeSSIM(
  buf1: Buffer, buf2: Buffer,
  width: number, height: number
): number {
  const n = Math.min(buf1.length, buf2.length);
  if (n === 0) return 1;

  let mean1 = 0, mean2 = 0;
  for (let i = 0; i < n; i += 3) {
    mean1 += buf1[i];
    mean2 += buf2[i];
  }
  const count = Math.floor(n / 3);
  mean1 /= count;
  mean2 /= count;

  let var1 = 0, var2 = 0, covar = 0;
  for (let i = 0; i < n; i += 3) {
    const d1 = buf1[i] - mean1;
    const d2 = buf2[i] - mean2;
    var1 += d1 * d1;
    var2 += d2 * d2;
    covar += d1 * d2;
  }
  var1 /= count;
  var2 /= count;
  covar /= count;

  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;

  return ((2 * mean1 * mean2 + C1) * (2 * covar + C2)) /
         ((mean1 ** 2 + mean2 ** 2 + C1) * (var1 + var2 + C2));
}

/**
 * Perceptual hash delta (dHash variant)
 */
function computeHashDelta(
  buf1: Buffer, buf2: Buffer,
  width: number, height: number
): number {
  const hashSize = 16;
  const hash1 = computeDHash(buf1, width, height, hashSize);
  const hash2 = computeDHash(buf2, width, height, hashSize);

  let diff = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) diff++;
  }

  return diff / hash1.length;
}

function computeDHash(buf: Buffer, width: number, height: number, size: number): boolean[] {
  const hash: boolean[] = [];
  const stepX = Math.floor(width / (size + 1));
  const stepY = Math.floor(height / size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx1 = ((y * stepY) * width + x * stepX) * 3;
      const idx2 = ((y * stepY) * width + (x + 1) * stepX) * 3;

      if (idx1 < buf.length && idx2 < buf.length) {
        hash.push(buf[idx1] > buf[idx2]);
      }
    }
  }

  return hash;
}

/**
 * Edge map difference using Sobel-like gradients
 */
function computeEdgeDiff(
  buf1: Buffer, buf2: Buffer,
  width: number, height: number
): number {
  const edge1 = computeEdgeMap(buf1, width, height);
  const edge2 = computeEdgeMap(buf2, width, height);

  let diff = 0;
  const count = Math.min(edge1.length, edge2.length);
  for (let i = 0; i < count; i++) {
    diff += Math.abs(edge1[i] - edge2[i]);
  }

  return diff / (count * 255);
}

function computeEdgeMap(buf: Buffer, width: number, height: number): number[] {
  const edges: number[] = [];
  const channels = 3;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * channels;
      const idxL = (y * width + x - 1) * channels;
      const idxR = (y * width + x + 1) * channels;
      const idxU = ((y - 1) * width + x) * channels;
      const idxD = ((y + 1) * width + x) * channels;

      const gx = Math.abs(buf[idxR] - buf[idxL]);
      const gy = Math.abs(buf[idxD] - buf[idxU]);
      edges.push(Math.min(255, Math.sqrt(gx * gx + gy * gy)));
    }
  }

  return edges;
}

/**
 * Simplified motion estimation (block matching)
 */
function computeMotion(
  buf1: Buffer, buf2: Buffer,
  width: number, height: number
): { magnitude: number; direction: number; coherence: number } {
  const blockSize = 32;
  const searchRadius = 16;
  const channels = 3;

  const vectors: { dx: number; dy: number }[] = [];

  for (let by = searchRadius; by < height - blockSize - searchRadius; by += blockSize) {
    for (let bx = searchRadius; bx < width - blockSize - searchRadius; bx += blockSize) {
      let bestDx = 0, bestDy = 0, bestSAD = Infinity;

      for (let dy = -searchRadius; dy <= searchRadius; dy += 4) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 4) {
          let sad = 0;
          for (let y = 0; y < blockSize; y += 4) {
            for (let x = 0; x < blockSize; x += 4) {
              const idx1 = ((by + y) * width + bx + x) * channels;
              const idx2 = ((by + y + dy) * width + bx + x + dx) * channels;
              if (idx1 < buf1.length && idx2 < buf2.length) {
                sad += Math.abs(buf1[idx1] - buf2[idx2]);
              }
            }
          }
          if (sad < bestSAD) {
            bestSAD = sad;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      vectors.push({ dx: bestDx, dy: bestDy });
    }
  }

  if (vectors.length === 0) {
    return { magnitude: 0, direction: 0, coherence: 1 };
  }

  // Compute average magnitude and direction
  let avgDx = 0, avgDy = 0, totalMag = 0;
  for (const v of vectors) {
    avgDx += v.dx;
    avgDy += v.dy;
    totalMag += Math.sqrt(v.dx * v.dx + v.dy * v.dy);
  }
  avgDx /= vectors.length;
  avgDy /= vectors.length;
  totalMag /= vectors.length;

  const direction = Math.atan2(avgDy, avgDx);

  // Coherence: how consistent is the motion direction?
  let coherenceSum = 0;
  for (const v of vectors) {
    const vDir = Math.atan2(v.dy, v.dx);
    const diff = Math.abs(vDir - direction);
    coherenceSum += Math.cos(diff);
  }
  const coherence = (coherenceSum / vectors.length + 1) / 2;

  // Normalize magnitude to 0-1 range
  const normalizedMag = Math.min(1, totalMag / searchRadius);

  return { magnitude: normalizedMag, direction, coherence };
}

function extractROI(
  buf: Buffer, width: number, height: number,
  x: number, y: number, size: number
): Buffer | null {
  const channels = 3;
  const roi = Buffer.alloc(size * size * channels);

  for (let ry = 0; ry < size; ry++) {
    for (let rx = 0; rx < size; rx++) {
      const srcX = x + rx;
      const srcY = y + ry;

      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + srcX) * channels;
        const dstIdx = (ry * size + rx) * channels;
        roi[dstIdx] = buf[srcIdx] || 0;
        roi[dstIdx + 1] = buf[srcIdx + 1] || 0;
        roi[dstIdx + 2] = buf[srcIdx + 2] || 0;
      }
    }
  }

  return roi;
}

// =============================================================================
// Event Detection
// =============================================================================

/**
 * Detect events from metrics and cursor time series.
 * Returns array of detected events with timestamps and evidence.
 */
export function detectEvents(
  frames: FrameData[],
  fps: number
): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  const msPerFrame = 1000 / fps;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const metrics = curr.metrics;

    if (!metrics) continue;

    const cursorSpeed = curr.cursor.visible && prev.cursor.visible
      ? Math.sqrt(
          (curr.cursor.x - prev.cursor.x) ** 2 +
          (curr.cursor.y - prev.cursor.y) ** 2
        )
      : 0;

    const details: string[] = [];
    let eventType: EventType = 'idle';
    let confidence = 0;
    let reason = '';

    // Check for hover: cursor slowed/stopped + small ROI change
    if (
      cursorSpeed < THRESHOLDS.hoverMaxCursorSpeed &&
      metrics.roiScore > THRESHOLDS.hoverMinScore &&
      metrics.roiScore < 0.15 && // Not too large (would be click/transition)
      curr.cursor.visible
    ) {
      eventType = 'hover';
      confidence = Math.min(1, metrics.roiScore / 0.1);
      reason = 'Cursor slowed with localized UI change in ROI';
      details.push(`cursorSpeed=${cursorSpeed.toFixed(1)}`, `roiScore=${metrics.roiScore.toFixed(3)}`);
    }

    // Check for click: cursor jitter + significant ROI change within response window
    else if (
      cursorSpeed > 0 && cursorSpeed < THRESHOLDS.clickCursorJitter * 2 &&
      metrics.roiScore > 0.08 &&
      curr.cursor.visible
    ) {
      // Look ahead for UI response
      let responseFound = false;
      for (let j = i + 1; j < Math.min(i + Math.ceil(THRESHOLDS.clickResponseWindowMs / msPerFrame), frames.length); j++) {
        const future = frames[j].metrics;
        if (future && future.roiScore > 0.1) {
          responseFound = true;
          break;
        }
      }

      if (responseFound || metrics.roiScore > 0.15) {
        eventType = 'click';
        confidence = Math.min(1, metrics.roiScore / 0.15 + 0.3);
        reason = 'Cursor micro-movement with immediate UI response';
        details.push(`roiScore=${metrics.roiScore.toFixed(3)}`, `responseFound=${responseFound}`);
      }
    }

    // Check for scroll: high motion coherence in vertical direction
    else if (
      metrics.motionMagnitude > THRESHOLDS.scrollMinMotion &&
      metrics.motionCoherence > THRESHOLDS.scrollDirectionRatio &&
      Math.abs(Math.sin(metrics.motionDirection)) > 0.7 // Mostly vertical
    ) {
      eventType = 'scroll';
      confidence = metrics.motionCoherence;
      reason = 'Coherent vertical motion detected';
      details.push(`motionMag=${metrics.motionMagnitude.toFixed(3)}`, `coherence=${metrics.motionCoherence.toFixed(2)}`);
    }

    // Check for transition/page change: large global change
    else if (metrics.globalScore > THRESHOLDS.transitionMinGlobal) {
      eventType = 'transition';
      confidence = Math.min(1, metrics.globalScore / 0.5);
      reason = 'Major structural change across frame';
      details.push(`globalScore=${metrics.globalScore.toFixed(3)}`);
    }

    // Check for animation anomaly: flicker or jitter
    else if (i >= 2 && i < frames.length - 1) {
      const anomaly = detectAnimationAnomaly(frames, i);
      if (anomaly) {
        eventType = 'animation_anomaly';
        confidence = anomaly.confidence;
        reason = anomaly.reason;
        details.push(...anomaly.details);
      }
    }

    // Check for general state change
    else if (metrics.finalScore > 0.08) {
      eventType = 'state_change';
      confidence = Math.min(1, metrics.finalScore / 0.15);
      reason = 'UI state changed';
      details.push(`finalScore=${metrics.finalScore.toFixed(3)}`);
    }

    // Check for cursor positioned on UI element (stationary cursor over high-edge region)
    // This captures "interaction ready" states even without visual feedback
    else if (
      curr.cursor.visible &&
      cursorSpeed < THRESHOLDS.cursorOnElementMaxSpeed &&
      metrics.roiEdge > THRESHOLDS.cursorOnElementMinEdge &&
      metrics.globalScore < THRESHOLDS.cursorOnElementMaxChange
    ) {
      eventType = 'cursor_on_element';
      confidence = Math.min(1, metrics.roiEdge / 0.3);
      reason = 'Cursor stationary over UI element (high edge density in ROI)';
      details.push(
        `cursorSpeed=${cursorSpeed.toFixed(1)}`,
        `roiEdge=${metrics.roiEdge.toFixed(3)}`,
        `globalScore=${metrics.globalScore.toFixed(3)}`
      );
    }

    if (eventType !== 'idle') {
      events.push({
        timestampMs: curr.timestampMs,
        framePath: curr.path,
        frameIndex: i,
        event: eventType,
        confidence,
        evidence: {
          cursor: curr.cursor,
          metrics: {
            globalScore: metrics.globalScore,
            roiScore: metrics.roiScore,
            motionScore: metrics.motionScore,
          },
          roi: curr.cursor.visible ? {
            x: Math.max(0, curr.cursor.x - CURSOR_ROI_RADIUS),
            y: Math.max(0, curr.cursor.y - CURSOR_ROI_RADIUS),
            width: CURSOR_ROI_RADIUS * 2,
            height: CURSOR_ROI_RADIUS * 2,
          } : undefined,
          details,
        },
        reason,
      });
    }
  }

  return clusterAndFilterEvents(events);
}

function detectAnimationAnomaly(
  frames: FrameData[],
  idx: number
): { confidence: number; reason: string; details: string[] } | null {
  // Flicker detection: check if current frame is similar to frame i-2 but different from i-1
  if (idx >= 2) {
    const curr = frames[idx].metrics;
    const prev = frames[idx - 1].metrics;

    if (curr && prev) {
      // Check for oscillation pattern
      const similarity = curr.globalSSIM;
      const prevSimilarity = prev.globalSSIM;

      if (similarity > THRESHOLDS.flickerToggleThreshold && prevSimilarity < THRESHOLDS.flickerToggleThreshold) {
        return {
          confidence: 0.7,
          reason: 'Flicker detected: element toggling between frames',
          details: [`ssim=${similarity.toFixed(3)}`, `prevSsim=${prevSimilarity.toFixed(3)}`],
        };
      }
    }
  }

  // Jitter detection: high edge variance in recent frames
  if (idx >= 3) {
    const edgeValues: number[] = [];
    for (let j = idx - 3; j <= idx; j++) {
      if (frames[j].metrics) {
        edgeValues.push(frames[j].metrics!.globalEdge);
      }
    }

    if (edgeValues.length >= 3) {
      const mean = edgeValues.reduce((a, b) => a + b, 0) / edgeValues.length;
      const variance = edgeValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / edgeValues.length;

      if (variance > THRESHOLDS.jitterEdgeVariance) {
        return {
          confidence: Math.min(1, variance / 0.05),
          reason: 'Jitter detected: unstable edge positions',
          details: [`edgeVariance=${variance.toFixed(4)}`],
        };
      }
    }
  }

  return null;
}

function clusterAndFilterEvents(events: DetectedEvent[]): DetectedEvent[] {
  if (events.length === 0) return [];

  const clustered: DetectedEvent[] = [];
  let currentCluster: DetectedEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const timeDiff = events[i].timestampMs - currentCluster[0].timestampMs;

    if (timeDiff <= THRESHOLDS.eventClusterWindowMs) {
      currentCluster.push(events[i]);
    } else {
      // Pick best event from cluster
      const best = currentCluster.reduce((a, b) => a.confidence > b.confidence ? a : b);
      clustered.push(best);
      currentCluster = [events[i]];
    }
  }

  // Don't forget the last cluster
  if (currentCluster.length > 0) {
    const best = currentCluster.reduce((a, b) => a.confidence > b.confidence ? a : b);
    clustered.push(best);
  }

  return clustered;
}

// =============================================================================
// Keyframe Selection
// =============================================================================

/**
 * Select keyframes from detected events.
 * For each event, picks pre-state, peak, and post-state frames.
 * Priority: click > hover > cursor_on_element > scroll > transition > state_change
 */
export function selectKeyframes(
  events: DetectedEvent[],
  frames: FrameData[],
  fps: number
): number[] {
  const keyframeIndices = new Set<number>();
  const msPerFrame = 1000 / fps;

  // Priority weights for event types (higher = more important)
  const eventPriority: Record<EventType, number> = {
    click: 10,
    hover: 9,
    cursor_on_element: 8,
    scroll: 6,
    transition: 5,
    animation_anomaly: 4,
    state_change: 3,
    idle: 0,
  };

  // Sort events by priority (highest first) then by confidence
  const sortedEvents = [...events].sort((a, b) => {
    const priorityDiff = eventPriority[b.event] - eventPriority[a.event];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });

  // Always include first and last frame
  keyframeIndices.add(0);
  keyframeIndices.add(frames.length - 1);

  const minDistFrames = Math.ceil(THRESHOLDS.minKeyframeDistanceMs / msPerFrame);

  // High-priority events that get full pre/peak/post treatment
  const highPriorityEvents: EventType[] = ['click', 'hover', 'cursor_on_element'];

  for (const event of sortedEvents) {
    const peakIdx = event.frameIndex;

    // Pre-state: 2-3 frames before event
    const preIdx = Math.max(0, peakIdx - Math.ceil(150 / msPerFrame));

    // Post-state: 3-5 frames after event (wait for UI to stabilize)
    const postIdx = Math.min(frames.length - 1, peakIdx + Math.ceil(300 / msPerFrame));

    // Enforce minimum distance unless it's a high-priority interaction event
    const lastKeyframe = Math.max(...Array.from(keyframeIndices).filter(k => k < peakIdx), -Infinity);
    const isHighPriority = highPriorityEvents.includes(event.event);

    if (peakIdx - lastKeyframe >= minDistFrames || isHighPriority) {
      keyframeIndices.add(preIdx);
      keyframeIndices.add(peakIdx);
      keyframeIndices.add(postIdx);
    } else {
      // Just add peak for closely spaced events
      keyframeIndices.add(peakIdx);
    }
  }

  // Fill gaps if we have too few keyframes
  const sorted = Array.from(keyframeIndices).sort((a, b) => a - b);
  const targetCount = Math.min(15, Math.max(8, events.length * 2));

  if (sorted.length < targetCount) {
    const remaining = frames
      .map((f, i) => ({ idx: i, score: f.metrics?.finalScore || 0 }))
      .filter(f => !keyframeIndices.has(f.idx))
      .sort((a, b) => b.score - a.score);

    for (const r of remaining) {
      if (keyframeIndices.size >= targetCount) break;

      // Check min distance
      const nearby = sorted.some(k => Math.abs(k - r.idx) < minDistFrames / 2);
      if (!nearby) {
        keyframeIndices.add(r.idx);
      }
    }
  }

  return Array.from(keyframeIndices).sort((a, b) => a - b);
}

// =============================================================================
// Two-Pass Frame Extraction Pipeline
// =============================================================================

/**
 * Extract frames using two-pass strategy:
 * Pass 1: Coarse scan at 10fps to find candidate windows
 * Pass 2: Fine scan at 30fps around candidates
 */
export async function extractFrames(
  videoBlob: Blob,
  runId: string
): Promise<ExtractedFrame[]> {
  const tempDir = path.join(process.cwd(), 'temp', runId);
  const videoPath = path.join(tempDir, 'video.mp4');
  const coarseDir = path.join(tempDir, 'frames_coarse');
  const fineDir = path.join(tempDir, 'frames_fine');

  try {
    await mkdir(tempDir, { recursive: true });
    await mkdir(coarseDir, { recursive: true });
    await mkdir(fineDir, { recursive: true });

    const videoBuffer = Buffer.from(await videoBlob.arrayBuffer());
    await writeFile(videoPath, videoBuffer);

    // Get video info
    const { stdout: probeOut } = await execFileAsync(getFfprobePath(), [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-of', 'json',
      videoPath,
    ]);
    const probeData = JSON.parse(probeOut);
    const videoWidth = probeData.streams?.[0]?.width || 1920;
    const videoHeight = probeData.streams?.[0]?.height || 1080;

    console.log(`[ffmpeg] V4 two-pass extraction starting (${videoWidth}x${videoHeight})`);

    // =========================================================================
    // PASS 1: Coarse extraction at 10fps
    // =========================================================================
    console.log(`[ffmpeg] Pass 1: Extracting at ${COARSE_FPS}fps...`);

    await execFileAsync(getFfmpegPath(), [
      '-y', '-i', videoPath,
      '-vf', `fps=${COARSE_FPS}`,
      '-q:v', '2', // High quality JPEG
      `${coarseDir}/frame_%06d.jpg`,
    ]);

    const coarseFiles = (await readdir(coarseDir))
      .filter(f => f.endsWith('.jpg'))
      .sort();

    console.log(`[ffmpeg] Pass 1: ${coarseFiles.length} frames extracted`);

    // Build coarse frame data with cursor detection and metrics
    const coarseFrames: FrameData[] = [];
    let prevBuffer: Buffer | null = null;
    let lastCursor: CursorPosition = { x: videoWidth / 2, y: videoHeight / 2, confidence: 0, visible: false };

    for (let i = 0; i < coarseFiles.length; i++) {
      const framePath = path.join(coarseDir, coarseFiles[i]);
      const buffer = await readFile(framePath);
      const timestampMs = Math.round((i / COARSE_FPS) * 1000);

      // Detect cursor
      const cursor = await detectCursor(buffer);
      if (!cursor.visible && lastCursor.visible) {
        // Use last known position with decayed confidence
        cursor.x = lastCursor.x;
        cursor.y = lastCursor.y;
        cursor.confidence = lastCursor.confidence * 0.5;
      }
      if (cursor.visible) lastCursor = cursor;

      // Compute metrics
      let metrics: FrameMetrics | undefined;
      if (prevBuffer) {
        metrics = await computeMetrics(prevBuffer, buffer, cursor, videoWidth, videoHeight);
      }

      coarseFrames.push({
        index: i,
        timestampMs,
        path: framePath,
        buffer,
        cursor,
        metrics,
      });

      prevBuffer = buffer;
    }

    // Detect events from coarse pass
    const coarseEvents = detectEvents(coarseFrames, COARSE_FPS);
    console.log(`[ffmpeg] Pass 1: ${coarseEvents.length} events detected`);

    // Identify candidate windows for fine pass
    const candidateWindows: CandidateWindow[] = coarseEvents.map(e => ({
      startMs: Math.max(0, e.timestampMs - FINE_WINDOW_MS),
      endMs: e.timestampMs + FINE_WINDOW_MS,
      peakMs: e.timestampMs,
      reason: e.event,
      score: e.confidence,
    }));

    // Merge overlapping windows
    const mergedWindows = mergeWindows(candidateWindows);
    console.log(`[ffmpeg] Pass 2: ${mergedWindows.length} candidate windows`);

    // =========================================================================
    // PASS 2: Fine extraction at 30fps around candidates
    // =========================================================================
    const fineFrames: FrameData[] = [];
    let fineIdx = 0;

    for (const window of mergedWindows) {
      const startSec = window.startMs / 1000;
      const duration = (window.endMs - window.startMs) / 1000;

      console.log(`[ffmpeg] Pass 2: Extracting ${startSec.toFixed(2)}s - ${(startSec + duration).toFixed(2)}s at ${FINE_FPS}fps`);

      const windowDir = path.join(fineDir, `window_${fineIdx}`);
      await mkdir(windowDir, { recursive: true });

      try {
        await execFileAsync(getFfmpegPath(), [
          '-y', '-ss', startSec.toString(),
          '-i', videoPath,
          '-t', duration.toString(),
          '-vf', `fps=${FINE_FPS}`,
          '-q:v', '2',
          `${windowDir}/frame_%06d.jpg`,
        ]);

        const windowFiles = (await readdir(windowDir))
          .filter(f => f.endsWith('.jpg'))
          .sort();

        let windowPrevBuffer: Buffer | null = null;

        for (let j = 0; j < windowFiles.length; j++) {
          const framePath = path.join(windowDir, windowFiles[j]);
          const buffer = await readFile(framePath);
          const timestampMs = Math.round(window.startMs + (j / FINE_FPS) * 1000);

          const cursor = await detectCursor(buffer);
          let metrics: FrameMetrics | undefined;
          if (windowPrevBuffer) {
            metrics = await computeMetrics(windowPrevBuffer, buffer, cursor, videoWidth, videoHeight);
          }

          fineFrames.push({
            index: fineFrames.length,
            timestampMs,
            path: framePath,
            buffer,
            cursor,
            metrics,
          });

          windowPrevBuffer = buffer;
        }
      } catch (err) {
        console.warn(`[ffmpeg] Pass 2 window ${fineIdx} failed:`, err);
      }

      fineIdx++;
    }

    console.log(`[ffmpeg] Pass 2: ${fineFrames.length} fine frames extracted`);

    // Detect events from fine pass
    const fineEvents = detectEvents(fineFrames, FINE_FPS);
    console.log(`[ffmpeg] Pass 2: ${fineEvents.length} fine events detected`);

    // =========================================================================
    // Select final keyframes
    // =========================================================================
    // Merge coarse and fine frames, deduplicate by timestamp
    const allFrames = [...coarseFrames];
    for (const ff of fineFrames) {
      // Only add fine frames that aren't duplicates
      if (!allFrames.some(cf => Math.abs(cf.timestampMs - ff.timestampMs) < 50)) {
        allFrames.push(ff);
      }
    }
    allFrames.sort((a, b) => a.timestampMs - b.timestampMs);

    // Merge events
    const allEvents = [...coarseEvents, ...fineEvents];
    allEvents.sort((a, b) => a.timestampMs - b.timestampMs);
    const dedupedEvents = clusterAndFilterEvents(allEvents);

    // Select keyframes
    const keyframeIndices = selectKeyframes(dedupedEvents, allFrames, COARSE_FPS);
    console.log(`[ffmpeg] Selected ${keyframeIndices.length} keyframes`);

    // Build final output
    const result: ExtractedFrame[] = allFrames.map((frame, idx) => {
      const isKeyframe = keyframeIndices.includes(idx);
      const event = dedupedEvents.find(e => Math.abs(e.timestampMs - frame.timestampMs) < 100);

      // Build change context from metrics
      let changeContext: FrameChangeContext | undefined;
      if (frame.metrics) {
        changeContext = {
          overallChangeScore: frame.metrics.finalScore,
          primaryChangeType: event?.event === 'transition' ? 'navigation' :
                            event?.event === 'click' ? 'interaction_feedback' :
                            event?.event === 'scroll' ? 'content_update' :
                            frame.metrics.finalScore > 0.1 ? 'content_update' : 'no_change',
          changeDescription: event?.reason || 'No significant change',
          hasModalOverlay: frame.metrics.globalScore > 0.4,
          hasLoadingIndicator: false,
          changedRegionCount: Math.ceil(frame.metrics.roiScore * 16),
        };
      } else {
        changeContext = createEmptyChangeContext();
      }

      return {
        id: randomUUID(),
        timestampMs: frame.timestampMs,
        buffer: frame.buffer,
        isKeyframe,
        diffScore: frame.metrics?.finalScore || 0,
        changeContext,
        cursor: frame.cursor,
        metrics: frame.metrics,
        event,
      };
    });

    // Log event summary
    const eventSummary = dedupedEvents.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`[ffmpeg] Event summary:`, eventSummary);

    return result;
  } finally {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function mergeWindows(windows: CandidateWindow[]): CandidateWindow[] {
  if (windows.length === 0) return [];

  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const merged: CandidateWindow[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startMs <= last.endMs) {
      // Merge
      last.endMs = Math.max(last.endMs, current.endMs);
      if (current.score > last.score) {
        last.peakMs = current.peakMs;
        last.reason = current.reason;
        last.score = current.score;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// =============================================================================
// Legacy API (for backwards compatibility)
// =============================================================================

async function calculateFrameDiff(buffer1: Buffer, buffer2: Buffer): Promise<number> {
  try {
    const size = 64;
    const img1 = await sharp(buffer1).resize(size, size, { fit: 'fill' }).raw().toBuffer();
    const img2 = await sharp(buffer2).resize(size, size, { fit: 'fill' }).raw().toBuffer();

    let diffPixels = 0;
    const threshold = 30;

    for (let i = 0; i < img1.length; i++) {
      if (Math.abs(img1[i] - img2[i]) > threshold) diffPixels++;
    }

    return diffPixels / img1.length;
  } catch {
    return 0;
  }
}

// =============================================================================
// Threshold Tuning Notes
// =============================================================================
/*
THRESHOLDS to tune based on your test videos:

1. hoverMinScore (0.03): Increase if detecting too many false hovers,
   decrease if missing hover highlights/tooltips.

2. hoverMaxCursorSpeed (15): Increase if users move cursor faster,
   decrease if detecting non-hover movements as hovers.

3. clickResponseWindowMs (200): Increase for slower UIs,
   decrease if click detection is too loose.

4. scrollMinMotion (0.15): Increase if detecting non-scrolls as scrolls,
   decrease if missing scroll events.

5. transitionMinGlobal (0.35): Increase if false positives on animations,
   decrease if missing page transitions.

6. flickerToggleThreshold (0.8): Decrease to catch more flickers,
   increase if false positives on intentional animations.

7. minKeyframeDistanceMs (300): Increase for fewer keyframes,
   decrease to allow denser keyframe selection for fast interactions.

Run synthetic tests to validate:
- Test hover: cursor pauses over button, highlight appears -> should detect 'hover'
- Test click: click button, tooltip appears -> should detect 'click' + 'state_change'
- Test scroll: scroll page -> should detect 'scroll'
- Test flicker: element blinks for 2 frames -> should detect 'animation_anomaly'
*/
