import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { writeFile, readFile, readdir, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  FRAME_EXTRACTION_FPS,
  KEYFRAME_DIFF_THRESHOLD,
  MIN_KEYFRAME_DISTANCE_MS,
} from '@interactive-flow/shared';
import { getEnv } from './env';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_FORMAT_MARKERS = ['mov', 'mp4', 'matroska'];

interface ExtractedFrame {
  id: string;
  timestampMs: number;
  buffer: Buffer;
  isKeyframe: boolean;
  diffScore: number;
}

function getFfmpegPath() {
  return getEnv().FFMPEG_PATH || 'ffmpeg';
}

function getFfprobePath() {
  const configured = getEnv().FFMPEG_PATH;
  if (!configured) return 'ffprobe';
  return configured.replace(/ffmpeg$/, 'ffprobe');
}

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
      '-v',
      'error',
      '-show_entries',
      'format=format_name,duration,size',
      '-of',
      'json',
      probePath,
    ]);

    const parsed = JSON.parse(stdout);
    const formatName = String(parsed?.format?.format_name || '').toLowerCase();

    if (!ALLOWED_VIDEO_FORMAT_MARKERS.some((marker) => formatName.includes(marker))) {
      throw new Error(`Unsupported video format: ${formatName || 'unknown'}`);
    }

    const duration = Number(parsed?.format?.duration || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not determine video duration');
    }

    return {
      formatName,
      duration,
      sizeBytes: videoBuffer.length,
    };
  } finally {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function extractFrames(videoBlob: Blob, runId: string): Promise<ExtractedFrame[]> {
  const tempDir = path.join(process.cwd(), 'temp', runId);
  const videoPath = path.join(tempDir, 'video.mp4');
  const framesDir = path.join(tempDir, 'frames');

  try {
    await mkdir(tempDir, { recursive: true });
    await mkdir(framesDir, { recursive: true });

    const videoBuffer = Buffer.from(await videoBlob.arrayBuffer());
    await writeFile(videoPath, videoBuffer);

    const fps = FRAME_EXTRACTION_FPS;

    try {
      await execFileAsync(getFfmpegPath(), ['-y', '-i', videoPath, '-vf', `fps=${fps}`, `${framesDir}/frame_%04d.jpg`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ffmpeg failed: ${message}`);
    }

    const frameFiles = (await readdir(framesDir))
      .filter((fileName: string) => fileName.endsWith('.jpg'))
      .sort();

    if (frameFiles.length === 0) {
      throw new Error('No frames were extracted from the video');
    }

    const frames: ExtractedFrame[] = [];
    let previousBuffer: Buffer | null = null;
    let lastKeyframeTime = -MIN_KEYFRAME_DISTANCE_MS;

    for (let index = 0; index < frameFiles.length; index++) {
      const framePath = path.join(framesDir, frameFiles[index]);
      const buffer = await readFile(framePath);
      const timestampMs = Math.round((index / fps) * 1000);

      let diffScore = 0;
      if (previousBuffer) {
        diffScore = await calculateFrameDiff(previousBuffer, buffer);
      }

      const timeSinceLastKeyframe = timestampMs - lastKeyframeTime;
      const isKeyframe =
        index === 0 ||
        (diffScore >= KEYFRAME_DIFF_THRESHOLD && timeSinceLastKeyframe >= MIN_KEYFRAME_DISTANCE_MS);

      if (isKeyframe) {
        lastKeyframeTime = timestampMs;
      }

      frames.push({
        id: randomUUID(),
        timestampMs,
        buffer,
        isKeyframe,
        diffScore,
      });

      previousBuffer = buffer;
    }

    const desiredKeyframes = Math.min(8, frames.length);
    const currentKeyframes = frames.filter((frame) => frame.isKeyframe).length;

    if (currentKeyframes < desiredKeyframes) {
      const candidates = frames
        .filter((frame) => !frame.isKeyframe)
        .sort((frameA, frameB) => frameB.diffScore - frameA.diffScore);

      const needed = desiredKeyframes - currentKeyframes;
      for (let index = 0; index < needed && index < candidates.length; index++) {
        candidates[index].isKeyframe = true;
      }
    }

    return frames;
  } finally {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function calculateFrameDiff(buffer1: Buffer, buffer2: Buffer): Promise<number> {
  try {
    const size = 64;
    const img1 = await sharp(buffer1).resize(size, size, { fit: 'fill' }).raw().toBuffer();
    const img2 = await sharp(buffer2).resize(size, size, { fit: 'fill' }).raw().toBuffer();

    let diffPixels = 0;
    const threshold = 30;

    for (let index = 0; index < img1.length; index++) {
      if (Math.abs(img1[index] - img2[index]) > threshold) {
        diffPixels++;
      }
    }

    return diffPixels / img1.length;
  } catch (error) {
    console.error('Error calculating frame diff:', error);
    return 0;
  }
}
