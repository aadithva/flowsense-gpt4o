import { getFrameAnalysesForRun } from './azure-db';
import {
  RUBRIC_WEIGHTS,
  type RubricScores,
  type TopIssue,
  type Recommendation,
  type IssueTag,
  type AnalysisEngineVersion,
  type RunAnalysisTelemetry,
  type VideoFlowDescription,
  ANALYSIS_ENGINE_VERSIONS,
  // V3 Summary types
  type TokenUsage,
  type EvidenceCoverage,
  type SelfConsistencyMetrics,
  type ShadowAnalysisDiff,
  type FallbackApplied,
  type SummaryV3Extension,
  calculateEvidenceCoverage,
  calculateSelfConsistencyScore,
  computeShadowDiff,
  applyDeterministicFallbacks,
} from '@interactive-flow/shared';
import { getAnalysisConfig } from './env';

interface FrameAnalysis {
  frame_id: string;  // From frame_analyses table join
  rubric_scores: RubricScores;
  issue_tags: IssueTag[];
  justifications: Record<string, string>;
  suggestions: unknown[];
  flow_overview?: {
    app_context: string;
    user_intent: string;
    actions_observed: string;
  };
}

const METRIC_VERSION = 'v2';

/**
 * Get the current analysis engine version from configuration
 */
export function getActiveEngineVersion(): AnalysisEngineVersion {
  const config = getAnalysisConfig();
  return config.activeEngine;
}
const SCORE_CATEGORIES = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7'] as const;

type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export function determineSeverity(tag: IssueTag): 'high' | 'med' | 'low' {
  const highSeverity: IssueTag[] = ['dead_click', 'silent_error', 'blocking_error', 'unclear_disabled_state'];
  const medSeverity: IssueTag[] = [
    'delayed_response',
    'missing_spinner',
    'misleading_affordance',
    'backtracking',
    'no_progress_feedback',
  ];

  if (highSeverity.includes(tag)) return 'high';
  if (medSeverity.includes(tag)) return 'med';
  return 'low';
}

function getIssueDescription(tag: IssueTag): string {
  const descriptions: Record<IssueTag, string> = {
    dead_click: 'User clicks but no visible response occurs',
    delayed_response: 'Significant delay between action and response',
    ambiguous_response: 'Response to action is unclear or confusing',
    missing_spinner: 'No loading indicator during wait states',
    unclear_disabled_state: 'Disabled elements not visually distinct',
    no_progress_feedback: 'Long operations lack progress indication',
    misleading_affordance: 'Visual design suggests wrong interaction',
    surprise_navigation: 'Unexpected navigation or page changes',
    mode_switch_surprise: 'Unexpected mode or context changes',
    backtracking: 'User forced to repeat previous steps',
    repeated_actions: 'Same action performed multiple times',
    context_loss: 'User loses context between steps',
    silent_error: 'Errors occur without notification',
    blocking_error: 'Error prevents progress without clear solution',
    recovery_unclear: 'Error recovery path not obvious',
    jarring_transition: 'Abrupt or disruptive visual transitions',
    distracting_animation: 'Animations draw focus inappropriately',
    focus_confusion: 'Focus management unclear or broken',
    too_many_steps: 'Task requires excessive steps',
    over_clicking: 'Multiple clicks needed for single action',
    excessive_cursor_travel: 'Large cursor movements required',
    redundant_confirmations: 'Unnecessary confirmation dialogs',
  };

  return descriptions[tag] || 'Issue detected';
}

function calculateCategoryConfidence(analyses: FrameAnalysis[], category: ScoreCategory): number {
  const total = analyses.length;
  if (!total) return 0.5;

  const scores = analyses.map((analysis) => analysis.rubric_scores[category] ?? 0);
  const mean = scores.reduce((sum, score) => sum + score, 0) / total;
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / total;
  const stdDev = Math.sqrt(variance);

  const justificationsWithEvidence = analyses.filter((analysis) => {
    const text = analysis.justifications?.[category] || '';
    return Boolean(text.trim()) && !/^analysis failed$/i.test(text.trim());
  }).length;

  const coverage = justificationsWithEvidence / total;
  const consistency = Math.max(0, 1 - stdDev / 1.0);

  return Number((coverage * 0.6 + consistency * 0.4).toFixed(3));
}

export function calculateWeightedScore100(scores: RubricScores): number {
  let weighted = 0;

  for (const category of SCORE_CATEGORIES) {
    const normalized = (scores[category] ?? 0) / 2;
    weighted += normalized * RUBRIC_WEIGHTS[category];
  }

  return Number(weighted.toFixed(2));
}

