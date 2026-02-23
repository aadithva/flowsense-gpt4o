/**
 * Two-Pass Inference Module
 * V3 Accuracy Upgrade - Day 5-6: Two-Pass Inference + Calibration Heuristics
 *
 * Pass A: Structured interaction extraction
 * Pass B: Rubric scoring conditioned on Pass A output
 */

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
  type InteractionExtraction,
  interactionExtractionSchema,
  type TwoPassConfig,
  type TwoPassResult,
  type RerunMetrics,
  DEFAULT_TWO_PASS_CONFIG,
  formatExtractionForPassB,
  shouldRerun,
  mergeRubricScores,
  mergeIssueTags,
  calculateCoercionRate,
  type TemporalWindowMetadata,
  type PreprocessingDiagnostics,
} from '@interactive-flow/shared';

import { getEnv, getPreprocessingConfig, getTwoPassConfig } from './env';

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

// =============================================================================
// Pass A: Structured Interaction Extraction
// =============================================================================

const PASS_A_PROMPT = `You are a UX interaction analyzer. Examine the provided screenshot(s) and extract structured information about the user interaction shown.

Analyze the frames and identify:
1. What user ACTION/COMMAND is being performed (click, hover, type, scroll, etc.)
2. What WIDGET is the target (button, input, dropdown, menu, etc.)
3. What STATE CHANGES occur as a result
4. How quickly the system RESPONDS
5. What APPLICATION/PLATFORM is being used (be SPECIFIC - e.g., "Microsoft Copilot", "ChatGPT", "VS Code")

PLATFORM RECOGNITION:
- Microsoft Copilot: Look for Microsoft branding, Bing results, "Copilot" text, Edge sidebar, citation pills, streaming text
- ChatGPT: OpenAI branding, GPT mentions
- Claude: Anthropic branding
- Google Gemini/Bard: Google branding
- If streaming text with citations → AI assistant interface

Respond with ONLY valid JSON matching this schema:
{
  "command": "click|double_click|right_click|hover|scroll|type|drag|select|toggle|navigate|submit|cancel|expand|collapse|unknown",
  "commandConfidence": 0.0-1.0,
  "targetWidget": "button|link|input_text|input_checkbox|input_radio|dropdown|menu|tab|modal|tooltip|card|list_item|icon|image|video_player|slider|toggle|progress|loading|notification|form|table|navigation|header|footer|sidebar|unknown",
  "targetLabel": "optional text label of target",
  "stateChanges": ["visibility_show|visibility_hide|content_update|style_change|position_change|focus_gained|focus_lost|selection_change|loading_start|loading_end|error_show|error_clear|navigation|modal_open|modal_close|dropdown_open|dropdown_close|animation_start|animation_end|no_change"],
  "responseLatency": "none|fast|medium|slow|timeout",
  "feedbackVisible": true/false,
  "errorDetected": true/false,
  "overallConfidence": 0.0-1.0,
  "observations": "Brief description of what you observe in the frames",
  "flowOverview": {
    "appContext": "Specific application/platform (e.g., 'Microsoft Copilot in Edge', 'ChatGPT web interface')",
    "userIntent": "What the user is trying to accomplish (e.g., 'Asking about MSFT stock performance')",
    "actionsObserved": "Brief description of key actions (e.g., 'User typed query, AI streaming response')"
  }
}`;

/**
 * Execute Pass A: Extract structured interaction information
 */
