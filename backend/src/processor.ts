import {
  getRunById,
  updateRunStatus,
  insertFrame,
  insertFrameAnalysis,
  insertRunSummary,
  isRunCancellationRequested,
} from './azure-db';
import { downloadBlob, uploadBlob } from './azure-storage';
import { extractFrames, validateVideoBuffer } from './ffmpeg';
import { analyzeFrame } from './vision';
import { generateSummary } from './summary';
import sharp from 'sharp';
import { trackEvent, trackException, trackMetric } from './telemetry';

class RunCancelledError extends Error {
  constructor(message = 'Run cancellation requested') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

async function updateProgress(runId: string, percentage: number, message: string) {
  await updateRunStatus(runId, 'processing', { percentage, message });
}

async function throwIfCancelled(runId: string) {
  if (await isRunCancellationRequested(runId)) {
    throw new RunCancelledError();
  }
}

function summarizeAnalysis(
  analysis: {
    rubric_scores: Record<string, number>;
    issue_tags?: string[];
    justifications?: Record<string, string>;
    suggestions?: { title?: string; description?: string; severity?: string }[];
  },
  timestampMs: number
) {
  const time = `t=${timestampMs}ms`;
  const topIssues = (analysis.issue_tags || []).slice(0, 3);
  const primaryJustification = analysis.justifications?.cat1 || '';

  if (topIssues.length > 0) {
    return `${time}: ${primaryJustification}. Issues: ${topIssues.join(', ')}`;
  }

  return `${time}: ${primaryJustification}. No critical issues.`;
}

async function buildFrameStrip(buffers: Buffer[], targetHeight = 360) {
  if (buffers.length === 0) {
    throw new Error('No frames provided for strip');
  }

  const resized = await Promise.all(
    buffers.map((buffer) =>
      sharp(buffer).resize({ height: targetHeight }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
    )
  );

  if (resized.length === 1) {
    return resized[0].data;
  }

  const widths = resized.map((result) => result.info.width || 0);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  if (totalWidth <= 0) {
    return resized[0].data;
  }

  let offsetX = 0;
  const composites = resized.map((result, index) => {
    const input = {
      input: result.data,
      top: 0,
      left: offsetX,
    };
    offsetX += widths[index];
    return input;
  });

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

export async function processRun(runId: string) {
  const startedAt = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Processor] Starting processing for run: ${runId}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    await throwIfCancelled(runId);

    console.log('[Step 1/7] Fetching run details...');
    const run = await getRunById(runId);

    if (!run) {
      throw new Error('Run not found');
    }

    if (!run.user_id) {
      throw new Error('Run is missing user ownership');
    }

    if (run.status === 'cancel_requested' || run.cancel_requested) {
      await updateRunStatus(runId, 'cancelled', { percentage: run.progress_percentage ?? 0, message: 'Cancelled by user' });
      return;
    }

    if (run.status !== 'processing') {
      await updateRunStatus(runId, 'processing', { percentage: 0, message: 'Starting analysis...' });
    }

    const runOwnerId = run.user_id;
    const queueWaitMs = run.created_at ? Date.now() - new Date(run.created_at).getTime() : 0;
    if (queueWaitMs > 0) {
      trackMetric('processor.queue_wait_ms', queueWaitMs, { runId });
    }
    console.log(`✓ Run details fetched: ${run.title}`);
    console.log(`  Video path: ${run.video_storage_path}`);
    console.log('[Processor] Run owner', { runId, userId: runOwnerId });

    await throwIfCancelled(runId);

    console.log('[Step 2/7] Downloading video from Azure Blob Storage...');
    await updateProgress(runId, 10, 'Downloading video...');

    let videoBuffer: Buffer;
    try {
      videoBuffer = await downloadBlob(run.video_storage_path);
    } catch (downloadError) {
      console.error('✗ Failed to download video:', downloadError);
      throw new Error('Failed to download video');
    }

    const validation = await validateVideoBuffer(videoBuffer, runId);
    console.log('✓ Video validated', validation);

    await throwIfCancelled(runId);

    console.log('[Step 3/7] Extracting frames from video...');
    await updateProgress(runId, 20, 'Extracting frames from video...');

    const videoBlob = new Blob([videoBuffer]);
    const frames = await extractFrames(videoBlob, runId);
    const keyframeCount = frames.filter((frame) => frame.isKeyframe).length;

    console.log(`✓ Extracted ${frames.length} total frames`);
    console.log(`✓ Identified ${keyframeCount} keyframes for analysis`);

    await throwIfCancelled(runId);

    console.log('[Step 4/7] Uploading frames to Azure Blob Storage and saving metadata...');
    await updateProgress(runId, 40, `Uploading ${frames.length} frames...`);

    const frameRecords: Array<{
      id: string;
      run_id: string;
      storage_path: string;
      timestamp_ms: number;
      is_keyframe: boolean;
      diff_score: number;
      buffer: Buffer;
    }> = [];

    let uploadedCount = 0;
    for (const frame of frames) {
      await throwIfCancelled(runId);

      const framePath = `${runOwnerId}/runs/${runId}/frames/${frame.id}.jpg`;

      try {
        await uploadBlob(framePath, frame.buffer, 'image/jpeg');
        await insertFrame({
          id: frame.id,
          runId,
          storagePath: framePath,
          timestampMs: frame.timestampMs,
          isKeyframe: frame.isKeyframe,
          diffScore: frame.diffScore,
        });

        frameRecords.push({
          id: frame.id,
          run_id: runId,
          storage_path: framePath,
          timestamp_ms: frame.timestampMs,
          is_keyframe: frame.isKeyframe,
          diff_score: frame.diffScore,
          buffer: frame.buffer,
        });

        uploadedCount++;
      } catch (uploadError) {
        console.error(`✗ Failed to upload frame ${frame.id}:`, uploadError);
      }
    }

    console.log(`✓ Uploaded ${uploadedCount}/${frames.length} frames`);

    await throwIfCancelled(runId);

    console.log('[Step 5/7] Analyzing keyframes with Azure OpenAI...');
    const framesOrdered = frameRecords.slice().sort((frameA, frameB) => frameA.timestamp_ms - frameB.timestamp_ms);
    const frameIndexMap = new Map(framesOrdered.map((frame, index) => [frame.id, index]));
    const keyframes = framesOrdered.filter((frame) => frame.is_keyframe);

    await updateProgress(runId, 60, `Analyzing ${keyframes.length} keyframes with AI...`);

    let analyzedCount = 0;
    let failedCount = 0;
    const contextTrail: string[] = [];

    for (let index = 0; index < keyframes.length; index++) {
      await throwIfCancelled(runId);
      const frame = keyframes[index];

      try {
        const progressPercentage = 60 + Math.floor((index / Math.max(keyframes.length, 1)) * 30);
        await updateProgress(runId, progressPercentage, `Analyzing keyframe ${index + 1}/${keyframes.length}...`);

        const frameIndex = frameIndexMap.get(frame.id) ?? 0;
        const contextStart = Math.max(0, frameIndex - 1);
        const contextEnd = Math.min(framesOrdered.length, frameIndex + 2);
        const contextFrames = framesOrdered.slice(contextStart, contextEnd);
        const contextBuffers = contextFrames.map((contextFrame) => contextFrame.buffer);
        const stripBuffer = await buildFrameStrip(contextBuffers);
        const timestamps = contextFrames.map((contextFrame) => contextFrame.timestamp_ms);
        const priorContext = contextTrail.length > 0 ? contextTrail.join('\n') : undefined;

        const analysis = await analyzeFrame(stripBuffer, {
          sequence: {
            count: contextFrames.length,
            order: 'left-to-right oldest-to-newest',
            timestampsMs: timestamps,
          },
          priorContext,
        });

        await insertFrameAnalysis({
          frameId: frame.id,
          rubricScores: analysis.rubric_scores,
          justifications: analysis.justifications,
          issueTags: analysis.issue_tags,
          suggestions: analysis.suggestions,
        });

        const summaryLine = summarizeAnalysis(analysis, frame.timestamp_ms);
        contextTrail.push(summaryLine);
        if (contextTrail.length > 5) {
          contextTrail.shift();
        }

        analyzedCount++;
      } catch (analysisError) {
        console.error(`✗ Failed to analyze frame ${frame.id}:`, analysisError);
        failedCount++;
      }
    }

    console.log(`✓ Keyframe analysis complete: ${analyzedCount} succeeded, ${failedCount} failed`);
    trackMetric('processor.keyframes_total', keyframes.length, { runId });
    trackMetric('processor.keyframes_failed', failedCount, { runId });

    await throwIfCancelled(runId);

    console.log('[Step 6/7] Generating summary report...');
    await updateProgress(runId, 90, 'Generating summary report...');
    const summary = await generateSummary(runId);

    await insertRunSummary({
      runId,
      overallScores: summary.overall_scores as unknown as Record<string, number>,
      topIssues: summary.top_issues,
      recommendations: summary.recommendations,
      weightedScore100: summary.weighted_score_100,
      criticalIssueCount: summary.critical_issue_count,
      qualityGateStatus: summary.quality_gate_status,
      confidenceByCategory: summary.confidence_by_category,
      metricVersion: summary.metric_version,
    });

    console.log('[Step 7/7] Finalizing run...');
    await updateRunStatus(runId, 'completed', { percentage: 100, message: 'Analysis complete!' });
    trackMetric('processor.duration_ms', Date.now() - startedAt, { runId });
    trackMetric('processor.weighted_score_100', summary.weighted_score_100, { runId });
    trackEvent('processor.run_completed', {
      runId,
      qualityGate: summary.quality_gate_status,
      metricVersion: summary.metric_version,
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✓ PROCESSING COMPLETE FOR RUN: ${runId}`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    if (error instanceof RunCancelledError) {
      await updateRunStatus(runId, 'cancelled', undefined, 'Cancelled by user');
      console.log(`[Processor] Run ${runId} cancelled by user request`);
      trackEvent('processor.run_cancelled', { runId });
      return;
    }

    console.error(`\n${'='.repeat(60)}`);
    console.error(`✗ ERROR PROCESSING RUN: ${runId}`);
    console.error(`${'='.repeat(60)}`);
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    console.error(`${'='.repeat(60)}\n`);

    await updateRunStatus(runId, 'failed', undefined, error instanceof Error ? error.message : 'Unknown error');
    trackException(error, { runId });
  }
}
