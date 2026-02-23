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
import { analyzeFrame, analyzeFrameV3 } from './vision';
import { executeTwoPassInference } from './two-pass-inference';
import { generateSummary } from './summary';
import { synthesizeVideoFlow } from './flow-synthesis';
import { getAnalysisConfig, getPreprocessingConfig, getTwoPassConfig } from './env';
import { preprocessFramesForAnalysis, calculateSSIM } from './preprocessing';
import sharp from 'sharp';
import { trackEvent, trackException, trackMetric } from './telemetry';
import {
  createEmptyRunTelemetry,
  type RunAnalysisTelemetry,
  type FrameChangeContext,
  type FlowOverview,
  ANALYSIS_ENGINE_VERSIONS,
  type PreprocessingDiagnostics,
} from '@interactive-flow/shared';

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
      changeContext?: FrameChangeContext;
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
          changeContext: frame.changeContext,
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

    // Get analysis configuration for V3 accuracy upgrade
    const analysisConfig = getAnalysisConfig();
    const preprocessingConfig = getPreprocessingConfig();
    const twoPassConfig = getTwoPassConfig();
    const engineVersion = analysisConfig.activeEngine;
    const useV3Pipeline = engineVersion === ANALYSIS_ENGINE_VERSIONS.V3_HYBRID && preprocessingConfig.enableChangeDetection;
    const useTwoPass = useV3Pipeline && twoPassConfig.enableTwoPass;
    const runTelemetry = createEmptyRunTelemetry(engineVersion);

    console.log(`[Processor] Using analysis engine: ${engineVersion}`);
    console.log(`[Processor] V3 preprocessing pipeline: ${useV3Pipeline ? 'enabled' : 'disabled'}`);
    console.log(`[Processor] Two-pass inference: ${useTwoPass ? 'enabled' : 'disabled'}`);
    console.log(`[Processor] Token budget: ${analysisConfig.tokenHardCapTotal} total, ${analysisConfig.tokenHardCapPerFrame} per frame`);

    let analyzedCount = 0;
    let failedCount = 0;
    let preprocessFallbackCount = 0;
    let twoPassRerunCount = 0;
    let totalConfidence = 0;
    const rerunReasons = {
      schema_coercion: 0,
      low_confidence: 0,
      extraction_failed: 0,
    };
    const contextTrail: string[] = [];
    const collectedFlowOverviews: FlowOverview[] = [];

    // V3: Preprocess all frames if V3 pipeline is enabled
    let preprocessedFrames: Awaited<ReturnType<typeof preprocessFramesForAnalysis>>['frames'] | undefined;
    if (useV3Pipeline) {
      console.log('[Processor] Running V3 preprocessing pipeline...');
      const preprocessStartTime = Date.now();
      const preprocessResult = await preprocessFramesForAnalysis(
        framesOrdered.map(f => ({
          id: f.id,
          buffer: f.buffer,
          timestampMs: f.timestamp_ms,
          isKeyframe: f.is_keyframe,
          changeContext: f.changeContext,
        })),
        preprocessingConfig
      );
      preprocessedFrames = preprocessResult.frames;
      console.log(`[Processor] V3 preprocessing complete in ${Date.now() - preprocessStartTime}ms`);
      console.log(`[Processor] Preprocessing stats: ${preprocessResult.stats.successfulPreprocess}/${preprocessResult.stats.totalKeyframes} successful, ${preprocessResult.stats.fallbackCount} fallbacks, avg window size: ${preprocessResult.stats.avgTemporalWindowSize.toFixed(1)}`);
      trackMetric('processor.preprocessing_ms', Date.now() - preprocessStartTime, { runId, engineVersion });
      trackMetric('processor.preprocessing_fallbacks', preprocessResult.stats.fallbackCount, { runId, engineVersion });
    }

    for (let index = 0; index < keyframes.length; index++) {
      await throwIfCancelled(runId);
      const frame = keyframes[index];

      // Check if we've exceeded the total token budget
      if (runTelemetry.totalTokens >= analysisConfig.tokenHardCapTotal) {
        console.warn(`[Processor] Token budget exceeded (${runTelemetry.totalTokens}/${analysisConfig.tokenHardCapTotal}). Stopping analysis.`);
        runTelemetry.analysisTruncated = true;
        runTelemetry.truncationReason = 'token_cap_total';
        runTelemetry.framesSkipped = keyframes.length - index;
        trackEvent('processor.analysis_truncated', {
          runId,
          reason: 'token_cap_total',
          tokensUsed: String(runTelemetry.totalTokens),
          framesAnalyzed: String(index),
          framesSkipped: String(keyframes.length - index),
        });
        break;
      }

      try {
        const progressPercentage = 60 + Math.floor((index / Math.max(keyframes.length, 1)) * 30);
        await updateProgress(runId, progressPercentage, `Analyzing keyframe ${index + 1}/${keyframes.length}...`);

        const priorContext = contextTrail.length > 0 ? contextTrail.join('\n') : undefined;
        let analysis: Awaited<ReturnType<typeof analyzeFrame>>['analysis'];
        let frameTelemetry: Awaited<ReturnType<typeof analyzeFrame>>['telemetry'];

        // V3: Use multi-image payload if preprocessed data is available
        if (useV3Pipeline && preprocessedFrames) {
          const preprocessed = preprocessedFrames[index];
          if (preprocessed.preprocessFallback) {
            preprocessFallbackCount++;
          }

          // Calculate SSIM scores for diagnostics
          let ssimScores: number[] | undefined;
          if (preprocessed.temporalWindow.buffers.length >= 2) {
            ssimScores = [];
            for (let i = 0; i < preprocessed.temporalWindow.buffers.length - 1; i++) {
              const ssim = await calculateSSIM(
                preprocessed.temporalWindow.buffers[i],
                preprocessed.temporalWindow.buffers[i + 1]
              );
              ssimScores.push(ssim);
            }
          }

          const diagnostics: PreprocessingDiagnostics = {
            preprocessFallback: preprocessed.preprocessFallback,
            fallbackReason: preprocessed.fallbackReason as PreprocessingDiagnostics['fallbackReason'],
            ssimScores,
            avgChangeIntensity: preprocessed.changeContext.overallChangeScore,
            temporalWindowSize: preprocessed.temporalWindow.buffers.length,
            preprocessingMs: 0, // Already tracked above
          };

          // V3 Day 5-6: Use two-pass inference if enabled
          if (useTwoPass) {
            const twoPassResult = await executeTwoPassInference(
              preprocessed.rawStrip,
              preprocessed.diffHeatmapStrip,
              preprocessed.changeCrop,
              {
                temporalMetadata: {
                  relativeIndices: preprocessed.temporalWindow.relativeIndices,
                  timestamps: preprocessed.temporalWindow.timestamps,
                  deltaMs: preprocessed.temporalWindow.deltaMs,
                  keyframeIndex: preprocessed.temporalWindow.relativeIndices.indexOf(0),
                },
                priorContextTrail: priorContext,
                changeContext: preprocessed.changeContext,
                diagnostics,
                keyframeIndex: index,
              },
              engineVersion,
              () => throwIfCancelled(runId)
            );

            analysis = {
              ...twoPassResult.rubricAnalysis,
              // Copy flow_overview from two-pass extraction if available
              flow_overview: twoPassResult.rubricAnalysis.flow_overview,
            };
            frameTelemetry = {
              engineVersion,
              promptTokens: twoPassResult.telemetry.totalTokens, // Combined for reporting
              completionTokens: 0,
              totalTokens: twoPassResult.telemetry.totalTokens,
              inferenceMs: twoPassResult.telemetry.totalMs,
              schemaNormalized: twoPassResult.schemaNormalized,
              truncationReason: 'none',
            };
            twoPassRerunCount += twoPassResult.telemetry.rerunMetrics.rerunCount;

            // Track confidence for self-consistency metrics
            totalConfidence += twoPassResult.extraction.overallConfidence;

            // Track rerun reasons
            for (const reason of twoPassResult.telemetry.rerunMetrics.rerunReasons) {
              rerunReasons[reason]++;
            }

            // Track two-pass specific metrics
            trackMetric('processor.two_pass_a_tokens', twoPassResult.telemetry.passATokens, { runId, engineVersion });
            trackMetric('processor.two_pass_b_tokens', twoPassResult.telemetry.passBTokens, { runId, engineVersion });
            trackMetric('processor.two_pass_reruns', twoPassResult.telemetry.rerunMetrics.rerunCount, { runId, engineVersion });
          } else {
            // V3 single-pass (backwards compatible)
            const result = await analyzeFrameV3(
              preprocessed.rawStrip,
              preprocessed.diffHeatmapStrip,
              preprocessed.changeCrop,
              {
                temporalMetadata: {
                  relativeIndices: preprocessed.temporalWindow.relativeIndices,
                  timestamps: preprocessed.temporalWindow.timestamps,
                  deltaMs: preprocessed.temporalWindow.deltaMs,
                  keyframeIndex: preprocessed.temporalWindow.relativeIndices.indexOf(0),
                },
                priorContextTrail: priorContext,
                changeContext: preprocessed.changeContext,
                diagnostics,
                keyframeIndex: index,
              },
              engineVersion
            );

            analysis = result.analysis;
            frameTelemetry = result.telemetry;
          }
        } else {
          // V2: Use original single-image analysis
          const frameIndex = frameIndexMap.get(frame.id) ?? 0;
          const contextStart = Math.max(0, frameIndex - 2);
          const contextEnd = Math.min(framesOrdered.length, frameIndex + 3);
          const contextFrames = framesOrdered.slice(contextStart, contextEnd);
          const contextBuffers = contextFrames.map((contextFrame) => contextFrame.buffer);
          const stripBuffer = await buildFrameStrip(contextBuffers);
          const timestamps = contextFrames.map((contextFrame) => contextFrame.timestamp_ms);

          const result = await analyzeFrame(
            stripBuffer,
            {
              sequence: {
                count: contextFrames.length,
                order: 'left-to-right oldest-to-newest',
                timestampsMs: timestamps,
              },
              priorContext,
              changeContext: frame.changeContext,
            },
            engineVersion
          );

          analysis = result.analysis;
          frameTelemetry = result.telemetry;
        }

        // Aggregate frame telemetry into run telemetry
        runTelemetry.totalPromptTokens += frameTelemetry.promptTokens;
        runTelemetry.totalCompletionTokens += frameTelemetry.completionTokens;
        runTelemetry.totalTokens += frameTelemetry.totalTokens;
        runTelemetry.totalInferenceMs += frameTelemetry.inferenceMs;
        if (frameTelemetry.schemaNormalized) {
          runTelemetry.schemaNormalizedCount++;
        }
        runTelemetry.framesAnalyzed++;

        await insertFrameAnalysis({
          frameId: frame.id,
          rubricScores: analysis.rubric_scores,
          justifications: analysis.justifications,
          issueTags: analysis.issue_tags,
          suggestions: analysis.suggestions,
        });

        const summaryLine = summarizeAnalysis(analysis, frame.timestamp_ms);
        contextTrail.push(summaryLine);
        // Extended context trail from 5 to 10 frames for better temporal understanding
        if (contextTrail.length > 10) {
          contextTrail.shift();
        }

        // Collect flow_overview for video-level synthesis
        if (analysis.flow_overview) {
          collectedFlowOverviews.push(analysis.flow_overview);
        }

        analyzedCount++;
      } catch (analysisError) {
        console.error(`✗ Failed to analyze frame ${frame.id}:`, analysisError);
        failedCount++;
      }
    }

    // Track V3-specific metrics
    if (useV3Pipeline) {
      trackMetric('processor.preprocess_fallback_count', preprocessFallbackCount, { runId, engineVersion });
    }

    // Calculate schema normalization rate
    runTelemetry.schemaNormalizationRate = runTelemetry.framesAnalyzed > 0
      ? runTelemetry.schemaNormalizedCount / runTelemetry.framesAnalyzed
      : 0;

    console.log(`✓ Keyframe analysis complete: ${analyzedCount} succeeded, ${failedCount} failed`);
    console.log(`✓ Token usage: ${runTelemetry.totalTokens} total (${runTelemetry.totalPromptTokens} prompt, ${runTelemetry.totalCompletionTokens} completion)`);
    console.log(`✓ Schema normalization rate: ${(runTelemetry.schemaNormalizationRate * 100).toFixed(1)}%`);
    if (runTelemetry.analysisTruncated) {
      console.warn(`⚠ Analysis truncated: ${runTelemetry.truncationReason}, ${runTelemetry.framesSkipped} frames skipped`);
    }

    trackMetric('processor.keyframes_total', keyframes.length, { runId });
    trackMetric('processor.keyframes_failed', failedCount, { runId });
    trackMetric('processor.tokens_total', runTelemetry.totalTokens, { runId, engineVersion });
    trackMetric('processor.tokens_prompt', runTelemetry.totalPromptTokens, { runId, engineVersion });
    trackMetric('processor.tokens_completion', runTelemetry.totalCompletionTokens, { runId, engineVersion });
    trackMetric('processor.inference_ms_total', runTelemetry.totalInferenceMs, { runId, engineVersion });
    trackMetric('processor.schema_normalization_rate', runTelemetry.schemaNormalizationRate, { runId, engineVersion });

    await throwIfCancelled(runId);

    // Step 5.5: Synthesize video flow description from context carry-over
    console.log('[Step 5.5/7] Synthesizing video flow description...');
    let videoFlowDescription;
    if (contextTrail.length >= 3 || collectedFlowOverviews.length >= 2) {
      try {
        const synthesisResult = await synthesizeVideoFlow(contextTrail, collectedFlowOverviews);
        videoFlowDescription = synthesisResult.description;
        runTelemetry.totalTokens += synthesisResult.tokensUsed;
        console.log(`✓ Video flow synthesized: "${videoFlowDescription.application}" (confidence: ${videoFlowDescription.synthesis_confidence})`);
        trackMetric('processor.synthesis_tokens', synthesisResult.tokensUsed, { runId, engineVersion });
        trackMetric('processor.synthesis_confidence', videoFlowDescription.synthesis_confidence, { runId, engineVersion });
      } catch (synthesisError) {
        console.warn('[Processor] Video flow synthesis failed (non-fatal):', synthesisError);
        // Non-fatal - continue without video description
      }
    } else {
      console.log('[Processor] Skipping video flow synthesis (insufficient context)');
    }

    console.log('[Step 6/7] Generating summary report...');
    await updateProgress(runId, 90, 'Generating summary report...');

    // Calculate average confidence for self-consistency metrics
    const avgConfidence = analyzedCount > 0 ? totalConfidence / analyzedCount : 0.8;

    const summary = await generateSummary(runId, {
      analysisTruncated: runTelemetry.analysisTruncated,
      framesSkipped: runTelemetry.framesSkipped,
      twoPassRerunCount,
      runTelemetry,
      avgConfidence,
      rerunReasons,
      // Shadow analysis would be computed here if shadow engine is enabled
      // For now, pass null (shadow analysis is tracked separately)
      shadowAnalysis: null,
      // Video flow description synthesized from context carry-over
      videoFlowDescription,
    });

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
      videoFlowDescription: summary.video_flow_description,
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