async function executePassA(
  imageBuffers: Buffer[],
  context: {
    temporalMetadata?: TemporalWindowMetadata;
    changeContext?: FrameChangeContext;
  },
  config: TwoPassConfig
): Promise<{
  extraction: InteractionExtraction;
  tokensUsed: number;
  durationMs: number;
  coercionRate: number;
}> {
  const startTime = Date.now();

  // Build image content
  const imageContents = imageBuffers.map((buffer, idx) => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      detail: idx === 0 ? 'high' as const : 'low' as const,
    },
  }));

  // Build context notes
  let contextNote = '';
  if (context.temporalMetadata) {
    contextNote += `\n\n[TEMPORAL CONTEXT]\nTimestamps (ms): [${context.temporalMetadata.timestamps.join(', ')}]`;
  }
  if (context.changeContext) {
    contextNote += formatChangeContextForPrompt(context.changeContext);
  }

  const response = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    messages: [
      {
        role: 'system',
        content: 'You are a UX interaction analyzer. Respond with ONLY valid JSON, no other text.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${PASS_A_PROMPT}${contextNote}` },
          ...imageContents,
        ],
      },
    ],
    max_tokens: config.passATokenBudget,
    temperature: 0.2, // Lower temperature for more consistent extraction
    response_format: { type: 'json_object' },
  });

  const tokensUsed = response.usage?.total_tokens ?? 0;
  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from Pass A');
  }

  const parsed = JSON.parse(content);
  const validated = interactionExtractionSchema.safeParse(parsed);

  let extraction: InteractionExtraction;
  let coercionRate = 0;

  if (validated.success) {
    extraction = validated.data;
  } else {
    // Normalize/coerce the extraction
    const coercedFields: string[] = [];

    extraction = {
      command: normalizeEnum(parsed.command, 'unknown', ['click', 'double_click', 'right_click', 'hover', 'scroll', 'type', 'drag', 'select', 'toggle', 'navigate', 'submit', 'cancel', 'expand', 'collapse', 'unknown'], coercedFields, 'command'),
      commandConfidence: normalizeNumber(parsed.commandConfidence, 0.5, 0, 1, coercedFields, 'commandConfidence'),
      targetWidget: normalizeEnum(parsed.targetWidget, 'unknown', ['button', 'link', 'input_text', 'input_checkbox', 'input_radio', 'dropdown', 'menu', 'tab', 'modal', 'tooltip', 'card', 'list_item', 'icon', 'image', 'video_player', 'slider', 'toggle', 'progress', 'loading', 'notification', 'form', 'table', 'navigation', 'header', 'footer', 'sidebar', 'unknown'], coercedFields, 'targetWidget'),
      targetLabel: typeof parsed.targetLabel === 'string' ? parsed.targetLabel : undefined,
      stateChanges: normalizeStateChanges(parsed.stateChanges, coercedFields),
      responseLatency: normalizeEnum(parsed.responseLatency, 'none', ['none', 'fast', 'medium', 'slow', 'timeout'], coercedFields, 'responseLatency') as InteractionExtraction['responseLatency'],
      feedbackVisible: typeof parsed.feedbackVisible === 'boolean' ? parsed.feedbackVisible : false,
      errorDetected: typeof parsed.errorDetected === 'boolean' ? parsed.errorDetected : false,
      overallConfidence: normalizeNumber(parsed.overallConfidence, 0.5, 0, 1, coercedFields, 'overallConfidence'),
      observations: typeof parsed.observations === 'string' ? parsed.observations : 'Extraction incomplete',
    };

    coercionRate = calculateCoercionRate(10, coercedFields.length); // 10 total fields
    console.warn(`[TwoPass] Pass A coerced ${coercedFields.length} fields: ${coercedFields.join(', ')}`);
  }

  return {
    extraction,
    tokensUsed,
    durationMs: Date.now() - startTime,
    coercionRate,
  };
}

// =============================================================================
// Pass B: Conditioned Rubric Scoring
// =============================================================================

const PASS_B_PROMPT_PREFIX = `You are a UX interaction-flow evaluator. Analyze the provided screenshot(s) and score the interaction quality.

IMPORTANT: Use the Pass A extraction context below to inform your scoring. The extraction provides objective observations about what interaction is occurring.

`;

/**
 * Execute Pass B: Rubric scoring conditioned on Pass A
 */
