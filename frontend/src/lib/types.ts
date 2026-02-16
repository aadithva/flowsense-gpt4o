import type {
  AnalysisRun,
  FrameWithAnalysis,
  RunSummary,
} from '@interactive-flow/shared';

export type { AnalysisRun, FrameWithAnalysis, RunSummary };

export interface RunReportResponse {
  run: AnalysisRun;
  summary: RunSummary | null;
  keyframes: FrameWithAnalysis[];
  regression?: {
    previous_run_summary: RunSummary;
    weighted_score_delta: number | null;
    critical_issue_delta: number | null;
  } | null;
}
