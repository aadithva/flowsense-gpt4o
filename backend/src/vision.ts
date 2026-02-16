import OpenAI from 'openai';
import { VISION_MODEL_PROMPT, issueTagSchema, visionAnalysisResponseSchema } from '@interactive-flow/shared';

// Azure OpenAI Configuration
import { getEnv } from './env';

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

  const issue_tags = Array.isArray(raw?.issue_tags)
    ? raw.issue_tags.filter((tag: unknown) => typeof tag === 'string' && ALLOWED_ISSUE_TAGS.has(tag))
    : [];

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

  return { rubric_scores, justifications, issue_tags, suggestions };
}

export async function analyzeFrame(
  frameBuffer: Buffer,
  context?: {
    sequence?: { count: number; order: string; timestampsMs?: number[] };
    priorContext?: string;
  }
) {
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

  try {
    console.log(`[Vision] Analyzing frame with Azure OpenAI GPT-4o (deployment: ${AZURE_OPENAI_DEPLOYMENT})`);

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
              text: `${VISION_MODEL_PROMPT}${sequenceNote}${priorNote}\n\nAnalyze the image and respond with ONLY the JSON object, no other text.`,
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

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from Azure OpenAI');
    }

    console.log(`[Vision] Raw response length: ${content.length} characters`);
    console.log(`[Vision] Token usage: ${response.usage?.total_tokens} total (${response.usage?.prompt_tokens} prompt, ${response.usage?.completion_tokens} completion)`);

    // Parse and validate JSON response
    const parsed = JSON.parse(content);
    const validated = visionAnalysisResponseSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }

    console.warn('[Vision] Schema validation failed, attempting normalization:', validated.error.issues);
    const normalized = normalizeAnalysis(parsed);
    const normalizedValidation = visionAnalysisResponseSchema.safeParse(normalized);
    if (normalizedValidation.success) {
      console.warn('[Vision] Normalized analysis accepted');
      return normalizedValidation.data;
    }

    console.error('[Vision] Normalized analysis still invalid:', normalizedValidation.error.issues);
    throw new Error('Vision response did not match schema');
  } catch (error) {
    console.error('[Vision] Analysis error:', error);
    if (error instanceof Error) {
      console.error('[Vision] Error message:', error.message);
      console.error('[Vision] Error stack:', error.stack);
    }

    // Return default scores if analysis fails
    return {
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
    };
  }
}