async function executePassB(
  imageBuffers: Buffer[],
  extraction: InteractionExtraction,
  context: {
    priorContext?: string;
    changeContext?: FrameChangeContext;
  },
  config: TwoPassConfig
): Promise<{
  analysis: {
    rubric_scores: Record<string, number>;
    justifications: Record<string, string>;
    issue_tags: string[];
    suggestions: Array<{ severity: 'high' | 'med' | 'low'; title: string; description: string }>;
  };
  tokensUsed: number;
  durationMs: number;
  coercionRate: number;
  confidence: number;
}> {
  const startTime = Date.now();
  const preprocessingConfig = getPreprocessingConfig();

  // Build image content (only first image at high detail for Pass B)
  const imageContents = imageBuffers.slice(0, 1).map(buffer => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      detail: 'high' as const,
    },
  }));

  // Format Pass A extraction for context
  const extractionContext = formatExtractionForPassB(extraction);

  // Build prior context note
  const priorNote = context.priorContext
    ? `\n\nContext from previous frames:\n${context.priorContext}`
    : '';

  // Build change context note
  const changeNote = preprocessingConfig.includeChangeContext && context.changeContext
    ? formatChangeContextForPrompt(context.changeContext)
    : '';

  const fullPrompt = `${PASS_B_PROMPT_PREFIX}${extractionContext}${priorNote}${changeNote}\n\n${VISION_MODEL_PROMPT}\n\nAnalyze the image and respond with ONLY the JSON object.`;

  const response = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    messages: [
      {
        role: 'system',
        content: 'You are a UX interaction-flow evaluator. Respond with ONLY valid JSON, no other text.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: fullPrompt },
          ...imageContents,
        ],
      },
    ],
    max_tokens: config.passBTokenBudget,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const tokensUsed = response.usage?.total_tokens ?? 0;
  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from Pass B');
  }

  const parsed = JSON.parse(content);
  const validated = visionAnalysisResponseSchema.safeParse(parsed);

  let analysis: {
    rubric_scores: Record<string, number>;
    justifications: Record<string, string>;
    issue_tags: string[];
    suggestions: Array<{ severity: 'high' | 'med' | 'low'; title: string; description: string }>;
  };
  let coercionRate = 0;

  if (validated.success) {
    analysis = validated.data;
  } else {
    // Normalize/coerce the analysis
    const coercedFields: string[] = [];
    analysis = normalizePassBAnalysis(parsed, coercedFields);
    coercionRate = calculateCoercionRate(14, coercedFields.length); // 7 scores + 7 justifications
    console.warn(`[TwoPass] Pass B coerced ${coercedFields.length} fields`);
  }

  // Calculate confidence based on extraction confidence and justification quality
  const avgScore = Object.values(analysis.rubric_scores).reduce((a, b) => a + b, 0) / 7;
  const justificationQuality = Object.values(analysis.justifications)
    .filter(j => j.length > 20 && !j.includes('Analysis') && !j.includes('failed'))
    .length / 7;
  const confidence = (extraction.overallConfidence * 0.4) + (justificationQuality * 0.4) + ((1 - coercionRate) * 0.2);

  return {
    analysis,
    tokensUsed,
    durationMs: Date.now() - startTime,
    coercionRate,
    confidence,
  };
}

// =============================================================================
// Main Two-Pass Pipeline
// =============================================================================

export interface TwoPassContext {
  temporalMetadata?: TemporalWindowMetadata;
  priorContextTrail?: string;
  changeContext?: FrameChangeContext;
  diagnostics?: PreprocessingDiagnostics;
  keyframeIndex: number;
}

/**
 * Execute full two-pass inference with self-consistency reruns
 */
