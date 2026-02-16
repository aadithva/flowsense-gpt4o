import { getFrameAnalysesForRun } from './azure-db';
import {
  RUBRIC_WEIGHTS,
  type RubricScores,
  type TopIssue,
  type Recommendation,
  type IssueTag,
} from '@interactive-flow/shared';

interface FrameAnalysis {
  rubric_scores: RubricScores;
  issue_tags: IssueTag[];
  justifications: Record<string, string>;
  suggestions: unknown[];
}

const METRIC_VERSION = 'v2';
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
      });
    }
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, med: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export async function generateSummary(runId: string) {
  const analyses = (await getFrameAnalysesForRun(runId)) as FrameAnalysis[];

  if (!analyses || analyses.length === 0) {
    throw new Error('No analyses found for run');
  }

  const overallScores: RubricScores = {
    cat1: 0,
    cat2: 0,
    cat3: 0,
    cat4: 0,
    cat5: 0,
    cat6: 0,
    cat7: 0,
  };

  for (const category of SCORE_CATEGORIES) {
    const avg = analyses.reduce((sum, analysis) => sum + (analysis.rubric_scores[category] || 0), 0) / analyses.length;
    overallScores[category] = Math.round(avg) as 0 | 1 | 2;
  }

  const issueCountMap = new Map<IssueTag, number>();
  for (const analysis of analyses) {
    for (const tag of analysis.issue_tags) {
      issueCountMap.set(tag, (issueCountMap.get(tag) || 0) + 1);
    }
  }

  const topIssues: TopIssue[] = Array.from(issueCountMap.entries())
    .map(([tag, count]) => ({
      tag,
      count,
      severity: determineSeverity(tag),
      description: getIssueDescription(tag),
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
  const qualityGateStatus = determineQualityGateStatus(weightedScore100, criticalIssueCount);

  const confidenceByCategory = {
    cat1: calculateCategoryConfidence(analyses, 'cat1'),
    cat2: calculateCategoryConfidence(analyses, 'cat2'),
    cat3: calculateCategoryConfidence(analyses, 'cat3'),
    cat4: calculateCategoryConfidence(analyses, 'cat4'),
    cat5: calculateCategoryConfidence(analyses, 'cat5'),
    cat6: calculateCategoryConfidence(analyses, 'cat6'),
    cat7: calculateCategoryConfidence(analyses, 'cat7'),
  };

  return {
    overall_scores: overallScores,
    top_issues: topIssues,
    recommendations,
    weighted_score_100: weightedScore100,
    critical_issue_count: criticalIssueCount,
    quality_gate_status: qualityGateStatus,
    confidence_by_category: confidenceByCategory,
    metric_version: METRIC_VERSION,
  };
}