function calculateCriticalIssueCount(topIssues: TopIssue[]): number {
  return topIssues.filter((issue) => issue.severity === 'high').reduce((sum, issue) => sum + issue.count, 0);
}

export function determineQualityGateStatus(weightedScore100: number, criticalIssueCount: number): 'pass' | 'warn' | 'block' {
  if (criticalIssueCount > 0 || weightedScore100 < 65) {
    return 'block';
  }

  if (weightedScore100 < 80) {
    return 'warn';
  }

  return 'pass';
}

function generateRecommendations(topIssues: TopIssue[], scores: RubricScores): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Helper to get aggregated frame IDs from related issues
  const getSourceFrameIds = (issueTags: IssueTag[]): string[] => {
    const frameIds = new Set<string>();
    for (const tag of issueTags) {
      const issue = topIssues.find(i => i.tag === tag);
      if (issue?.sourceFrameIds) {
        issue.sourceFrameIds.forEach(id => frameIds.add(id));
      }
    }
    return Array.from(frameIds);
  };

  if (scores.cat1 < 2) {
    const relatedIssues = topIssues
      .filter((issue) => ['dead_click', 'delayed_response', 'ambiguous_response'].includes(issue.tag))
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Action → Response Integrity',
        priority: 'high',
        title: 'Improve action feedback',
        description:
          'Add immediate visual feedback for all user actions. Show pressed states on buttons, disable re-clicking during operations, and provide toast or inline confirmations.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  if (scores.cat2 < 2) {
    const relatedIssues = topIssues
      .filter((issue) => ['missing_spinner', 'no_progress_feedback'].includes(issue.tag))
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Feedback & System Status Visibility',
        priority: 'high',
        title: 'Add loading states and progress indicators',
        description:
          'Show skeleton screens or spinners during loading. Display progress text for long operations. Disable CTAs with explanatory tooltips when actions are unavailable.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  if (scores.cat3 < 2) {
    const relatedIssues = topIssues
      .filter((issue) => ['misleading_affordance', 'unclear_disabled_state'].includes(issue.tag))
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Interaction Predictability & Affordance',
        priority: 'med',
        title: 'Clarify visual affordances',
        description:
          'Update button styles, hover states, and cursor indicators to match expected interactions. Make disabled states visually distinct with reduced opacity and explanatory tooltips.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  if (scores.cat4 < 2) {
    const relatedIssues = topIssues
      .filter((issue) => ['backtracking', 'repeated_actions', 'context_loss'].includes(issue.tag))
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Flow Continuity & Friction',
        priority: 'med',
        title: 'Reduce friction in task flow',
        description:
          'Remove redundant steps, preserve form state between pages, and keep context visible throughout the flow. Consider combining multiple steps into a single view.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  if (scores.cat5 < 2) {
    const relatedIssues = topIssues
      .filter((issue) => ['silent_error', 'blocking_error', 'recovery_unclear'].includes(issue.tag))
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Error Handling & Recovery',
        priority: 'high',
        title: 'Improve error messaging and recovery',
        description:
          'Make all errors visible with actionable messages. Provide inline fix suggestions, retry buttons, and learn-more links.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  if (scores.cat6 < 2) {
    const relatedIssues = topIssues
      .filter((issue) => ['jarring_transition', 'focus_confusion', 'distracting_animation'].includes(issue.tag))
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Micro-interaction Quality',
        priority: 'low',
        title: 'Polish transitions and focus management',
        description:
          'Add smooth transitions between states, manage focus properly after actions, and reduce layout shift. Ensure animations enhance rather than distract.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  if (scores.cat7 < 2) {
    const relatedIssues = topIssues
      .filter((issue) =>
        ['too_many_steps', 'over_clicking', 'excessive_cursor_travel', 'redundant_confirmations'].includes(issue.tag)
      )
      .map((issue) => issue.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Efficiency & Interaction Cost',
        priority: 'med',
        title: 'Streamline the interaction path',
        description:
          'Reduce required steps, remove unnecessary confirmations, set better defaults, and add keyboard shortcuts for power users.',
        relatedIssues,
        sourceFrameIds: getSourceFrameIds(relatedIssues),
      });
    }
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, med: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export interface GenerateSummaryInput {
  /** Whether analysis was truncated due to token budget */
  analysisTruncated?: boolean;
  /** Number of frames skipped due to truncation */
  framesSkipped?: number;
  /** Total rerun count from two-pass inference */
  twoPassRerunCount?: number;
  /** Full run telemetry for V3 summary */
  runTelemetry?: RunAnalysisTelemetry;
  /** Average confidence from two-pass inference */
  avgConfidence?: number;
  /** Rerun reasons breakdown */
  rerunReasons?: {
    schema_coercion: number;
    low_confidence: number;
    extraction_failed: number;
  };
  /** Shadow analysis results (if shadow engine was enabled) */
  shadowAnalysis?: {
    weightedScore100: number;
    criticalIssueCount: number;
    qualityGateStatus: 'pass' | 'warn' | 'block';
    engineVersion: AnalysisEngineVersion;
  } | null;
  /** Synthesized video-level flow description from context carry-over */
  videoFlowDescription?: VideoFlowDescription;
}

