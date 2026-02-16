export type AnalysisStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'cancel_requested'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type IssueSeverity = 'high' | 'med' | 'low';

export type IssueTag =
  | 'dead_click'
  | 'delayed_response'
  | 'ambiguous_response'
  | 'missing_spinner'
  | 'unclear_disabled_state'
  | 'no_progress_feedback'
  | 'misleading_affordance'
  | 'surprise_navigation'
  | 'mode_switch_surprise'
  | 'backtracking'
  | 'repeated_actions'
  | 'context_loss'
  | 'silent_error'
  | 'blocking_error'
  | 'recovery_unclear'
  | 'jarring_transition'
  | 'distracting_animation'
  | 'focus_confusion'
  | 'too_many_steps'
  | 'over_clicking'
  | 'excessive_cursor_travel'
  | 'redundant_confirmations';

export interface Profile {
  id: string;
  full_name: string | null;
  created_at: string;
}

export interface AnalysisRun {
  id: string;
  user_id: string;
  title: string;
  video_storage_path: string;
  status: AnalysisStatus;
  error_message: string | null;
  progress_percentage: number;
  progress_message: string;
  created_at: string;
  updated_at: string;
}

export interface Frame {
  id: string;
  run_id: string;
  storage_path: string;
  timestamp_ms: number;
  is_keyframe: boolean;
  diff_score: number;
  created_at: string;
}

export interface RubricScores {
  cat1: number; // Action → Response Integrity
  cat2: number; // Feedback & System Status Visibility
  cat3: number; // Interaction Predictability & Affordance
  cat4: number; // Flow Continuity & Friction
  cat5: number; // Error Handling & Recovery
  cat6: number; // Micro-interaction Quality (Polish)
  cat7: number; // Efficiency & Interaction Cost
}

export interface Justifications {
  cat1: string;
  cat2: string;
  cat3: string;
  cat4: string;
  cat5: string;
  cat6: string;
  cat7: string;
}

export interface Suggestion {
  severity: IssueSeverity;
  title: string;
  description: string;
}

export interface FrameAnalysis {
  id: string;
  frame_id: string;
  rubric_scores: RubricScores;
  justifications: Justifications;
  issue_tags: IssueTag[];
  suggestions: Suggestion[];
  created_at: string;
}

export interface TopIssue {
  tag: IssueTag;
  count: number;
  severity: IssueSeverity;
  description: string;
}

export interface Recommendation {
  category: string;
  priority: IssueSeverity;
  title: string;
  description: string;
  relatedIssues: IssueTag[];
}

export interface RunSummary {
  run_id: string;
  overall_scores: RubricScores;
  top_issues: TopIssue[];
  recommendations: Recommendation[];
  weighted_score_100: number;
  critical_issue_count: number;
  quality_gate_status: 'pass' | 'warn' | 'block';
  confidence_by_category: Record<keyof RubricScores, number>;
  metric_version: string;
  created_at: string;
}

export interface FrameWithAnalysis extends Frame {
  analysis?: FrameAnalysis;
  url?: string; // Signed URL added at runtime by API
}

export interface RunWithSummary extends AnalysisRun {
  summary?: RunSummary;
  keyframes?: FrameWithAnalysis[];
}
