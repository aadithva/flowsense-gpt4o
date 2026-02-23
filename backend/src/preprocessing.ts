/**
 * Frame Preprocessing Module
 * V3 Accuracy Upgrade - Day 3-4: Change-Focused Preprocessing
 *
 * Provides temporal windowing, SSIM/diff heatmaps, and change-region cropping.
 */

import sharp from 'sharp';
import {
  type FrameChangeContext,
  type PreprocessingConfig,
  DEFAULT_PREPROCESSING_CONFIG,
  createEmptyChangeContext,
} from '@interactive-flow/shared';
import { analyzeFrameChanges } from './change-detection';

// =============================================================================
// Types
// =============================================================================

export interface TemporalWindow {
  /** Frame indices relative to keyframe: [-2, -1, 0, +1, +2] */
  relativeIndices: number[];
  /** Actual frame indices in the frames array */
  actualIndices: number[];
  /** Frame buffers in window order */
  buffers: Buffer[];
  /** Timestamps in ms */
  timestamps: number[];
  /** Delta-ms between consecutive frames */
  deltaMs: number[];
}

export interface DiffHeatmap {
  /** Heatmap image buffer (grayscale JPEG) */
  buffer: Buffer;
  /** Average intensity (0-1) */
  avgIntensity: number;
  /** Max intensity region coordinates */
  maxRegion: { x: number; y: number; width: number; height: number };
}

export interface ChangeRegionCrop {
  /** Cropped region buffer */
  buffer: Buffer;
  /** Normalized coordinates (0-1) */
  region: { x: number; y: number; width: number; height: number };
  /** Change intensity in this region */
  intensity: number;
}

export interface PreprocessedFrame {
  /** Keyframe ID */
  frameId: string;
  /** Keyframe index in sequence */
  keyframeIndex: number;
  /** Raw temporal strip (frames concatenated horizontally) */
  rawStrip: Buffer;
  /** Diff heatmap strip (heatmaps concatenated horizontally) */
  diffHeatmapStrip?: Buffer;
  /** Change region crop (most changed area) */
  changeCrop?: Buffer;
  /** Temporal window metadata */
  temporalWindow: TemporalWindow;
  /** Change context from analysis */
  changeContext: FrameChangeContext;
  /** Whether preprocessing fell back to raw-only mode */
  preprocessFallback: boolean;
  /** Fallback reason if applicable */
  fallbackReason?: string;
}

export interface PreprocessingResult {
  /** Preprocessed frames for analysis */
  frames: PreprocessedFrame[];
  /** Overall preprocessing stats */
  stats: {
    totalKeyframes: number;
    successfulPreprocess: number;
    fallbackCount: number;
    avgTemporalWindowSize: number;
  };
}

// =============================================================================
// Temporal Window Building
// =============================================================================

/**
 * Build temporal window [-2, -1, 0, +1, +2] around a keyframe
 */
export function buildTemporalWindow(
  allFrames: Array<{ buffer: Buffer; timestampMs: number; isKeyframe: boolean }>,
  keyframeIndex: number,
  windowSize: number = 5
): TemporalWindow {
  const halfWindow = Math.floor(windowSize / 2);
  const relativeIndices: number[] = [];
  const actualIndices: number[] = [];
  const buffers: Buffer[] = [];
  const timestamps: number[] = [];

  for (let offset = -halfWindow; offset <= halfWindow; offset++) {
    const actualIndex = keyframeIndex + offset;
    if (actualIndex >= 0 && actualIndex < allFrames.length) {
      relativeIndices.push(offset);
      actualIndices.push(actualIndex);
      buffers.push(allFrames[actualIndex].buffer);
      timestamps.push(allFrames[actualIndex].timestampMs);
    }
  }

  // Calculate delta-ms between consecutive frames
  const deltaMs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    deltaMs.push(timestamps[i] - timestamps[i - 1]);
  }

  return {
    relativeIndices,
    actualIndices,
    buffers,
    timestamps,
    deltaMs,
  };
}

