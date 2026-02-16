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
}
