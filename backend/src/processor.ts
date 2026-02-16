import { supabase } from './supabase';
import { extractFrames } from './ffmpeg';
import { analyzeFrame } from './vision';
import { generateSummary } from './summary';
import type { AnalysisRun } from '@interactive-flow/shared';
import sharp from 'sharp';

const ANON_USER_ID = '00000000-0000-0000-0000-000000000000';

async function updateProgress(runId: string, percentage: number, message: string) {
  await supabase
    .from('analysis_runs')
    .update({
      progress_percentage: percentage,
      progress_message: message
    })
    .eq('id', runId);
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

  // Use cat1 (Action→Response Integrity) as the primary justification for context
  const primaryJustification = analysis.justifications?.cat1 || '';

  // Build a more narrative summary
  if (topIssues.length > 0) {
    return `${time}: ${primaryJustification}. Issues: ${topIssues.join(', ')}`;
  } else {
    return `${time}: ${primaryJustification}. No critical issues.`;
  }
}

async function buildFrameStrip(buffers: Buffer[], targetHeight = 360) {
  if (buffers.length === 0) {
    throw new Error('No frames provided for strip');
  }

  const resized = await Promise.all(
    buffers.map((buffer) =>
      sharp(buffer)
        .resize({ height: targetHeight })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true })
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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Processor] Starting processing for run: ${runId}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Update status to processing
    console.log('[Step 1/6] Updating status to processing...');
    await supabase
      .from('analysis_runs')
      .update({ status: 'processing', progress_percentage: 0, progress_message: 'Starting analysis...' })
      .eq('id', runId);
    console.log('✓ Status updated to processing\n');

    // Fetch run details
    console.log('[Step 2/6] Fetching run details...');
    const { data: run, error: runError } = await supabase
      .from('analysis_runs')
      .select('*')
      .eq('id', runId)
      .single();

    if (runError || !run) {
      throw new Error('Run not found');
    }
    const runOwnerId = run.user_id || ANON_USER_ID;
    console.log(`✓ Run details fetched: ${run.title}`);
    console.log(`  Video path: ${run.video_storage_path}\n`);
    console.log('[Processor] Run owner', { runId, userId: runOwnerId });

    // Download video from storage
    console.log('[Step 3/6] Downloading video from storage...');
    await updateProgress(runId, 10, 'Downloading video...');
    const { data: videoData, error: downloadError } = await supabase.storage
      .from('videos')
      .download(run.video_storage_path);

    if (downloadError || !videoData) {
      console.error('✗ Failed to download video:', downloadError);
      throw new Error('Failed to download video');
    }
    const videoSizeMB = (videoData.size / 1024 / 1024).toFixed(2);
    console.log(`✓ Video downloaded successfully (${videoSizeMB} MB)\n`);

    // Extract frames
    console.log('[Step 4/6] Extracting frames from video...');
    console.log('  Using ffmpeg to extract frames at 2 FPS...');
    await updateProgress(runId, 20, 'Extracting frames from video...');
    const frames = await extractFrames(videoData, runId);
    const keyframeCount = frames.filter(f => f.isKeyframe).length;
    console.log(`✓ Extracted ${frames.length} total frames`);
    console.log(`✓ Identified ${keyframeCount} keyframes for analysis\n`);
    console.log('[Processor] Frames extracted', {
      runId,
      totalFrames: frames.length,
      keyframes: keyframeCount,
    });

    // Upload frames to storage and save to DB
    console.log('[Step 5/6] Uploading frames to storage and saving to database...');
    await updateProgress(runId, 40, `Uploading ${frames.length} frames...`);
    const frameRecords = [];
    let uploadedCount = 0;
    for (const frame of frames) {
      const framePath = `${runOwnerId}/runs/${runId}/frames/${frame.id}.jpg`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('videos')
        .upload(framePath, frame.buffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        console.error(`  ✗ Failed to upload frame ${frame.id}:`, uploadError);
        continue;
      }

      // Save frame record
      const { data: frameRecord, error: frameError } = await supabase
        .from('frames')
        .insert({
          id: frame.id,
          run_id: runId,
          storage_path: framePath,
          timestamp_ms: frame.timestampMs,
          is_keyframe: frame.isKeyframe,
          diff_score: frame.diffScore,
        })
        .select()
        .single();

      if (frameError) {
        console.error(`  ✗ Failed to save frame record ${frame.id}:`, frameError);
        continue;
      }

      if (frameRecord) {
        frameRecords.push({ ...frameRecord, buffer: frame.buffer });
        uploadedCount++;
        if (uploadedCount % 10 === 0 || uploadedCount === frames.length) {
          console.log(`  Progress: ${uploadedCount}/${frames.length} frames uploaded`);
        }
      }
    }
    console.log(`✓ All frames uploaded and saved to database\n`);

    // Analyze keyframes
    console.log('[Step 6/6] Analyzing keyframes with OpenAI Vision API...');
    const framesOrdered = frameRecords
      .slice()
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    const frameIndexMap = new Map(framesOrdered.map((frame, index) => [frame.id, index]));
    const keyframes = framesOrdered.filter((f) => f.is_keyframe);
    console.log(`  Total keyframes to analyze: ${keyframes.length}\n`);
    await updateProgress(runId, 60, `Analyzing ${keyframes.length} keyframes with AI...`);

    let analyzedCount = 0;
    let failedCount = 0;
    const contextTrail: string[] = [];
    for (let i = 0; i < keyframes.length; i++) {
      const frame = keyframes[i];
      try {
        console.log(`  [${i + 1}/${keyframes.length}] Analyzing frame ${frame.id} (${frame.timestamp_ms}ms)...`);
        // Update progress during analysis (60-90% range)
        const progressPercentage = 60 + Math.floor((i / keyframes.length) * 30);
        await updateProgress(runId, progressPercentage, `Analyzing keyframe ${i + 1}/${keyframes.length}...`);
        const frameIndex = frameIndexMap.get(frame.id) ?? 0;
        const contextStart = Math.max(0, frameIndex - 1);
        const contextEnd = Math.min(framesOrdered.length, frameIndex + 2);
        const contextFrames = framesOrdered.slice(contextStart, contextEnd);
        const contextBuffers = contextFrames.map((f) => f.buffer);
        const stripBuffer = await buildFrameStrip(contextBuffers);
        const timestamps = contextFrames.map((f) => f.timestamp_ms);
        const priorContext = contextTrail.length > 0 ? contextTrail.join('\n') : undefined;
        const analysis = await analyzeFrame(stripBuffer, {
          sequence: {
            count: contextFrames.length,
            order: 'left-to-right oldest-to-newest',
            timestampsMs: timestamps,
          },
          priorContext,
        });

        const { error: insertError } = await supabase.from('frame_analyses').insert({
          frame_id: frame.id,
          rubric_scores: analysis.rubric_scores,
          justifications: analysis.justifications,
          issue_tags: analysis.issue_tags,
          suggestions: analysis.suggestions,
        });

        if (insertError) {
          console.error(`    ✗ Failed to save analysis:`, insertError);
          failedCount++;
        } else {
          console.log(`    ✓ Analysis complete`);
          const summaryLine = summarizeAnalysis(analysis, frame.timestamp_ms);
          contextTrail.push(summaryLine);
          // Keep last 5 summaries for better narrative continuity
          if (contextTrail.length > 5) {
            contextTrail.shift();
          }
          analyzedCount++;
        }
      } catch (error) {
        console.error(`    ✗ Failed to analyze frame ${frame.id}:`, error);
        failedCount++;
      }
    }
    console.log(`\n✓ Keyframe analysis complete: ${analyzedCount} succeeded, ${failedCount} failed\n`);
    console.log('[Processor] Analysis complete', {
      runId,
      analyzedCount,
      failedCount,
    });

    // Generate summary
    console.log('[Final Step] Generating summary report...');
    await updateProgress(runId, 90, 'Generating summary report...');
    const summary = await generateSummary(runId);
    console.log(`✓ Summary generated with ${summary.top_issues.length} top issues`);
    console.log(`✓ Generated ${summary.recommendations.length} recommendations\n`);

    const { error: summaryError } = await supabase.from('run_summaries').insert({
      run_id: runId,
      overall_scores: summary.overall_scores,
      top_issues: summary.top_issues,
      recommendations: summary.recommendations,
    });

    if (summaryError) {
      console.error('✗ Failed to save summary:', summaryError);
      throw new Error('Failed to save summary');
    }
    console.log('[Processor] Report saved', { runId });

    // Mark as completed
    await supabase
      .from('analysis_runs')
      .update({ status: 'completed', progress_percentage: 100, progress_message: 'Analysis complete!' })
      .eq('id', runId);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✓ PROCESSING COMPLETE FOR RUN: ${runId}`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    console.error(`\n${'='.repeat(60)}`);
    console.error(`✗ ERROR PROCESSING RUN: ${runId}`);
    console.error(`${'='.repeat(60)}`);
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    console.error(`${'='.repeat(60)}\n`);

    await supabase
      .from('analysis_runs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', runId);
  }
}
