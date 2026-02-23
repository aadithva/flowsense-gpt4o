/**
 * Video Flow Synthesis Module
 *
 * Synthesizes a coherent video-level description from the context carry-over layer.
 * Takes accumulated frame summaries and per-frame flow_overviews to generate
 * a unified narrative of the user's journey.
 */

import OpenAI from 'openai';
import { videoFlowDescriptionSchema, type FlowOverview, type VideoFlowDescription } from '@interactive-flow/shared';
import { getEnv } from './env';

const env = getEnv();
const AZURE_OPENAI_ENDPOINT = env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT = env.AZURE_OPENAI_DEPLOYMENT;
const AZURE_OPENAI_API_VERSION = env.AZURE_OPENAI_API_VERSION;

// Initialize Azure OpenAI client (same as vision.ts)
const client = new OpenAI({
  apiKey: AZURE_OPENAI_API_KEY,
  baseURL: `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { 'api-version': AZURE_OPENAI_API_VERSION },
  defaultHeaders: { 'api-key': AZURE_OPENAI_API_KEY },
});

const VIDEO_SYNTHESIS_PROMPT = `You are a UX flow synthesizer. Your task is to create a coherent description of the ENTIRE user journey from a screen recording.

You will be given:
1. A context trail: Frame-by-frame summaries showing what happened at each analyzed moment
2. Flow overviews: Per-frame descriptions of the app context, user intent, and actions

Your job is to synthesize these into a SINGLE coherent video-level description.

=== AI PLATFORM RECOGNITION (IMPORTANT) ===
Be SPECIFIC when identifying AI assistants and chat interfaces:

MICROSOFT COPILOT:
- If you see Microsoft branding, Bing logo, "Copilot" text, or Microsoft Edge sidebar → "Microsoft Copilot"
- Features: Streaming text responses, citation pills/superscripts [1][2], stock cards, source carousels, "Learn more" sections
- User intent should capture the QUERY/PROMPT (e.g., "Asking about MSFT stock performance" not just "Using Copilot")

OTHER AI ASSISTANTS:
- ChatGPT: OpenAI branding, GPT mentions → "ChatGPT"
- Claude: Anthropic branding → "Claude AI"
- Gemini/Bard: Google branding → "Google Gemini"
- GitHub Copilot: Code suggestions in editor → "GitHub Copilot in [editor name]"

AI-SPECIFIC PATTERNS to note in key_actions:
- Streaming text generation (text appearing progressively)
- Citation pill hover/clicks
- Source card interactions
- Response regeneration
- Conversation context (follow-up questions)

OUTPUT FORMAT (respond with ONLY valid JSON):
{
  "application": "The specific application or UI being used (e.g., 'Microsoft Copilot chat interface', 'VS Code editor with Python file open')",
  "user_intent": "The user's overall goal/query across the entire video (e.g., 'Asking about MSFT stock performance and exploring cited sources')",
  "key_actions": ["Action 1", "Action 2", "Action 3", ...],  // 3-7 key actions in chronological order
  "flow_narrative": "A 2-4 sentence narrative describing the user's journey from beginning to end, including any friction points or notable moments",
  "synthesis_confidence": 0.0-1.0  // Your confidence in this synthesis based on context quality
}

GUIDELINES:
- Focus on the JOURNEY, not individual frames
- Identify the beginning state, key transitions, and end state
- Note any friction points, errors, or interruptions
- Be SPECIFIC about UI elements and actions (not generic)
- For AI chats, capture the actual query/question as part of user_intent
- If context is limited, lower your confidence score
- key_actions should be ordered chronologically and capture the main flow

EXAMPLE OUTPUT (AI Assistant):
{
  "application": "Microsoft Copilot in Edge browser",
  "user_intent": "Asking Copilot about MSFT stock performance and exploring the cited sources for more details",
  "key_actions": [
    "Typed query about MSFT stock",
    "Watched Copilot stream its response",
    "Hovered over citation pill to preview source",
    "Viewed stock card with price information",
    "Scrolled through sources section"
  ],
  "flow_narrative": "The user asked Microsoft Copilot about MSFT stock performance. Copilot streamed its response with inline citations. The user hovered over a citation pill which revealed a stock information card with current pricing. They then explored the sources section at the bottom to see the full list of web references Copilot used to generate the response.",
  "synthesis_confidence": 0.9
}`;

export interface SynthesisResult {
  description: VideoFlowDescription;
  tokensUsed: number;
  inferenceMs: number;
}

/**
 * Synthesize a video-level flow description from context trail and flow overviews
 */
export async function synthesizeVideoFlow(
  contextTrail: string[],
  flowOverviews: FlowOverview[]
): Promise<SynthesisResult> {
  const startTime = Date.now();

  // Build input for the AI
  const input = {
    context_trail: contextTrail,
    flow_overviews: flowOverviews.map(fo => ({
      app_context: fo.app_context,
      user_intent: fo.user_intent,
      actions_observed: fo.actions_observed,
    })),
  };

  console.log(`[FlowSynthesis] Synthesizing video description from ${contextTrail.length} context items and ${flowOverviews.length} flow overviews`);

  try {
    const response = await client.chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: 'system',
          content: 'You synthesize UX flow descriptions from frame-by-frame analysis. Respond with ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `${VIDEO_SYNTHESIS_PROMPT}\n\nINPUT DATA:\n${JSON.stringify(input, null, 2)}`,
        },
      ],
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const tokensUsed = response.usage?.total_tokens ?? 0;
    const inferenceMs = Date.now() - startTime;
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from Azure OpenAI for flow synthesis');
    }

    console.log(`[FlowSynthesis] Response received (${tokensUsed} tokens, ${inferenceMs}ms)`);

    // Parse and validate
    const parsed = JSON.parse(content);
    const validated = videoFlowDescriptionSchema.safeParse(parsed);

    if (validated.success) {
      console.log(`[FlowSynthesis] Synthesis complete: "${validated.data.application}" - confidence ${validated.data.synthesis_confidence}`);
      return {
        description: validated.data,
        tokensUsed,
        inferenceMs,
      };
    }

    // Attempt normalization
    console.warn('[FlowSynthesis] Schema validation failed, attempting normalization:', validated.error.issues);
    const normalized = normalizeDescription(parsed);
    const normalizedValidation = videoFlowDescriptionSchema.safeParse(normalized);

    if (normalizedValidation.success) {
      console.warn('[FlowSynthesis] Normalized description accepted');
      return {
        description: normalizedValidation.data,
        tokensUsed,
        inferenceMs,
      };
    }

    throw new Error('Flow synthesis response did not match schema');
  } catch (error) {
    console.error('[FlowSynthesis] Synthesis error:', error);

    // Return fallback description
    const fallback = createFallbackDescription(contextTrail, flowOverviews);
    return {
      description: fallback,
      tokensUsed: 0,
      inferenceMs: Date.now() - startTime,
    };
  }
}

/**
 * Normalize a potentially malformed AI response
 */
function normalizeDescription(raw: any): VideoFlowDescription {
  return {
    application: typeof raw?.application === 'string' ? raw.application.trim() : 'Unknown application',
    user_intent: typeof raw?.user_intent === 'string' ? raw.user_intent.trim() : 'Unknown intent',
    key_actions: Array.isArray(raw?.key_actions)
      ? raw.key_actions.filter((a: unknown) => typeof a === 'string').map((a: string) => a.trim())
      : [],
    flow_narrative: typeof raw?.flow_narrative === 'string' ? raw.flow_narrative.trim() : 'Unable to synthesize narrative.',
    synthesis_confidence: typeof raw?.synthesis_confidence === 'number'
      ? Math.max(0, Math.min(1, raw.synthesis_confidence))
      : 0.5,
  };
}

/**
 * Create a fallback description when synthesis fails
 */
function createFallbackDescription(contextTrail: string[], flowOverviews: FlowOverview[]): VideoFlowDescription {
  // Try to extract app context from flow overviews
  const appContexts = flowOverviews
    .map(fo => fo.app_context)
    .filter(Boolean);
  const application = appContexts.length > 0 ? appContexts[0] : 'Unknown application';

  // Try to extract user intent
  const intents = flowOverviews
    .map(fo => fo.user_intent)
    .filter(Boolean);
  const user_intent = intents.length > 0 ? intents[0] : 'Unable to determine user intent';

  // Extract actions from context trail
  const key_actions = contextTrail
    .slice(0, 5)
    .map(line => {
      const match = line.match(/t=\d+ms:\s*(.+?)(?:\.\s*Issues:|$)/);
      return match ? match[1].trim() : null;
    })
    .filter((a): a is string => a !== null);

  return {
    application,
    user_intent,
    key_actions: key_actions.length > 0 ? key_actions : ['Analysis in progress'],
    flow_narrative: 'Video flow synthesis was not available. Please refer to individual frame analyses for details.',
    synthesis_confidence: 0,
  };
}
