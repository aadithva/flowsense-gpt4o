import { supabase } from './supabase';
import type {
  RubricScores,
  TopIssue,
  Recommendation,
  IssueTag,
} from '@interactive-flow/shared';

export async function generateSummary(runId: string) {
  // Fetch all frame analyses
  const { data: analyses, error } = await supabase
    .from('frame_analyses')
    .select(`
      *,
      frame:frames!inner(run_id)
    `)
    .eq('frame.run_id', runId);

  if (error || !analyses || analyses.length === 0) {
    throw new Error('No analyses found for run');
  }

  // Calculate overall scores (average rounded to 0/1/2)
  const overallScores: RubricScores = {
    cat1: 0,
    cat2: 0,
    cat3: 0,
    cat4: 0,
    cat5: 0,
    cat6: 0,
    cat7: 0,
  };

  const categories = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7'] as const;

  for (const cat of categories) {
    const avg =
      analyses.reduce((sum, a) => sum + (a.rubric_scores[cat] || 0), 0) /
      analyses.length;
    overallScores[cat] = Math.round(avg) as 0 | 1 | 2;
  }

  // Count issue tags
  const issueCountMap = new Map<IssueTag, number>();
  for (const analysis of analyses) {
    for (const tag of analysis.issue_tags) {
      issueCountMap.set(tag, (issueCountMap.get(tag) || 0) + 1);
    }
  }

  // Get top 5 issues
  const topIssues: TopIssue[] = Array.from(issueCountMap.entries())
    .map(([tag, count]) => ({
      tag,
      count,
      severity: determineSeverity(tag),
      description: getIssueDescription(tag),
    }))
    .sort((a, b) => {
      // Sort by severity first, then count
      const severityOrder = { high: 0, med: 1, low: 2 };
      if (a.severity !== b.severity) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.count - a.count;
    })
    .slice(0, 5);

  // Generate recommendations
  const recommendations = generateRecommendations(topIssues, overallScores);

  return {
    overall_scores: overallScores,
    top_issues: topIssues,
    recommendations,
  };
}

function determineSeverity(tag: IssueTag): 'high' | 'med' | 'low' {
  const highSeverity: IssueTag[] = [
    'dead_click',
    'silent_error',
    'blocking_error',
    'unclear_disabled_state',
  ];
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

function generateRecommendations(
  topIssues: TopIssue[],
  scores: RubricScores
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Category 1: Action → Response Integrity
  if (scores.cat1 < 2) {
    const relatedIssues = topIssues
      .filter((i) => ['dead_click', 'delayed_response', 'ambiguous_response'].includes(i.tag))
      .map((i) => i.tag);

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

  // Category 2: System Status Visibility
  if (scores.cat2 < 2) {
    const relatedIssues = topIssues
      .filter((i) => ['missing_spinner', 'no_progress_feedback'].includes(i.tag))
      .map((i) => i.tag);

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

  // Category 3: Affordance
  if (scores.cat3 < 2) {
    const relatedIssues = topIssues
      .filter((i) => ['misleading_affordance', 'unclear_disabled_state'].includes(i.tag))
      .map((i) => i.tag);

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

  // Category 4: Flow Continuity
  if (scores.cat4 < 2) {
    const relatedIssues = topIssues
      .filter((i) => ['backtracking', 'repeated_actions', 'context_loss'].includes(i.tag))
      .map((i) => i.tag);

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

  // Category 5: Error Handling
  if (scores.cat5 < 2) {
    const relatedIssues = topIssues
      .filter((i) => ['silent_error', 'blocking_error', 'recovery_unclear'].includes(i.tag))
      .map((i) => i.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Error Handling & Recovery',
        priority: 'high',
        title: 'Improve error messaging and recovery',
        description:
          'Make all errors visible with actionable messages. Provide inline fix suggestions, retry buttons, and "learn more" links. Never fail silently.',
        relatedIssues,
      });
    }
  }

  // Category 6: Polish
  if (scores.cat6 < 2) {
    const relatedIssues = topIssues
      .filter((i) => ['jarring_transition', 'focus_confusion', 'distracting_animation'].includes(i.tag))
      .map((i) => i.tag);

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

  // Category 7: Efficiency
  if (scores.cat7 < 2) {
    const relatedIssues = topIssues
      .filter((i) =>
        ['too_many_steps', 'over_clicking', 'excessive_cursor_travel', 'redundant_confirmations'].includes(i.tag)
      )
      .map((i) => i.tag);

    if (relatedIssues.length > 0) {
      recommendations.push({
        category: 'Efficiency & Interaction Cost',
        priority: 'med',
        title: 'Streamline the interaction path',
        description:
          'Reduce the number of required steps, remove unnecessary confirmations, set better defaults, and add keyboard shortcuts for power users.',
        relatedIssues,
      });
    }
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, med: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}
