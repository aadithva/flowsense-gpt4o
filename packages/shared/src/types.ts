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

export interface FlowOverview {
  app_context: string;    // Name/type of app or interface being used
  user_intent: string;    // What the user is trying to accomplish
  actions_observed: string; // Brief description of key actions in the flow
}

/** Synthesized video-level flow description from context carry-over */
export interface VideoFlowDescription {
  /** The application or UI being interacted with (e.g., "VS Code IDE", "E-commerce checkout") */
  application: string;
  /** What the user is trying to accomplish - their overall intent */
  user_intent: string;
  /** Key actions observed throughout the video in chronological order */
  key_actions: string[];
  /** A narrative paragraph describing the flow from beginning to end */
  flow_narrative: string;
  /** Confidence in the synthesis (0-1) based on context quality */
  synthesis_confidence: number;
}

export interface FrameAnalysis {
  id: string;
  frame_id: string;
  rubric_scores: RubricScores;
  justifications: Justifications;
  issue_tags: IssueTag[];
  suggestions: Suggestion[];
  flow_overview?: FlowOverview;
  created_at: string;
}

export interface TopIssue {
  tag: IssueTag;
  count: number;
  severity: IssueSeverity;
  description: string;
  /** Frame IDs where this issue was detected - enables click-to-navigate */
  sourceFrameIds: string[];
}

export interface Recommendation {
  category: string;
  priority: IssueSeverity;
  title: string;
  description: string;
  relatedIssues: IssueTag[];
  /** Frame IDs related to this recommendation - enables click-to-navigate */
  sourceFrameIds: string[];
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
  /** Flow overview - describes what's happening in the UI flow (per-frame) */
  flow_overview?: FlowOverview;
  /** Synthesized video flow description - overall journey narrative */
  video_flow_description?: VideoFlowDescription;
  /** V3 Accuracy Upgrade: Analysis engine version used for this run */
  analysis_engine_version?: string;
  /** V3 Accuracy Upgrade: Whether analysis was truncated due to budget */
  analysis_truncated?: boolean;
  /** V3 Accuracy Upgrade: Number of frames skipped due to truncation */
  frames_skipped?: number;
  /** V3 Accuracy Upgrade: Number of frames analyzed */
  frames_analyzed?: number;
  /** V3 Accuracy Upgrade: Full diagnostics object */
  v3_diagnostics?: V3Diagnostics;
}

/** V3 Accuracy Upgrade: Full diagnostics for summary */
export interface V3Diagnostics {
  /** Token usage breakdown */
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Evidence coverage metrics */
  evidence_coverage: {
    overall: number;
    by_category: Record<string, number>;
    categories_with_evidence: number;
    total_categories: number;
  };
  /** Self-consistency metrics */
  self_consistency: {
    score: number;
    total_reruns: number;
    avg_confidence: number;
    high_consistency_frames: number;
    low_consistency_frames: number;
    rerun_reasons: {
      schema_coercion: number;
      low_confidence: number;
      extraction_failed: number;
    };
  };
  /** Fallback information */
  fallback_applied: {
    any_fallback: boolean;
    fallback_categories: string[];
    fallback_reason: 'missing_scores' | 'missing_justifications' | 'insufficient_frames' | null;
    quality_gate_adjusted: boolean;
  };
  /** Schema normalization rate */
  schema_normalization_rate: number;
  /** Total inference time in ms */
  total_inference_ms: number;
}

/** V3 Accuracy Upgrade: Shadow analysis diff for comparison */
export interface ShadowDiff {
  /** Whether shadow analysis was performed */
  shadow_enabled: boolean;
  /** Shadow engine version used */
  shadow_engine_version: string | null;
  /** Weighted score delta (shadow - primary) */
  weighted_score_delta: number | null;
  /** Critical issue count delta (shadow - primary) */
  critical_issue_delta: number | null;
  /** Whether quality gate status changed between primary and shadow */
  quality_gate_changed: boolean;
  /** Primary quality gate status */
  primary_quality_gate: 'pass' | 'warn' | 'block';
  /** Shadow quality gate status */
  shadow_quality_gate: 'pass' | 'warn' | 'block' | null;
}

/** V3 Accuracy Upgrade: Shadow summary for detailed comparison */
export interface ShadowSummary extends Omit<RunSummary, 'run_id' | 'created_at'> {
  /** Shadow engine version */
  analysis_engine_version: string;
  /** Whether this is a shadow result */
  is_shadow: boolean;
  /** Sample rate used for shadow analysis */
  shadow_sample_rate?: number;
}

export interface FrameWithAnalysis extends Frame {
  analysis?: FrameAnalysis;
  url?: string; // Signed URL added at runtime by API
}

export interface RunWithSummary extends AnalysisRun {
  summary?: RunSummary;
  keyframes?: FrameWithAnalysis[];
}

// =============================================================================
// V3 API Response Types
// =============================================================================

/** V3: Extended run list item with V3 fields */
export interface RunListItemV3 extends AnalysisRun {
  frameCount: number;
  overallScore?: number;
  weighted_score_100?: number;
  critical_issue_count?: number;
  quality_gate_status?: 'pass' | 'warn' | 'block';
  metric_version?: string;
  /** V3: Analysis engine version */
  analysis_engine_version?: string;
  /** V3: Whether analysis was truncated */
  analysis_truncated?: boolean;
  /** V3: Shadow delta if shadow analysis was performed */
  shadow_delta?: {
    weighted_score_delta: number;
    critical_issue_delta: number;
    quality_gate_changed: boolean;
  } | null;
}

/** V3: Extended run detail response */
export interface RunDetailResponseV3 {
  run: AnalysisRun;
  summary: RunSummary | null;
  keyframes: FrameWithAnalysis[];
  regression: {
    previous_run_summary: RunSummary;
    weighted_score_delta: number | null;
    critical_issue_delta: number | null;
  } | null;
  /** V3: Shadow summary for internal comparison */
  shadow_summary?: ShadowSummary | null;
  /** V3: Shadow diff computation */
  shadow_diff?: ShadowDiff | null;
}

// =============================================================================
// Database Benchmark Types (for SQL tables created in migration 003)
// Note: Core benchmark types are in ./benchmark.ts
// =============================================================================

/** Benchmark adjudication for resolved disagreements (DB table type) */
export interface BenchmarkAdjudicationDb {
  id: string;
  benchmark_case_id: string;
  frame_timestamp_ms: number;
  adjudicator_id: string;
  final_rubric_scores: RubricScores;
  final_issue_tags: IssueTag[];
  reasoning: string | null;
  label_ids_considered: string[];
  created_at: string;
}

/** Benchmark evaluation run result (DB table type) */
export interface BenchmarkEvaluationRunDb {
  id: string;
  benchmark_case_id: string;
  analysis_engine_version: string;
  run_id: string | null;
  mae_per_category: Record<string, number> | null;
  overall_mae: number | null;
  issue_precision: number | null;
  issue_recall: number | null;
  issue_f1: number | null;
  total_tokens: number | null;
  inference_ms: number | null;
  evaluation_notes: string | null;
  created_at: string;
}