export async function generateSummary(runId: string, options?: GenerateSummaryInput) {
  const analyses = (await getFrameAnalysesForRun(runId)) as FrameAnalysis[];

  if (!analyses || analyses.length === 0) {
    throw new Error('No analyses found for run');
  }

  const engineVersion = getActiveEngineVersion();
  const framesAnalyzed = options?.runTelemetry?.framesAnalyzed ?? analyses.length;

  // Aggregate flow_overview from frame analyses (use the most detailed one)
  const flowOverviews = analyses
    .filter(a => a.flow_overview)
    .map(a => a.flow_overview!);

  // Pick the flow_overview with the longest combined content
  const aggregatedFlowOverview = flowOverviews.length > 0
    ? flowOverviews.reduce((best, current) => {
        const bestLength = (best.app_context?.length || 0) + (best.user_intent?.length || 0) + (best.actions_observed?.length || 0);
        const currentLength = (current.app_context?.length || 0) + (current.user_intent?.length || 0) + (current.actions_observed?.length || 0);
        return currentLength > bestLength ? current : best;
      })
    : undefined;

  // Aggregate raw scores first
  const rawScores: Record<string, number> = {};
  for (const category of SCORE_CATEGORIES) {
    const avg = analyses.reduce((sum, analysis) => sum + (analysis.rubric_scores[category] || 0), 0) / analyses.length;
    rawScores[category] = avg;
  }

  // Aggregate justifications for fallback check
  const aggregatedJustifications: Record<string, string> = {};
  for (const category of SCORE_CATEGORIES) {
    // Use the most detailed justification (longest non-empty)
    const justifications = analyses
      .map(a => a.justifications?.[category] || '')
      .filter(j => j.trim().length > 0)
      .sort((a, b) => b.length - a.length);
    aggregatedJustifications[category] = justifications[0] || '';
  }

  // V3 Day 7: Apply deterministic fallback rules for missing analysis segments
  const { adjustedScores, fallbackApplied } = applyDeterministicFallbacks(
    rawScores,
    aggregatedJustifications,
    SCORE_CATEGORIES,
    framesAnalyzed
  );

  // Round adjusted scores to get final rubric scores
  const overallScores: RubricScores = {
    cat1: Math.round(adjustedScores.cat1 ?? 1) as 0 | 1 | 2,
    cat2: Math.round(adjustedScores.cat2 ?? 1) as 0 | 1 | 2,
    cat3: Math.round(adjustedScores.cat3 ?? 1) as 0 | 1 | 2,
    cat4: Math.round(adjustedScores.cat4 ?? 1) as 0 | 1 | 2,
    cat5: Math.round(adjustedScores.cat5 ?? 1) as 0 | 1 | 2,
    cat6: Math.round(adjustedScores.cat6 ?? 1) as 0 | 1 | 2,
    cat7: Math.round(adjustedScores.cat7 ?? 1) as 0 | 1 | 2,
  };

  // Track both count and source frame IDs for each issue tag
  const issueDataMap = new Map<IssueTag, { count: number; frameIds: string[] }>();
  for (const analysis of analyses) {
    for (const tag of analysis.issue_tags) {
      const existing = issueDataMap.get(tag) || { count: 0, frameIds: [] };
      existing.count += 1;
      if (analysis.frame_id && !existing.frameIds.includes(analysis.frame_id)) {
        existing.frameIds.push(analysis.frame_id);
      }
      issueDataMap.set(tag, existing);
    }
  }

  const topIssues: TopIssue[] = Array.from(issueDataMap.entries())
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      severity: determineSeverity(tag),
      description: getIssueDescription(tag),
      sourceFrameIds: data.frameIds,
    }))
    .sort((a, b) => {
      const severityOrder = { high: 0, med: 1, low: 2 };
      if (a.severity !== b.severity) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.count - a.count;
    })
    .slice(0, 5);

  const recommendations = generateRecommendations(topIssues, overallScores);
  const weightedScore100 = calculateWeightedScore100(overallScores);
  const criticalIssueCount = calculateCriticalIssueCount(topIssues);
  let qualityGateStatus = determineQualityGateStatus(weightedScore100, criticalIssueCount);

  // V3 Day 5-6: Force quality_gate_status='warn' when analysis was truncated
  if (options?.analysisTruncated && qualityGateStatus === 'pass') {
    qualityGateStatus = 'warn';
    console.warn(`[Summary] Quality gate downgraded to 'warn' due to analysis truncation (${options.framesSkipped} frames skipped)`);
  }

  // V3 Day 7: Force quality_gate_status='warn' if fallbacks were applied
  if (fallbackApplied.any_fallback && qualityGateStatus === 'pass') {
    qualityGateStatus = 'warn';
    console.warn(`[Summary] Quality gate downgraded to 'warn' due to fallback rules (${fallbackApplied.fallback_categories.length} categories)`);
  }

  const confidenceByCategory = {
    cat1: calculateCategoryConfidence(analyses, 'cat1'),
    cat2: calculateCategoryConfidence(analyses, 'cat2'),
    cat3: calculateCategoryConfidence(analyses, 'cat3'),
    cat4: calculateCategoryConfidence(analyses, 'cat4'),
    cat5: calculateCategoryConfidence(analyses, 'cat5'),
    cat6: calculateCategoryConfidence(analyses, 'cat6'),
    cat7: calculateCategoryConfidence(analyses, 'cat7'),
  };

  // =============================================================================
  // V3 Day 7: Calculate new metrics
  // =============================================================================

  // Token usage from telemetry
  const tokenUsage: TokenUsage = {
    prompt_tokens: options?.runTelemetry?.totalPromptTokens ?? 0,
    completion_tokens: options?.runTelemetry?.totalCompletionTokens ?? 0,
    total_tokens: options?.runTelemetry?.totalTokens ?? 0,
  };

  // Evidence coverage calculation
  const evidenceCoverage = calculateEvidenceCoverage(analyses, SCORE_CATEGORIES);

  // Self-consistency metrics
  const selfConsistency = calculateSelfConsistencyScore(
    options?.twoPassRerunCount ?? 0,
    framesAnalyzed,
    options?.avgConfidence ?? 0.8, // Default to 0.8 if not provided
    options?.rerunReasons ?? { schema_coercion: 0, low_confidence: 0, extraction_failed: 0 }
  );

  // Shadow diff computation
  const shadowDiff = computeShadowDiff(
    weightedScore100,
    criticalIssueCount,
    qualityGateStatus,
    options?.shadowAnalysis?.weightedScore100 ?? null,
    options?.shadowAnalysis?.criticalIssueCount ?? null,
    options?.shadowAnalysis?.qualityGateStatus ?? null,
    options?.shadowAnalysis?.engineVersion ?? null
  );

  // Build V3 extension
  const v3Extension: SummaryV3Extension = {
    analysis_engine_version: engineVersion,
    token_usage: tokenUsage,
    evidence_coverage: evidenceCoverage,
    self_consistency: selfConsistency,
    shadow_diff: shadowDiff,
    fallback_applied: fallbackApplied,
    analysis_truncated: options?.analysisTruncated ?? false,
    frames_skipped: options?.framesSkipped ?? 0,
    frames_analyzed: framesAnalyzed,
    schema_normalization_rate: options?.runTelemetry?.schemaNormalizationRate ?? 0,
    total_inference_ms: options?.runTelemetry?.totalInferenceMs ?? 0,
  };

  return {
    // V2 fields (backward compatible)
    overall_scores: overallScores,
    top_issues: topIssues,
    recommendations,
    weighted_score_100: weightedScore100,
    critical_issue_count: criticalIssueCount,
    quality_gate_status: qualityGateStatus,
    confidence_by_category: confidenceByCategory,
    metric_version: METRIC_VERSION,
    // Flow overview - describes what's happening in the UI (per-frame)
    flow_overview: aggregatedFlowOverview,
    // Synthesized video-level flow description (from context carry-over)
    video_flow_description: options?.videoFlowDescription,
    // V3 fields at root level for backward compatibility
    analysis_engine_version: engineVersion,
    analysis_truncated: options?.analysisTruncated ?? false,
    frames_skipped: options?.framesSkipped ?? 0,
    two_pass_rerun_count: options?.twoPassRerunCount ?? 0,
    // V3 extension object with full diagnostics
    v3: v3Extension,
  };
}

