import { exec } from 'child_process';
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

const execAsync = promisify(exec);

interface ExtractedFrame {
  id: string;
  timestampMs: number;
  buffer: Buffer;
  isKeyframe: boolean;
  diffScore: number;
}

export async function extractFrames(
  videoBlob: Blob,
  runId: string
): Promise<ExtractedFrame[]> {
  const tempDir = path.join(process.cwd(), 'temp', runId);
  const videoPath = path.join(tempDir, 'video.mp4');
  const framesDir = path.join(tempDir, 'frames');

  try {
    // Create temp directories
    await mkdir(tempDir, { recursive: true });
    await mkdir(framesDir, { recursive: true });

    // Save video to temp file
    const videoBuffer = Buffer.from(await videoBlob.arrayBuffer());
    await writeFile(videoPath, videoBuffer);

    // Extract frames using ffmpeg
    const fps = FRAME_EXTRACTION_FPS;
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    try {
      await execAsync(
        `${ffmpegPath} -y -i "${videoPath}" -vf "fps=${fps}" "${framesDir}/frame_%04d.jpg"`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ffmpeg failed: ${message}`);
    }

    // Read all extracted frames
    const frameFiles = (await readdir(framesDir))
      .filter((f: string) => f.endsWith('.jpg'))
      .sort();

    if (frameFiles.length === 0) {
      throw new Error('No frames were extracted from the video');
    }

    const frames: ExtractedFrame[] = [];
    let previousBuffer: Buffer | null = null;
    let lastKeyframeTime = -MIN_KEYFRAME_DISTANCE_MS;

    for (let i = 0; i < frameFiles.length; i++) {
      const framePath = path.join(framesDir, frameFiles[i]);
      const buffer = await readFile(framePath);
      const timestampMs = Math.round((i / fps) * 1000);

      // Calculate diff score with previous frame
      let diffScore = 0;
      if (previousBuffer) {
        diffScore = await calculateFrameDiff(previousBuffer, buffer);
      }

      // Determine if this is a keyframe
      const timeSinceLastKeyframe = timestampMs - lastKeyframeTime;
      const isKeyframe =
        i === 0 || // First frame is always a keyframe
        (diffScore >= KEYFRAME_DIFF_THRESHOLD &&
          timeSinceLastKeyframe >= MIN_KEYFRAME_DISTANCE_MS);

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

    // Ensure we have at least 8 keyframes (prefer high-diff transitions)
    const desiredKeyframes = Math.min(8, frames.length);
    const currentKeyframes = frames.filter((f) => f.isKeyframe).length;
    if (currentKeyframes < desiredKeyframes) {
      const candidates = frames
        .filter((f) => !f.isKeyframe)
        .sort((a, b) => b.diffScore - a.diffScore);
      const needed = desiredKeyframes - currentKeyframes;
      for (let i = 0; i < needed && i < candidates.length; i++) {
        candidates[i].isKeyframe = true;
      }
    }

    return frames;
  } finally {
    // Cleanup temp directory
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function calculateFrameDiff(
  buffer1: Buffer,
  buffer2: Buffer
): Promise<number> {
  try {
    // Resize to small size for faster comparison
    const size = 64;
    const img1 = await sharp(buffer1)
      .resize(size, size, { fit: 'fill' })
      .raw()
      .toBuffer();

    const img2 = await sharp(buffer2)
      .resize(size, size, { fit: 'fill' })
      .raw()
      .toBuffer();

    // Calculate pixel-wise difference
    let diffPixels = 0;
    const threshold = 30; // Difference threshold per pixel

    for (let i = 0; i < img1.length; i++) {
      if (Math.abs(img1[i] - img2[i]) > threshold) {
        diffPixels++;
      }
    }

    return diffPixels / img1.length;
  } catch (error) {
    console.error('Error calculating frame diff:', error);
    return 0;
  }
}