export async function executeTwoPassInference(
  rawStrip: Buffer,
  diffHeatmapStrip: Buffer | undefined,
  changeCrop: Buffer | undefined,
  context: TwoPassContext,
  engineVersion: AnalysisEngineVersion = ANALYSIS_ENGINE_VERSIONS.V3_HYBRID,
  checkCancellation?: () => Promise<void>
): Promise<TwoPassResult> {
  const config = getTwoPassConfig();
  const telemetry = createEmptyFrameTelemetry(engineVersion);

  // Collect image buffers for analysis
  const imageBuffers: Buffer[] = [rawStrip];
  if (diffHeatmapStrip) imageBuffers.push(diffHeatmapStrip);
  if (changeCrop) imageBuffers.push(changeCrop);

  const rerunMetrics: RerunMetrics = {
    rerunCount: 0,
    rerunReasons: [],
    confidenceHistory: [],
    mergeStrategy: 'first_valid',
  };

  let bestExtraction: InteractionExtraction | null = null;
  let bestPassBResult: Awaited<ReturnType<typeof executePassB>> | null = null;
  const passBResults: Array<{
    scores: Record<string, number>;
    confidence: number;
    coercionRate: number;
    issueTags: string[];
  }> = [];

  let passATokensTotal = 0;
  let passBTokensTotal = 0;
  let passAMsTotal = 0;
  let passBMsTotal = 0;
  let currentRerunCount = 0;

  console.log(`[TwoPass] Starting two-pass inference for keyframe ${context.keyframeIndex}`);

  // Execute Pass A (with potential reruns)
  while (currentRerunCount <= config.maxRerunsPerFrame) {
    // Check for cancellation before each AI call
    if (checkCancellation) await checkCancellation();

    try {
      const passAResult = await executePassA(
        imageBuffers,
        {
          temporalMetadata: context.temporalMetadata,
          changeContext: context.changeContext,
        },
        config
      );

      passATokensTotal += passAResult.tokensUsed;
      passAMsTotal += passAResult.durationMs;

      console.log(`[TwoPass] Pass A complete: command=${passAResult.extraction.command}, confidence=${passAResult.extraction.overallConfidence.toFixed(2)}, coercion=${passAResult.coercionRate.toFixed(2)}`);

      // Check if rerun is needed
      const rerunCheck = shouldRerun(
        passAResult.extraction.overallConfidence,
        passAResult.coercionRate,
        currentRerunCount,
        config
      );

      if (rerunCheck.shouldRerun && rerunCheck.reason) {
        rerunMetrics.rerunCount++;
        rerunMetrics.rerunReasons.push(rerunCheck.reason);
        rerunMetrics.confidenceHistory.push(passAResult.extraction.overallConfidence);
        currentRerunCount++;
        console.log(`[TwoPass] Triggering Pass A rerun (${currentRerunCount}/${config.maxRerunsPerFrame}): ${rerunCheck.reason}`);
        continue;
      }

      // Accept this extraction
      bestExtraction = passAResult.extraction;
      rerunMetrics.confidenceHistory.push(passAResult.extraction.overallConfidence);
      break;

    } catch (error) {
      console.error(`[TwoPass] Pass A error:`, error);
      if (currentRerunCount < config.maxRerunsPerFrame) {
        rerunMetrics.rerunCount++;
        rerunMetrics.rerunReasons.push('extraction_failed');
        currentRerunCount++;
        continue;
      }
      throw error;
    }
  }

  if (!bestExtraction) {
    throw new Error('Pass A failed after all retries');
  }

  // Execute Pass B (with potential reruns)
  currentRerunCount = 0;
  while (currentRerunCount <= config.maxRerunsPerFrame) {
    // Check for cancellation before each AI call
    if (checkCancellation) await checkCancellation();

    try {
      const passBResult = await executePassB(
        imageBuffers,
        bestExtraction,
        {
          priorContext: context.priorContextTrail,
          changeContext: context.changeContext,
        },
        config
      );

      passBTokensTotal += passBResult.tokensUsed;
      passBMsTotal += passBResult.durationMs;

      passBResults.push({
        scores: passBResult.analysis.rubric_scores,
        confidence: passBResult.confidence,
        coercionRate: passBResult.coercionRate,
        issueTags: passBResult.analysis.issue_tags,
      });

      console.log(`[TwoPass] Pass B complete: confidence=${passBResult.confidence.toFixed(2)}, coercion=${passBResult.coercionRate.toFixed(2)}`);

      // Check if rerun is needed
      const rerunCheck = shouldRerun(
        passBResult.confidence,
        passBResult.coercionRate,
        currentRerunCount,
        config
      );

      if (rerunCheck.shouldRerun && rerunCheck.reason) {
        currentRerunCount++;
        console.log(`[TwoPass] Triggering Pass B rerun (${currentRerunCount}/${config.maxRerunsPerFrame}): ${rerunCheck.reason}`);
        continue;
      }

      // Accept this result
      bestPassBResult = passBResult;
      break;

    } catch (error) {
      console.error(`[TwoPass] Pass B error:`, error);
      if (currentRerunCount < config.maxRerunsPerFrame) {
        currentRerunCount++;
        continue;
      }
      throw error;
    }
  }

  if (!bestPassBResult) {
    throw new Error('Pass B failed after all retries');
  }

  // Merge results if we have multiple runs
  let finalScores = bestPassBResult.analysis.rubric_scores;
  let finalIssueTags = bestPassBResult.analysis.issue_tags;

  if (passBResults.length > 1) {
    const mergeResult = mergeRubricScores(passBResults);
    finalScores = mergeResult.mergedScores;
    rerunMetrics.mergeStrategy = mergeResult.strategy;
    finalIssueTags = mergeIssueTags(passBResults.map(r => r.issueTags));
    console.log(`[TwoPass] Merged ${passBResults.length} Pass B results using ${mergeResult.strategy}`);
  }

  // Convert flowOverview from extraction to flow_overview for rubricAnalysis
  const flow_overview = bestExtraction.flowOverview ? {
    app_context: bestExtraction.flowOverview.appContext,
    user_intent: bestExtraction.flowOverview.userIntent,
    actions_observed: bestExtraction.flowOverview.actionsObserved,
  } : undefined;

  return {
    extraction: bestExtraction,
    rubricAnalysis: {
      rubric_scores: finalScores,
      justifications: bestPassBResult.analysis.justifications,
      issue_tags: finalIssueTags,
      suggestions: bestPassBResult.analysis.suggestions,
      flow_overview,
    },
    telemetry: {
      passATokens: passATokensTotal,
      passBTokens: passBTokensTotal,
      totalTokens: passATokensTotal + passBTokensTotal,
      passAMs: passAMsTotal,
      passBMs: passBMsTotal,
      totalMs: passAMsTotal + passBMsTotal,
      rerunMetrics,
    },
    schemaNormalized: bestPassBResult.coercionRate > 0,
  };
}