// =============================================================================
// SSIM / Diff Heatmap Generation
// =============================================================================

/**
 * Calculate Structural Similarity Index (simplified SSIM approximation)
 * Returns value between 0 (completely different) and 1 (identical)
 */
export async function calculateSSIM(
  buffer1: Buffer,
  buffer2: Buffer,
  size: number = 256
): Promise<number> {
  try {
    // Resize and convert to grayscale raw buffers
    const [img1, img2] = await Promise.all([
      sharp(buffer1).resize(size, size, { fit: 'fill' }).grayscale().raw().toBuffer(),
      sharp(buffer2).resize(size, size, { fit: 'fill' }).grayscale().raw().toBuffer(),
    ]);

    const n = img1.length;

    // Calculate means
    let mean1 = 0, mean2 = 0;
    for (let i = 0; i < n; i++) {
      mean1 += img1[i];
      mean2 += img2[i];
    }
    mean1 /= n;
    mean2 /= n;

    // Calculate variances and covariance
    let var1 = 0, var2 = 0, covar = 0;
    for (let i = 0; i < n; i++) {
      const d1 = img1[i] - mean1;
      const d2 = img2[i] - mean2;
      var1 += d1 * d1;
      var2 += d2 * d2;
      covar += d1 * d2;
    }
    var1 /= n;
    var2 /= n;
    covar /= n;

    // SSIM constants (standard values)
    const C1 = (0.01 * 255) ** 2;
    const C2 = (0.03 * 255) ** 2;

    // SSIM formula
    const ssim = ((2 * mean1 * mean2 + C1) * (2 * covar + C2)) /
                 ((mean1 ** 2 + mean2 ** 2 + C1) * (var1 + var2 + C2));

    return Math.max(0, Math.min(1, ssim));
  } catch (error) {
    console.error('[Preprocessing] SSIM calculation failed:', error);
    return 0;
  }
}

/**
 * Generate diff heatmap between two frames
 */
export async function generateDiffHeatmap(
  buffer1: Buffer,
  buffer2: Buffer,
  outputWidth: number = 360,
  outputHeight: number = 360
): Promise<DiffHeatmap> {
  const analysisSize = 256;

  // Resize and get raw grayscale data
  const [img1, img2] = await Promise.all([
    sharp(buffer1).resize(analysisSize, analysisSize, { fit: 'fill' }).grayscale().raw().toBuffer(),
    sharp(buffer2).resize(analysisSize, analysisSize, { fit: 'fill' }).grayscale().raw().toBuffer(),
  ]);

  // Calculate absolute difference for each pixel
  const diffBuffer = Buffer.alloc(analysisSize * analysisSize);
  let totalIntensity = 0;
  let maxIntensity = 0;
  let maxX = 0, maxY = 0;

  for (let y = 0; y < analysisSize; y++) {
    for (let x = 0; x < analysisSize; x++) {
      const idx = y * analysisSize + x;
      const diff = Math.abs(img1[idx] - img2[idx]);
      diffBuffer[idx] = diff;
      totalIntensity += diff;

      if (diff > maxIntensity) {
        maxIntensity = diff;
        maxX = x;
        maxY = y;
      }
    }
  }

  const avgIntensity = totalIntensity / (analysisSize * analysisSize * 255);

  // Apply colormap (heat: black -> red -> yellow -> white)
  const coloredBuffer = Buffer.alloc(analysisSize * analysisSize * 3);
  for (let i = 0; i < diffBuffer.length; i++) {
    const v = diffBuffer[i] / 255;
    const idx = i * 3;

    // Simple heat colormap
    if (v < 0.33) {
      coloredBuffer[idx] = Math.round(v * 3 * 255);     // R
      coloredBuffer[idx + 1] = 0;                        // G
      coloredBuffer[idx + 2] = 0;                        // B
    } else if (v < 0.66) {
      coloredBuffer[idx] = 255;                          // R
      coloredBuffer[idx + 1] = Math.round((v - 0.33) * 3 * 255); // G
      coloredBuffer[idx + 2] = 0;                        // B
    } else {
      coloredBuffer[idx] = 255;                          // R
      coloredBuffer[idx + 1] = 255;                      // G
      coloredBuffer[idx + 2] = Math.round((v - 0.66) * 3 * 255); // B
    }
  }

  // Create colored heatmap image
  const heatmapBuffer = await sharp(coloredBuffer, {
    raw: { width: analysisSize, height: analysisSize, channels: 3 }
  })
    .resize(outputWidth, outputHeight)
    .jpeg({ quality: 85 })
    .toBuffer();

  // Calculate max region (16x16 grid region containing max intensity)
  const gridSize = 16;
  const regionWidth = 1 / gridSize;
  const regionHeight = 1 / gridSize;
  const maxRegionX = Math.floor(maxX / analysisSize * gridSize) / gridSize;
  const maxRegionY = Math.floor(maxY / analysisSize * gridSize) / gridSize;

  return {
    buffer: heatmapBuffer,
    avgIntensity,
    maxRegion: {
      x: maxRegionX,
      y: maxRegionY,
      width: regionWidth,
      height: regionHeight,
    },
  };
}

