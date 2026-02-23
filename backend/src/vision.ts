import OpenAI from 'openai';
import {
  VISION_MODEL_PROMPT,
  issueTagSchema,
  visionAnalysisResponseSchema,
  type FrameAnalysisTelemetry,
  type AnalysisEngineVersion,
  ANALYSIS_ENGINE_VERSIONS,
  createEmptyFrameTelemetry,
  type FrameChangeContext,
  formatChangeContextForPrompt,
  type TemporalWindowMetadata,
  type PreprocessingDiagnostics,
} from '@interactive-flow/shared';

// Azure OpenAI Configuration
import { getEnv, getAnalysisConfig, getPreprocessingConfig } from './env';

const env = getEnv();
const AZURE_OPENAI_ENDPOINT = env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT = env.AZURE_OPENAI_DEPLOYMENT;
const AZURE_OPENAI_API_VERSION = env.AZURE_OPENAI_API_VERSION;

// Initialize Azure OpenAI client
const client = new OpenAI({
  apiKey: AZURE_OPENAI_API_KEY,
  baseURL: `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { 'api-version': AZURE_OPENAI_API_VERSION },
  defaultHeaders: { 'api-key': AZURE_OPENAI_API_KEY },
});

const DEFAULT_JUSTIFICATION = 'Analysis incomplete - no justification provided';
const ALLOWED_ISSUE_TAGS = new Set<string>(issueTagSchema.options as string[]);

function coerceScore(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.max(0, Math.min(2, rounded));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      const rounded = Math.round(parsed);
      return Math.max(0, Math.min(2, rounded));
    }
  }
  return 1;
}

function isLazyJustification(text: string): boolean {
  const lazyPatterns = [
    /^no .* in (the |this )?first frame\.?$/i,
    /^insufficient evidence\.?$/i,
    /^not visible\.?$/i,
    /^cannot determine\.?$/i,
    /^unclear\.?$/i,
    /^n\/?a\.?$/i,
  ];
  return lazyPatterns.some((pattern) => pattern.test(text.trim()));
}

function validateJustification(text: unknown, category: string, score: number): string {
  if (typeof text !== 'string' || !text.trim()) {
    console.warn(`[Vision] Empty justification for ${category}, score ${score}`);
    return DEFAULT_JUSTIFICATION;
  }

  if (isLazyJustification(text)) {
    console.warn(`[Vision] Lazy justification detected for ${category}: "${text}"`);
    // Still allow but log for monitoring
  }

  return text.trim();
}

function normalizeSeverity(value: unknown) {
  if (value === 'high' || value === 'med' || value === 'low') {
    return value;
  }
  if (value === 'medium') {
    return 'med';
  }
  return 'low';
}

function normalizeFlowOverview(raw: any) {
  if (!raw?.flow_overview) return undefined;
  const fo = raw.flow_overview;
  return {
    app_context: typeof fo.app_context === 'string' ? fo.app_context.trim() : 'Unknown application',
    user_intent: typeof fo.user_intent === 'string' ? fo.user_intent.trim() : 'Unknown intent',
    actions_observed: typeof fo.actions_observed === 'string' ? fo.actions_observed.trim() : 'No actions observed',
  };
}

/**
 * Validate issue tags against rubric scores to prevent false positives.
 * If a rubric category indicates good quality, remove contradicting issue tags.
 */
function validateIssueTags(
  issueTags: string[],
  rubricScores: Record<string, number>
): string[] {
  let validated = [...issueTags];

  // cat1 (Action Response) = 2 (Good) → remove dead_click
  // If the system responded well to actions, there can't be dead clicks
  if (rubricScores.cat1 === 2) {
    validated = validated.filter(tag => tag !== 'dead_click');
  }

  // cat2 (Feedback Visibility) = 2 (Good) → remove missing_spinner, no_progress_feedback
  // If feedback is visible and clear, these issues don't exist
  if (rubricScores.cat2 === 2) {
    validated = validated.filter(
      tag => !['missing_spinner', 'no_progress_feedback'].includes(tag)
    );
  }

  // cat3 (Visual Hierarchy) = 2 (Good) → remove poor_contrast, unclear_cta
  if (rubricScores.cat3 === 2) {
    validated = validated.filter(
      tag => !['poor_contrast', 'unclear_cta'].includes(tag)
    );
  }

  // cat4 (Error Handling) = 2 (Good) → remove unclear_error, no_error_recovery
  if (rubricScores.cat4 === 2) {
    validated = validated.filter(
      tag => !['unclear_error', 'no_error_recovery'].includes(tag)
    );
  }

  // cat5 (Navigation) = 2 (Good) → remove confusing_nav
  if (rubricScores.cat5 === 2) {
    validated = validated.filter(tag => tag !== 'confusing_nav');
  }

  // Log when tags are removed for monitoring
  const removedTags = issueTags.filter(tag => !validated.includes(tag));
  if (removedTags.length > 0) {
    console.log(`[Vision] Validated issue tags: removed ${removedTags.join(', ')} (contradicted by rubric scores)`);
  }

  return validated;
}

function normalizeAnalysis(raw: any) {
  const rawScores = raw?.rubric_scores ?? {};
  const rawJustifications = raw?.justifications ?? {};
  const rubric_scores = {
    cat1: coerceScore(rawScores.cat1),
    cat2: coerceScore(rawScores.cat2),
    cat3: coerceScore(rawScores.cat3),
    cat4: coerceScore(rawScores.cat4),
    cat5: coerceScore(rawScores.cat5),
    cat6: coerceScore(rawScores.cat6),
    cat7: coerceScore(rawScores.cat7),
  };

  const justifications = {
    cat1: validateJustification(rawJustifications.cat1, 'cat1', rubric_scores.cat1),
    cat2: validateJustification(rawJustifications.cat2, 'cat2', rubric_scores.cat2),
    cat3: validateJustification(rawJustifications.cat3, 'cat3', rubric_scores.cat3),
    cat4: validateJustification(rawJustifications.cat4, 'cat4', rubric_scores.cat4),
    cat5: validateJustification(rawJustifications.cat5, 'cat5', rubric_scores.cat5),
    cat6: validateJustification(rawJustifications.cat6, 'cat6', rubric_scores.cat6),
    cat7: validateJustification(rawJustifications.cat7, 'cat7', rubric_scores.cat7),
  };

  const rawIssueTags = Array.isArray(raw?.issue_tags)
    ? raw.issue_tags.filter((tag: unknown) => typeof tag === 'string' && ALLOWED_ISSUE_TAGS.has(tag))
    : [];

  // Validate issue tags against rubric scores to prevent false positives
  const issue_tags = validateIssueTags(rawIssueTags, rubric_scores);

  const suggestions = Array.isArray(raw?.suggestions)
    ? raw.suggestions
        .map((suggestion: any) => ({
          severity: normalizeSeverity(suggestion?.severity),
          title: typeof suggestion?.title === 'string' && suggestion.title.trim() ? suggestion.title.trim() : 'Suggestion',
          description:
            typeof suggestion?.description === 'string' && suggestion.description.trim()
              ? suggestion.description.trim()
              : '',
        }))
        .filter((suggestion: any) => suggestion.description)
    : [];

  const flow_overview = normalizeFlowOverview(raw);

  return { rubric_scores, justifications, issue_tags, suggestions, ...(flow_overview && { flow_overview }) };
}

export interface AnalyzeFrameResult {
  analysis: {
    rubric_scores: Record<string, number>;
    justifications: Record<string, string>;
    issue_tags: string[];
    suggestions: Array<{ severity: 'high' | 'med' | 'low'; title: string; description: string }>;
    flow_overview?: {
      app_context: string;
      user_intent: string;
      actions_observed: string;
    };
  };
  telemetry: FrameAnalysisTelemetry;
}

export async function analyzeFrame(
  frameBuffer: Buffer,
  context?: {
    sequence?: { count: number; order: string; timestampsMs?: number[] };
    priorContext?: string;
    /** V3: Change context from preprocessing */
    changeContext?: FrameChangeContext;
  },
  engineVersion: AnalysisEngineVersion = ANALYSIS_ENGINE_VERSIONS.V2_BASELINE
): Promise<AnalyzeFrameResult> {
  const startTime = Date.now();
  const telemetry = createEmptyFrameTelemetry(engineVersion);
  const preprocessingConfig = getPreprocessingConfig();

  const base64Image = frameBuffer.toString('base64');
  const sequenceNote = context?.sequence
    ? `\n\nThis image is a sequence of ${context.sequence.count} consecutive frames arranged ${context.sequence.order}. Use changes across frames to infer interaction signals.${
        context.sequence.timestampsMs
          ? ` Timestamps (ms): ${context.sequence.timestampsMs.join(', ')}.`
          : ''
      }`
    : '';
  const priorNote = context?.priorContext
    ? `\n\nContext from previous frames (carry this forward when judging the current frame):\n${context.priorContext}`
    : '';

  // V3: Add change context to prompt if enabled
  const changeNote = preprocessingConfig.includeChangeContext && context?.changeContext
    ? formatChangeContextForPrompt(context.changeContext)
    : '';

  try {
    console.log(`[Vision] Analyzing frame with Azure OpenAI GPT-4o (deployment: ${AZURE_OPENAI_DEPLOYMENT}, engine: ${engineVersion})`);

    // Call Azure OpenAI API with vision capabilities
    const response = await client.chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: 'system',
          content: 'You are a UX interaction-flow evaluator. Analyze the provided screenshot(s) and respond with ONLY valid JSON, no other text.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${VISION_MODEL_PROMPT}${sequenceNote}${priorNote}${changeNote}\n\nAnalyze the image and respond with ONLY the JSON object, no other text.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: 'high', // Use high detail for better analysis
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    // Update telemetry with token usage
    telemetry.promptTokens = response.usage?.prompt_tokens ?? 0;
    telemetry.completionTokens = response.usage?.completion_tokens ?? 0;
    telemetry.totalTokens = response.usage?.total_tokens ?? 0;
    telemetry.inferenceMs = Date.now() - startTime;

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from Azure OpenAI');
    }

    console.log(`[Vision] Raw response length: ${content.length} characters`);
    console.log(`[Vision] Token usage: ${telemetry.totalTokens} total (${telemetry.promptTokens} prompt, ${telemetry.completionTokens} completion)`);

    // Parse and validate JSON response
    const parsed = JSON.parse(content);
    const validated = visionAnalysisResponseSchema.safeParse(parsed);
    if (validated.success) {
      return { analysis: validated.data, telemetry };
    }

    console.warn('[Vision] Schema validation failed, attempting normalization:', validated.error.issues);
    const normalized = normalizeAnalysis(parsed);
    const normalizedValidation = visionAnalysisResponseSchema.safeParse(normalized);
    if (normalizedValidation.success) {
      console.warn('[Vision] Normalized analysis accepted');
      telemetry.schemaNormalized = true;
      return { analysis: normalizedValidation.data, telemetry };
    }

    console.error('[Vision] Normalized analysis still invalid:', normalizedValidation.error.issues);
    throw new Error('Vision response did not match schema');
  } catch (error) {
    console.error('[Vision] Analysis error:', error);
    if (error instanceof Error) {
      console.error('[Vision] Error message:', error.message);
      console.error('[Vision] Error stack:', error.stack);
    }

    // Update telemetry for error case
    telemetry.inferenceMs = Date.now() - startTime;
    telemetry.truncationReason = 'error';

    // Return default scores if analysis fails
    return {
      analysis: {
        rubric_scores: {
          cat1: 1,
          cat2: 1,
          cat3: 1,
          cat4: 1,
          cat5: 1,
          cat6: 1,
          cat7: 1,
        },
        justifications: {
          cat1: 'Analysis failed',
          cat2: 'Analysis failed',
          cat3: 'Analysis failed',
          cat4: 'Analysis failed',
          cat5: 'Analysis failed',
          cat6: 'Analysis failed',
          cat7: 'Analysis failed',
        },
        issue_tags: [],
        suggestions: [
          {
            severity: 'med' as const,
            title: 'Analysis Error',
            description: 'Frame analysis failed. Please review manually.',
          },
        ],
      },
      telemetry,
    };
  }
}

// =============================================================================
// V3 Multi-Image Analysis (Day 3-4)
// =============================================================================

export interface MultiImageAnalysisContext {
  /** Temporal window metadata */
  temporalMetadata: TemporalWindowMetadata;
  /** Prior context trail (short summaries of previous analyses) */
  priorContextTrail?: string;
  /** Change context from preprocessing */
  changeContext?: FrameChangeContext;
  /** Preprocessing diagnostics */
  diagnostics?: PreprocessingDiagnostics;
  /** Keyframe index in overall sequence */
  keyframeIndex: number;
}

/**
 * V3 Multi-Image Analysis
 * Accepts multiple images: raw strip, diff heatmap strip, change crop
 */
export async function analyzeFrameV3(
  rawStrip: Buffer,
  diffHeatmapStrip: Buffer | undefined,
  changeCrop: Buffer | undefined,
  context: MultiImageAnalysisContext,
  engineVersion: AnalysisEngineVersion = ANALYSIS_ENGINE_VERSIONS.V3_HYBRID
): Promise<AnalyzeFrameResult> {
  const startTime = Date.now();
  const telemetry = createEmptyFrameTelemetry(engineVersion);
  const preprocessingConfig = getPreprocessingConfig();

  // Build image content array
  const imageContents: Array<{
    type: 'image_url';
    image_url: { url: string; detail: 'high' | 'low' };
  }> = [];

  // 1. Raw temporal strip (always included)
  const rawBase64 = rawStrip.toString('base64');
  imageContents.push({
    type: 'image_url',
    image_url: {
      url: `data:image/jpeg;base64,${rawBase64}`,
      detail: 'high',
    },
  });

  // 2. Diff heatmap strip (if available)
  if (diffHeatmapStrip) {
    const heatmapBase64 = diffHeatmapStrip.toString('base64');
    imageContents.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${heatmapBase64}`,
        detail: 'low', // Lower detail for heatmap
      },
    });
  }

  // 3. Change crop (if available)
  if (changeCrop) {
    const cropBase64 = changeCrop.toString('base64');
    imageContents.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${cropBase64}`,
        detail: 'high',
      },
    });
  }

  // Build structured metadata note
  const metadataNote = buildMetadataNote(context, diffHeatmapStrip !== undefined, changeCrop !== undefined);

  // Build change context note
  const changeNote = preprocessingConfig.includeChangeContext && context.changeContext
    ? formatChangeContextForPrompt(context.changeContext)
    : '';

  // Build prior context note
  const priorNote = context.priorContextTrail
    ? `\n\nContext from previous frames (carry this forward when judging the current frame):\n${context.priorContextTrail}`
    : '';

  try {
    console.log(`[Vision V3] Analyzing frame ${context.keyframeIndex} with ${imageContents.length} images (engine: ${engineVersion})`);
    if (context.diagnostics?.preprocessFallback) {
      console.warn(`[Vision V3] Using fallback mode: ${context.diagnostics.fallbackReason}`);
    }

    // Call Azure OpenAI API with multi-image payload
    const response = await client.chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: 'system',
          content: 'You are a UX interaction-flow evaluator. Analyze the provided screenshot(s) and respond with ONLY valid JSON, no other text.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${VISION_MODEL_PROMPT}${metadataNote}${priorNote}${changeNote}\n\nAnalyze the images and respond with ONLY the JSON object, no other text.`,
            },
            ...imageContents,
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    // Update telemetry with token usage
    telemetry.promptTokens = response.usage?.prompt_tokens ?? 0;
    telemetry.completionTokens = response.usage?.completion_tokens ?? 0;
    telemetry.totalTokens = response.usage?.total_tokens ?? 0;
    telemetry.inferenceMs = Date.now() - startTime;

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from Azure OpenAI');
    }

    console.log(`[Vision V3] Raw response length: ${content.length} characters`);
    console.log(`[Vision V3] Token usage: ${telemetry.totalTokens} total (${telemetry.promptTokens} prompt, ${telemetry.completionTokens} completion)`);

    // Parse and validate JSON response
    const parsed = JSON.parse(content);
    const validated = visionAnalysisResponseSchema.safeParse(parsed);
    if (validated.success) {
      return { analysis: validated.data, telemetry };
    }

    console.warn('[Vision V3] Schema validation failed, attempting normalization:', validated.error.issues);
    const normalized = normalizeAnalysis(parsed);
    const normalizedValidation = visionAnalysisResponseSchema.safeParse(normalized);
    if (normalizedValidation.success) {
      console.warn('[Vision V3] Normalized analysis accepted');
      telemetry.schemaNormalized = true;
      return { analysis: normalizedValidation.data, telemetry };
    }

    console.error('[Vision V3] Normalized analysis still invalid:', normalizedValidation.error.issues);
    throw new Error('Vision response did not match schema');
  } catch (error) {
    console.error('[Vision V3] Analysis error:', error);
    if (error instanceof Error) {
      console.error('[Vision V3] Error message:', error.message);
    }

    telemetry.inferenceMs = Date.now() - startTime;
    telemetry.truncationReason = 'error';

    return {
      analysis: {
        rubric_scores: { cat1: 1, cat2: 1, cat3: 1, cat4: 1, cat5: 1, cat6: 1, cat7: 1 },
        justifications: {
          cat1: 'Analysis failed',
          cat2: 'Analysis failed',
          cat3: 'Analysis failed',
          cat4: 'Analysis failed',
          cat5: 'Analysis failed',
          cat6: 'Analysis failed',
          cat7: 'Analysis failed',
        },
        issue_tags: [],
        suggestions: [{ severity: 'med' as const, title: 'Analysis Error', description: 'Frame analysis failed. Please review manually.' }],
      },
      telemetry,
    };
  }
}

