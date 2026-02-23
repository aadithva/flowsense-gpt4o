import { z } from 'zod';

export const rubricScoreSchema = z.number().int().min(0).max(2);

export const rubricScoresSchema = z.object({
  cat1: rubricScoreSchema,
  cat2: rubricScoreSchema,
  cat3: rubricScoreSchema,
  cat4: rubricScoreSchema,
  cat5: rubricScoreSchema,
  cat6: rubricScoreSchema,
  cat7: rubricScoreSchema,
});

export const justificationsSchema = z.object({
  cat1: z.string(),
  cat2: z.string(),
  cat3: z.string(),
  cat4: z.string(),
  cat5: z.string(),
  cat6: z.string(),
  cat7: z.string(),
});

export const issueTagSchema = z.enum([
  'dead_click',
  'delayed_response',
  'ambiguous_response',
  'missing_spinner',
  'unclear_disabled_state',
  'no_progress_feedback',
  'misleading_affordance',
  'surprise_navigation',
  'mode_switch_surprise',
  'backtracking',
  'repeated_actions',
  'context_loss',
  'silent_error',
  'blocking_error',
  'recovery_unclear',
  'jarring_transition',
  'distracting_animation',
  'focus_confusion',
  'too_many_steps',
  'over_clicking',
  'excessive_cursor_travel',
  'redundant_confirmations',
]);

export const suggestionSchema = z.object({
  severity: z.enum(['high', 'med', 'low']),
  title: z.string(),
  description: z.string(),
});

export const flowOverviewSchema = z.object({
  app_context: z.string(),
  user_intent: z.string(),
  actions_observed: z.string(),
});

/** Schema for synthesized video-level flow description */
export const videoFlowDescriptionSchema = z.object({
  application: z.string(),
  user_intent: z.string(),
  key_actions: z.array(z.string()),
  flow_narrative: z.string(),
  synthesis_confidence: z.number().min(0).max(1),
});

export const visionAnalysisResponseSchema = z.object({
  flow_overview: flowOverviewSchema.optional(),
  rubric_scores: rubricScoresSchema,
  justifications: justificationsSchema,
  issue_tags: z.array(issueTagSchema),
  suggestions: z.array(suggestionSchema),
});

export const analysisStatusSchema = z.enum([
  'uploaded',
  'queued',
  'processing',
  'cancel_requested',
  'completed',
  'failed',
  'cancelled',
]);

export const createRunSchema = z.object({
  title: z.string().min(1).max(255),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
});

export const enqueueJobSchema = z.object({
  run_id: z.string().uuid(),
});