/**
 * Generate diff heatmap strip from temporal window
 */
export async function generateDiffHeatmapStrip(
  buffers: Buffer[],
  targetHeight: number = 360
): Promise<{ strip: Buffer; heatmaps: DiffHeatmap[] }> {
  if (buffers.length < 2) {
    throw new Error('Need at least 2 frames for diff heatmap');
  }

  const heatmaps: DiffHeatmap[] = [];
  const heatmapBuffers: Buffer[] = [];

  // Generate heatmap for each consecutive pair
  for (let i = 0; i < buffers.length - 1; i++) {
    const heatmap = await generateDiffHeatmap(buffers[i], buffers[i + 1], targetHeight, targetHeight);
    heatmaps.push(heatmap);
    heatmapBuffers.push(heatmap.buffer);
  }

  // Concatenate horizontally
  if (heatmapBuffers.length === 1) {
    return { strip: heatmapBuffers[0], heatmaps };
  }

  const resized = await Promise.all(
    heatmapBuffers.map(buf =>
      sharp(buf).resize({ height: targetHeight }).toBuffer({ resolveWithObject: true })
    )
  );

  const totalWidth = resized.reduce((sum, r) => sum + (r.info.width || 0), 0);
  let offsetX = 0;
  const composites = resized.map((result, index) => {
    const input = { input: result.data, top: 0, left: offsetX };
    offsetX += result.info.width || 0;
    return input;
  });

  const strip = await sharp({
    create: {
      width: totalWidth,
      height: targetHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();

  return { strip, heatmaps };
}

// =============================================================================
// Change Region Cropping
// =============================================================================

/**
 * Generate crop of the most changed region between two frames
 */
export async function generateChangeRegionCrop(
  buffer1: Buffer,
  buffer2: Buffer,
  outputSize: number = 256,
  threshold: number = 30
): Promise<ChangeRegionCrop> {
  const analysisSize = 256;
  const gridSize = 8; // 8x8 grid for region detection

  // Get grayscale data
  const [img1, img2] = await Promise.all([
    sharp(buffer1).resize(analysisSize, analysisSize, { fit: 'fill' }).grayscale().raw().toBuffer(),
    sharp(buffer2).resize(analysisSize, analysisSize, { fit: 'fill' }).grayscale().raw().toBuffer(),
  ]);

  // Calculate diff per grid cell
  const cellWidth = Math.floor(analysisSize / gridSize);
  const cellHeight = Math.floor(analysisSize / gridSize);
  const gridIntensities: number[][] = [];

  for (let gy = 0; gy < gridSize; gy++) {
    gridIntensities[gy] = [];
    for (let gx = 0; gx < gridSize; gx++) {
      let cellDiff = 0;
      let cellCount = 0;

      const startX = gx * cellWidth;
      const startY = gy * cellHeight;
      const endX = Math.min(startX + cellWidth, analysisSize);
      const endY = Math.min(startY + cellHeight, analysisSize);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * analysisSize + x;
          const diff = Math.abs(img1[idx] - img2[idx]);
          if (diff > threshold) {
            cellDiff += diff;
          }
          cellCount++;
        }
      }

      gridIntensities[gy][gx] = cellDiff / (cellCount * 255);
    }
  }

  // Find the 2x2 region with highest combined intensity
  let maxIntensity = 0;
  let bestGx = 0, bestGy = 0;

  for (let gy = 0; gy < gridSize - 1; gy++) {
    for (let gx = 0; gx < gridSize - 1; gx++) {
      const intensity =
        gridIntensities[gy][gx] +
        gridIntensities[gy][gx + 1] +
        gridIntensities[gy + 1][gx] +
        gridIntensities[gy + 1][gx + 1];

      if (intensity > maxIntensity) {
        maxIntensity = intensity;
        bestGx = gx;
        bestGy = gy;
      }
    }
  }

  // Calculate crop region (normalized 0-1)
  const regionX = bestGx / gridSize;
  const regionY = bestGy / gridSize;
  const regionWidth = 2 / gridSize;
  const regionHeight = 2 / gridSize;

  // Get original image dimensions and crop
  const metadata = await sharp(buffer2).metadata();
  const origWidth = metadata.width || analysisSize;
  const origHeight = metadata.height || analysisSize;

  const cropLeft = Math.floor(regionX * origWidth);
  const cropTop = Math.floor(regionY * origHeight);
  const cropWidth = Math.floor(regionWidth * origWidth);
  const cropHeight = Math.floor(regionHeight * origHeight);

  // Extract and resize the crop
  const cropBuffer = await sharp(buffer2)
    .extract({
      left: Math.max(0, cropLeft),
      top: Math.max(0, cropTop),
      width: Math.min(cropWidth, origWidth - cropLeft),
      height: Math.min(cropHeight, origHeight - cropTop),
    })
    .resize(outputSize, outputSize, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    buffer: cropBuffer,
    region: { x: regionX, y: regionY, width: regionWidth, height: regionHeight },
    intensity: maxIntensity / 4, // Normalize by 4 cells
  };
}

// =============================================================================
// Main Preprocessing Pipeline
// =============================================================================

/**
 * Preprocess frames for V3 analysis
 */
export async function preprocessFramesForAnalysis(
  allFrames: Array<{
    id: string;
    buffer: Buffer;
    timestampMs: number;
    isKeyframe: boolean;
    changeContext?: FrameChangeContext;
  }>,
  config: PreprocessingConfig = DEFAULT_PREPROCESSING_CONFIG
): Promise<PreprocessingResult> {
  const keyframeIndices = allFrames
    .map((f, i) => ({ frame: f, index: i }))
    .filter(({ frame }) => frame.isKeyframe)
    .map(({ index }) => index);

  const preprocessedFrames: PreprocessedFrame[] = [];
  let fallbackCount = 0;
  let totalWindowSize = 0;

  for (let ki = 0; ki < keyframeIndices.length; ki++) {
    const keyframeIndex = keyframeIndices[ki];
    const frame = allFrames[keyframeIndex];

    // Build temporal window
    const temporalWindow = buildTemporalWindow(allFrames, keyframeIndex, 5);
    totalWindowSize += temporalWindow.buffers.length;

    let preprocessFallback = false;
    let fallbackReason: string | undefined;
    let rawStrip: Buffer;
    let diffHeatmapStrip: Buffer | undefined;
    let changeCrop: Buffer | undefined;

    try {
      // Generate raw temporal strip
      rawStrip = await buildFrameStrip(temporalWindow.buffers, 360);

      if (config.enableChangeDetection && temporalWindow.buffers.length >= 2) {
        try {
          // Generate diff heatmap strip
          const { strip: heatmapStrip } = await generateDiffHeatmapStrip(temporalWindow.buffers, 360);
          diffHeatmapStrip = heatmapStrip;

          // Generate change region crop (from keyframe and previous frame)
          const keyframeLocalIndex = temporalWindow.relativeIndices.indexOf(0);
          if (keyframeLocalIndex > 0) {
            const prevBuffer = temporalWindow.buffers[keyframeLocalIndex - 1];
            const currBuffer = temporalWindow.buffers[keyframeLocalIndex];
            const crop = await generateChangeRegionCrop(prevBuffer, currBuffer, 256, config.pixelDiffThreshold);
            changeCrop = crop.buffer;
          }
        } catch (heatmapError) {
          console.warn(`[Preprocessing] Heatmap/crop generation failed for frame ${ki}:`, heatmapError);
          preprocessFallback = true;
          fallbackReason = 'heatmap_generation_failed';
        }
      }
    } catch (stripError) {
      console.error(`[Preprocessing] Strip generation failed for frame ${ki}:`, stripError);
      // Absolute fallback - just use the keyframe itself
      rawStrip = frame.buffer;
      preprocessFallback = true;
      fallbackReason = 'strip_generation_failed';
    }

    if (preprocessFallback) {
      fallbackCount++;
    }

    preprocessedFrames.push({
      frameId: frame.id,
      keyframeIndex: ki,
      rawStrip,
      diffHeatmapStrip,
      changeCrop,
      temporalWindow,
      changeContext: frame.changeContext || createEmptyChangeContext(),
      preprocessFallback,
      fallbackReason,
    });
  }

  return {
    frames: preprocessedFrames,
    stats: {
      totalKeyframes: keyframeIndices.length,
      successfulPreprocess: keyframeIndices.length - fallbackCount,
      fallbackCount,
      avgTemporalWindowSize: keyframeIndices.length > 0 ? totalWindowSize / keyframeIndices.length : 0,
    },
  };
}

/**
 * Build horizontal strip from frame buffers with visual separators
 * Adds white lines between frames so AI can clearly see frame boundaries
 */
async function buildFrameStrip(
  buffers: Buffer[],
  targetHeight: number = 360,
  separatorWidth: number = 4
): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('No frames provided for strip');
  }

  const resized = await Promise.all(
    buffers.map(buffer =>
      sharp(buffer).resize({ height: targetHeight }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
    )
  );

  if (resized.length === 1) {
    return resized[0].data;
  }

  const widths = resized.map(result => result.info.width || 0);
  // Total width = sum of frame widths + separators between frames
  const numSeparators = resized.length - 1;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + (numSeparators * separatorWidth);

  if (totalWidth <= 0) {
    return resized[0].data;
  }

  // Build composites with separators
  const composites: Array<{ input: Buffer; top: number; left: number }> = [];
  let offsetX = 0;

  for (let i = 0; i < resized.length; i++) {
    // Add frame
    composites.push({
      input: resized[i].data,
      top: 0,
      left: offsetX,
    });
    offsetX += widths[i];

    // Add white separator after each frame (except the last)
    if (i < resized.length - 1) {
      // Create white separator bar
      const separatorBuffer = await sharp({
        create: {
          width: separatorWidth,
          height: targetHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }, // White separator
        },
      })
        .jpeg({ quality: 100 })
        .toBuffer();

      composites.push({
        input: separatorBuffer,
        top: 0,
        left: offsetX,
      });
      offsetX += separatorWidth;
    }
  }

  return sharp({
    create: {
      width: totalWidth,
      height: targetHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
}

// =============================================================================
// Exports for Testing
// =============================================================================

export const __testing = {
  buildTemporalWindow,
  calculateSSIM,
  generateDiffHeatmap,
  generateChangeRegionCrop,
  buildFrameStrip,
};