// =============================================================================
// Normalization Helpers
// =============================================================================

function normalizeEnum<T extends string>(
  value: unknown,
  defaultValue: T,
  validValues: T[],
  coercedFields: string[],
  fieldName: string
): T {
  if (typeof value === 'string' && validValues.includes(value as T)) {
    return value as T;
  }
  coercedFields.push(fieldName);
  return defaultValue;
}

function normalizeNumber(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
  coercedFields: string[],
  fieldName: string
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, value));
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  coercedFields.push(fieldName);
  return defaultValue;
}

function normalizeStateChanges(value: unknown, coercedFields: string[]): InteractionExtraction['stateChanges'] {
  const validChanges = [
    'visibility_show', 'visibility_hide', 'content_update', 'style_change',
    'position_change', 'focus_gained', 'focus_lost', 'selection_change',
    'loading_start', 'loading_end', 'error_show', 'error_clear',
    'navigation', 'modal_open', 'modal_close', 'dropdown_open', 'dropdown_close',
    'animation_start', 'animation_end', 'no_change',
  ];

  if (Array.isArray(value)) {
    const filtered = value.filter(v => typeof v === 'string' && validChanges.includes(v));
    if (filtered.length !== value.length) {
      coercedFields.push('stateChanges');
    }
    return filtered.length > 0 ? filtered as InteractionExtraction['stateChanges'] : ['no_change'];
  }

  coercedFields.push('stateChanges');
  return ['no_change'];
}

function normalizePassBAnalysis(
  parsed: any,
  coercedFields: string[]
): {
  rubric_scores: Record<string, number>;
  justifications: Record<string, string>;
  issue_tags: string[];
  suggestions: Array<{ severity: 'high' | 'med' | 'low'; title: string; description: string }>;
} {
  const rawScores = parsed?.rubric_scores ?? {};
  const rawJustifications = parsed?.justifications ?? {};

  const rubric_scores: Record<string, number> = {};
  const justifications: Record<string, string> = {};

  for (let i = 1; i <= 7; i++) {
    const key = `cat${i}`;
    rubric_scores[key] = normalizeNumber(rawScores[key], 1, 0, 2, coercedFields, `scores.${key}`);
    justifications[key] = typeof rawJustifications[key] === 'string' && rawJustifications[key].trim()
      ? rawJustifications[key].trim()
      : 'Analysis incomplete';
    if (justifications[key] === 'Analysis incomplete') {
      coercedFields.push(`justifications.${key}`);
    }
  }

  const allowedTags = new Set(issueTagSchema.options as string[]);
  const issue_tags = Array.isArray(parsed?.issue_tags)
    ? parsed.issue_tags.filter((tag: unknown) => typeof tag === 'string' && allowedTags.has(tag))
    : [];

  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
        .map((s: any) => ({
          severity: (['high', 'med', 'low'].includes(s?.severity) ? s.severity : 'low') as 'high' | 'med' | 'low',
          title: typeof s?.title === 'string' && s.title.trim() ? s.title.trim() : 'Suggestion',
          description: typeof s?.description === 'string' && s.description.trim() ? s.description.trim() : '',
        }))
        .filter((s: any) => s.description)
    : [];

  return { rubric_scores, justifications, issue_tags, suggestions };
}

// =============================================================================
// Exports
// =============================================================================

export const __testing = {
  executePassA,
  executePassB,
  normalizeEnum,
  normalizeNumber,
  normalizeStateChanges,
  normalizePassBAnalysis,
};