/**
 * Build structured metadata note for V3 prompt
 */
function buildMetadataNote(
  context: MultiImageAnalysisContext,
  hasDiffHeatmap: boolean,
  hasChangeCrop: boolean
): string {
  const { temporalMetadata, keyframeIndex, diagnostics } = context;
  const parts: string[] = [];

  // Image descriptions
  const imageDescriptions: string[] = ['Image 1: Temporal strip showing consecutive frames (left=oldest, right=newest)'];
  if (hasDiffHeatmap) {
    imageDescriptions.push('Image 2: Diff heatmap showing change intensity between consecutive frames (red=high change)');
  }
  if (hasChangeCrop) {
    imageDescriptions.push(`Image ${hasDiffHeatmap ? 3 : 2}: Cropped region showing the area of maximum change`);
  }

  parts.push(`\n\n[IMAGE LAYOUT]\n${imageDescriptions.join('\n')}`);

  // Temporal metadata
  parts.push(`\n\n[TEMPORAL METADATA]`);
  parts.push(`- Keyframe index: ${keyframeIndex}`);
  parts.push(`- Window positions: [${temporalMetadata.relativeIndices.join(', ')}] relative to keyframe (0)`);
  parts.push(`- Timestamps (ms): [${temporalMetadata.timestamps.join(', ')}]`);
  if (temporalMetadata.deltaMs.length > 0) {
    parts.push(`- Delta between frames (ms): [${temporalMetadata.deltaMs.join(', ')}]`);
  }

  // Preprocessing diagnostics
  if (diagnostics) {
    if (diagnostics.preprocessFallback) {
      parts.push(`\n[NOTE: Preprocessing fallback active - ${diagnostics.fallbackReason}. Some visual aids may be missing.]`);
    }
    if (diagnostics.ssimScores && diagnostics.ssimScores.length > 0) {
      const avgSsim = diagnostics.ssimScores.reduce((a, b) => a + b, 0) / diagnostics.ssimScores.length;
      parts.push(`- SSIM between consecutive frames: [${diagnostics.ssimScores.map(s => s.toFixed(3)).join(', ')}] (avg: ${avgSsim.toFixed(3)})`);
    }
  }

  return parts.join('\n');
}
