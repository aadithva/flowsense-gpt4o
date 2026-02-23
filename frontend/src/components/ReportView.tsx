'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RUBRIC_CATEGORIES, SCORE_LABELS } from '@interactive-flow/shared';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import type {
  RunWithSummary,
  FrameWithAnalysis,
  RunSummary,
  ShadowSummary,
  ShadowDiff,
  FlowOverview,
  VideoFlowDescription,
} from '@interactive-flow/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import VideoTimeline from '@/components/analysis/VideoTimeline';

type EngineView = 'v2' | 'v3' | 'compare';

interface ReportData {
  run: RunWithSummary;
  summary?: RunSummary;
  keyframes: FrameWithAnalysis[];
  videoUrl?: string | null;
  regression?: {
    previous_run_summary: RunSummary;
    weighted_score_delta: number | null;
    critical_issue_delta: number | null;
  } | null;
  // V3 fields
  shadow_summary?: ShadowSummary | null;
  shadow_diff?: ShadowDiff | null;
}

const PROCESSING_STEPS = [
  { label: 'Action → Response Integrity', detail: 'Checking clarity of system response' },
  { label: 'Feedback & System Status', detail: 'Scanning for visibility of state changes' },
  { label: 'Interaction Predictability', detail: 'Assessing affordance and intent cues' },
  { label: 'Flow Continuity', detail: 'Looking for friction or backtracking' },
  { label: 'Error Handling', detail: 'Inspecting recovery paths and messaging' },
  { label: 'Micro-interactions', detail: 'Reviewing polish and transitions' },
  { label: 'Efficiency', detail: 'Evaluating steps and interaction cost' },
] as const;

export default function ReportView({ runId }: { runId: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFrame, setSelectedFrame] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>('');
  const [activeStep, setActiveStep] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string>('');
  const [engineView, setEngineView] = useState<EngineView>('v3');
  const [runningV3, setRunningV3] = useState(false);
  const [v3Error, setV3Error] = useState<string>('');
  const reportRef = useRef<HTMLDivElement | null>(null);
  const runStatus = data?.run.status;

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const res = await fetch(`/api/runs/${runId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to fetch run data');
      }
      const result = await res.json();
      setData(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch run data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/status`);
      if (!res.ok) return;
      const status = await res.json();
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        fetchData();
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  }, [fetchData, runId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (runStatus === 'processing' || runStatus === 'queued') {
      const interval = setInterval(() => fetchStatus(), 3000);
      return () => clearInterval(interval);
    }
  }, [fetchStatus, runStatus]);

  useEffect(() => {
    if (runStatus === 'processing' || runStatus === 'queued') {
      const interval = setInterval(() => {
        setActiveStep((prev) => (prev + 1) % PROCESSING_STEPS.length);
      }, 1800);
      return () => clearInterval(interval);
    }
  }, [runStatus]);

  const handleRetry = async () => {
    try {
      setRetryError('');
      setRetrying(true);
      const res = await fetch(`/api/runs/${runId}/retry`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to retry analysis');
      }
      await fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry analysis';
      setRetryError(message);
    } finally {
      setRetrying(false);
    }
  };

  const handleExportPdf = async () => {
    if (!reportRef.current) return;
    setExportError('');
    setExportingPdf(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#000000',
        scale: 2,
        useCORS: true,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);

      let heightLeft = imgHeight - pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`analysis-${runId}.pdf`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export PDF';
      setExportError(message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleRunV3Analysis = async () => {
    try {
      setV3Error('');
      setRunningV3(true);
      const res = await fetch(`/api/runs/${runId}/analyze-v3`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to run V3 analysis');
      }
      // Refresh data to get the new V3 results
      await fetchData();
      setEngineView('compare');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run V3 analysis';
      setV3Error(message);
    } finally {
      setRunningV3(false);
    }
  };

  const hasV3 = !!data?.shadow_summary;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load analysis</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return <div className="py-8 text-center text-muted-foreground">Analysis not found</div>;
  }

  const { run, summary, keyframes, regression, shadow_diff } = data;

  if (run.status === 'failed' || run.status === 'cancelled') {
    return (
      <Alert variant="destructive">
        <div className="flex items-center justify-between">
          <AlertTitle>{run.status === 'cancelled' ? 'Analysis Cancelled' : 'Analysis Failed'}</AlertTitle>
          <Button
            onClick={handleRetry}
            disabled={retrying}
            variant="outline"
            size="sm"
            className="border-destructive/30 hover:border-destructive/60"
          >
            {retrying ? 'Retrying...' : 'Retry Analysis'}
          </Button>
        </div>
        <AlertDescription className="mt-2">{run.error_message}</AlertDescription>
        {retryError && <p className="mt-2 text-sm">{retryError}</p>}
      </Alert>
    );
  }

  if (run.status !== 'completed') {
    const progress = Math.max(0, Math.min(100, run.progress_percentage ?? 0));
    return (
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-foreground">{run.title}</h2>
          <div className="inline-flex items-center gap-2 text-xs font-mono">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {run.status === 'queued'
                ? 'Queued'
                : run.status === 'cancel_requested'
                ? 'Cancel Requested'
                : 'Processing'}
            </Badge>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
        </div>

        <div className="relative mt-5 inline-flex">
          <div className="absolute inset-x-0 -bottom-1 h-6 bg-gradient-to-r from-primary/0 via-primary/20 to-primary/0 blur-sm" />
          <p className="relative text-sm text-zinc-200">
            {PROCESSING_STEPS[activeStep]?.label}: {PROCESSING_STEPS[activeStep]?.detail}
          </p>
        </div>

        <Progress value={progress} className="mt-4 h-1" />

        <p className="mt-3 text-xs text-muted-foreground">
          {run.progress_message || 'Analyzing extracted frames for UX signals...'}
        </p>
      </Card>
    );
  }

  if (!summary || keyframes.length === 0) {
    return (
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-foreground">{run.title}</h2>
        <p className="text-muted-foreground">No analysis data available yet.</p>
      </Card>
    );
  }

  const currentFrame = keyframes[selectedFrame];

  // Get V3 summary data for comparison
  const v3Summary = data?.shadow_summary;

  return (
    <div ref={reportRef} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-foreground">{run.title}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={handleRetry} disabled={retrying} variant="outline">
            {retrying ? 'Retrying...' : 'Retry Analysis'}
          </Button>
          <Button onClick={handleExportPdf} disabled={exportingPdf} variant="outline">
            {exportingPdf ? 'Exporting PDF...' : 'Export PDF'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const dataStr = JSON.stringify({ run, summary, keyframes }, null, 2);
              const blob = new Blob([dataStr], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `analysis-${run.id}.json`;
              a.click();
            }}
          >
            Export JSON
          </Button>
        </div>
      </div>
      {retryError && <p className="text-sm text-destructive">{retryError}</p>}
      {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      {v3Error && <p className="text-sm text-destructive">{v3Error}</p>}

      {/* Video Flow Description - Synthesized journey narrative */}
      {summary.video_flow_description && (
        <VideoFlowDescriptionSection description={summary.video_flow_description} />
      )}

      {/* Flow Overview - What's happening in this interaction (per-frame, shown if no synthesized description) */}
      {!summary.video_flow_description && summary.flow_overview && (
        <FlowOverviewSection flowOverview={summary.flow_overview} />
      )}

      {/* Engine Version Toggle */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Analysis Engine:</span>
            <Tabs value={engineView} onValueChange={(v) => setEngineView(v as EngineView)}>
              <TabsList>
                <TabsTrigger value="v2" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300">
                  V2 Baseline
                </TabsTrigger>
                <TabsTrigger
                  value="v3"
                  disabled={!hasV3}
                  className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300"
                >
                  V3 Hybrid
                </TabsTrigger>
                <TabsTrigger
                  value="compare"
                  disabled={!hasV3}
                  className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300"
                >
                  Compare
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {!hasV3 && (
            <Button
              onClick={handleRunV3Analysis}
              disabled={runningV3}
              variant="outline"
              className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
            >
              {runningV3 ? 'Running V3 Analysis...' : 'Run V3 Analysis'}
            </Button>
          )}
          {hasV3 && (
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">
              V3 Available
            </Badge>
          )}
        </div>
      </Card>

      {/* Video Timeline with Keyframe Markers */}
      <div data-timeline-section>
        <VideoTimeline
          videoUrl={data?.videoUrl || null}
          keyframes={keyframes}
          selectedIndex={selectedFrame}
          onSelectFrame={setSelectedFrame}
        />
      </div>

      {/* Selected Frame Detail */}
      {currentFrame && <FrameDetail frame={currentFrame} />}

      {/* Content based on engine view */}
      {engineView === 'compare' && hasV3 && v3Summary ? (
        <ComparisonView v2Summary={summary} v3Summary={v3Summary} />
      ) : engineView === 'v3' && hasV3 && v3Summary ? (
        <>
          <MetricHighlightsV3 summary={v3Summary} />
          {v3Summary.v3_diagnostics && <V3DiagnosticsPanel summary={v3Summary as unknown as RunSummary} />}
          <OverallScoresV3 summary={v3Summary} />
        </>
      ) : (
        <>
          <MetricHighlights summary={summary} regression={regression} shadowDiff={shadow_diff} />
          {summary.v3_diagnostics && <V3DiagnosticsPanel summary={summary} />}
          <OverallScores summary={summary} />
        </>
      )}
      <TopIssues
        summary={summary}
        keyframes={keyframes}
        onNavigateToFrame={(frameId) => {
          const frameIndex = keyframes.findIndex(f => f.id === frameId);
          if (frameIndex >= 0) {
            setSelectedFrame(frameIndex);
            // Scroll the timeline card into view
            const timelineSection = document.querySelector('[data-timeline-section]');
            if (timelineSection) {
              timelineSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }}
      />
      <Recommendations
        summary={summary}
        keyframes={keyframes}
        onNavigateToFrame={(frameId) => {
          const frameIndex = keyframes.findIndex(f => f.id === frameId);
          if (frameIndex >= 0) {
            setSelectedFrame(frameIndex);
            // Scroll the timeline card into view
            const timelineSection = document.querySelector('[data-timeline-section]');
            if (timelineSection) {
              timelineSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }}
      />
    </div>
  );
}

function OverallScores({ summary }: { summary: RunSummary }) {
  const radarData = Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => ({
    category: label,
    score: summary.overall_scores[key as keyof typeof summary.overall_scores],
    fullScore: 2,
  }));

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">Overall Scores</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-72 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(148, 163, 184, 0.25)" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <PolarRadiusAxis domain={[0, 2]} tickCount={3} tick={{ fontSize: 10, fill: '#64748b' }} />
              <Radar dataKey="score" stroke="#22d3ee" fill="rgba(34, 211, 238, 0.2)" fillOpacity={1} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
            const score = summary.overall_scores[key as keyof typeof summary.overall_scores];
            return (
              <Card key={key} className="p-4 text-center">
                <div
                  className={cn(
                    'text-3xl font-bold mb-1 font-mono',
                    score === 2 ? 'text-emerald-400' : score === 1 ? 'text-yellow-400' : 'text-red-400'
                  )}
                >
                  {score}
                </div>
                <div className="mb-1 text-sm text-muted-foreground">
                  {SCORE_LABELS[score as keyof typeof SCORE_LABELS]}
                </div>
                <div className="text-xs text-zinc-400">{label}</div>
              </Card>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function MetricHighlights({
  summary,
  regression,
  shadowDiff,
}: {
  summary: RunSummary;
  regression?: ReportData['regression'];
  shadowDiff?: ShadowDiff | null;
}) {
  const gateClass =
    summary.quality_gate_status === 'pass'
      ? 'bg-emerald-500/20 text-emerald-300'
      : summary.quality_gate_status === 'warn'
      ? 'bg-yellow-500/20 text-yellow-300'
      : 'bg-red-500/20 text-red-300';

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={gateClass}>Quality Gate: {summary.quality_gate_status.toUpperCase()}</Badge>
        <Badge variant="outline">Metric Version: {summary.metric_version}</Badge>
        {summary.analysis_engine_version && (
          <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
            Engine: {summary.analysis_engine_version}
          </Badge>
        )}
        {summary.analysis_truncated && (
          <Badge variant="outline" className="border-yellow-500/30 text-yellow-300">
            Truncated ({summary.frames_skipped} frames skipped)
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Weighted Score</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{summary.weighted_score_100.toFixed(1)}/100</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Critical Issues</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{summary.critical_issue_count}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Average Confidence</div>
          <div className="mt-1 text-2xl font-bold text-foreground">
            {(
              Object.values(summary.confidence_by_category).reduce((sum, value) => sum + value, 0) /
              Object.values(summary.confidence_by_category).length
            ).toFixed(2)}
          </div>
        </Card>
      </div>

      {regression?.previous_run_summary && (
        <div className="mt-4 rounded-lg border border-border/70 bg-secondary/30 p-4 text-sm text-zinc-300">
          <div className="font-medium text-foreground">Regression View</div>
          <div className="mt-2">
            Weighted score delta:{' '}
            <span
              className={cn(
                'font-semibold',
                (regression.weighted_score_delta ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'
              )}
            >
              {regression.weighted_score_delta === null
                ? 'N/A'
                : `${regression.weighted_score_delta > 0 ? '+' : ''}${regression.weighted_score_delta.toFixed(2)}`}
            </span>
          </div>
          <div>
            Critical issue delta:{' '}
            <span
              className={cn(
                'font-semibold',
                (regression.critical_issue_delta ?? 0) <= 0 ? 'text-emerald-300' : 'text-red-300'
              )}
            >
              {regression.critical_issue_delta === null
                ? 'N/A'
                : `${regression.critical_issue_delta > 0 ? '+' : ''}${regression.critical_issue_delta.toFixed(0)}`}
            </span>
          </div>
        </div>
      )}

      {shadowDiff?.shadow_enabled && (
        <div className="mt-4 rounded-lg border border-purple-500/30 bg-purple-500/10 p-4 text-sm text-zinc-300">
          <div className="font-medium text-purple-300">Shadow Analysis (V3 Hybrid) - Internal</div>
          <div className="mt-2 grid grid-cols-3 gap-4">
            <div>
              <span className="text-muted-foreground">Score Delta:</span>{' '}
              <span
                className={cn(
                  'font-semibold',
                  (shadowDiff.weighted_score_delta ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'
                )}
              >
                {shadowDiff.weighted_score_delta === null
                  ? 'N/A'
                  : `${shadowDiff.weighted_score_delta > 0 ? '+' : ''}${shadowDiff.weighted_score_delta.toFixed(2)}`}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Issue Delta:</span>{' '}
              <span
                className={cn(
                  'font-semibold',
                  (shadowDiff.critical_issue_delta ?? 0) <= 0 ? 'text-emerald-300' : 'text-red-300'
                )}
              >
                {shadowDiff.critical_issue_delta === null
                  ? 'N/A'
                  : `${shadowDiff.critical_issue_delta > 0 ? '+' : ''}${shadowDiff.critical_issue_delta}`}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Gate Changed:</span>{' '}
              <span className={cn('font-semibold', shadowDiff.quality_gate_changed ? 'text-yellow-300' : 'text-zinc-400')}>
                {shadowDiff.quality_gate_changed
                  ? `${shadowDiff.primary_quality_gate} → ${shadowDiff.shadow_quality_gate}`
                  : 'No'}
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function V3DiagnosticsPanel({ summary }: { summary: RunSummary }) {
  const diag = summary.v3_diagnostics;
  if (!diag) return null;

  return (
    <Card className="p-6 border-cyan-500/20 bg-cyan-500/5">
      <h2 className="mb-4 text-lg font-bold text-cyan-300">V3 Diagnostics (Internal)</h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Token Usage */}
        <Card className="p-4 bg-zinc-900/50">
          <div className="text-xs text-muted-foreground mb-2">Token Usage</div>
          <div className="text-lg font-bold text-foreground">{diag.token_usage.total_tokens.toLocaleString()}</div>
          <div className="text-xs text-zinc-500">
            {diag.token_usage.prompt_tokens.toLocaleString()} prompt / {diag.token_usage.completion_tokens.toLocaleString()} completion
          </div>
        </Card>

        {/* Evidence Coverage */}
        <Card className="p-4 bg-zinc-900/50">
          <div className="text-xs text-muted-foreground mb-2">Evidence Coverage</div>
          <div className="text-lg font-bold text-foreground">{(diag.evidence_coverage.overall * 100).toFixed(0)}%</div>
          <div className="text-xs text-zinc-500">
            {diag.evidence_coverage.categories_with_evidence}/{diag.evidence_coverage.total_categories} categories
          </div>
        </Card>

        {/* Self-Consistency */}
        <Card className="p-4 bg-zinc-900/50">
          <div className="text-xs text-muted-foreground mb-2">Self-Consistency</div>
          <div className="text-lg font-bold text-foreground">{(diag.self_consistency.score * 100).toFixed(0)}%</div>
          <div className="text-xs text-zinc-500">
            {diag.self_consistency.total_reruns} reruns, {diag.self_consistency.avg_confidence.toFixed(2)} avg conf
          </div>
        </Card>

        {/* Inference Time */}
        <Card className="p-4 bg-zinc-900/50">
          <div className="text-xs text-muted-foreground mb-2">Inference Time</div>
          <div className="text-lg font-bold text-foreground">{(diag.total_inference_ms / 1000).toFixed(1)}s</div>
          <div className="text-xs text-zinc-500">
            {diag.schema_normalization_rate > 0 && `${(diag.schema_normalization_rate * 100).toFixed(0)}% normalized`}
          </div>
        </Card>
      </div>

      {/* Fallback Warning */}
      {diag.fallback_applied.any_fallback && (
        <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
          <span className="font-medium text-yellow-300">Fallback Applied:</span>{' '}
          <span className="text-zinc-300">
            {diag.fallback_applied.fallback_reason} on {diag.fallback_applied.fallback_categories.join(', ')}
          </span>
        </div>
      )}

      {/* Rerun Reasons Breakdown */}
      {diag.self_consistency.total_reruns > 0 && (
        <div className="mt-4 text-xs text-zinc-500">
          Rerun reasons: {diag.self_consistency.rerun_reasons.low_confidence} low confidence,{' '}
          {diag.self_consistency.rerun_reasons.schema_coercion} schema coercion,{' '}
          {diag.self_consistency.rerun_reasons.extraction_failed} extraction failed
        </div>
      )}
    </Card>
  );
}


function FrameDetail({ frame }: { frame: FrameWithAnalysis }) {
  const analysis = Array.isArray(frame.analysis)
    ? frame.analysis.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : frame.analysis;

  if (!analysis) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">No analysis available for this frame.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">
        Frame Detail <span className="font-mono text-primary">({(frame.timestamp_ms / 1000).toFixed(1)}s)</span>
      </h2>

      {(frame as any).url && (
        <div className="relative mx-auto mb-6 w-full max-w-2xl overflow-hidden rounded-lg">
          <img src={(frame as any).url} alt="Frame" className="w-full object-cover" />
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h3 className="mb-3 font-semibold text-foreground">Rubric Scores</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
              const score = analysis.rubric_scores[key as keyof typeof analysis.rubric_scores];
              const justification = analysis.justifications[key as keyof typeof analysis.justifications];
              return (
                <div key={key} className="flex gap-3">
                  <div
                    className={cn(
                      'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border font-bold text-xl',
                      score === 2
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : score === 1
                        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
                        : 'border-red-500/40 bg-red-500/10 text-red-300'
                    )}
                  >
                    <span className="font-mono">{score}</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-zinc-200">{label}</div>
                    <div className="text-xs text-muted-foreground">{justification}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {analysis.issue_tags.length > 0 && (
          <div>
            <h3 className="mb-3 font-semibold text-foreground">Issues Detected</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.issue_tags.map((tag: any) => (
                <Badge key={tag} variant="outline" className="border-destructive/30 bg-destructive/10 text-red-300">
                  {tag.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {analysis.suggestions.length > 0 && (
          <div>
            <h3 className="mb-3 font-semibold text-foreground">Improvement Suggestions</h3>
            <div className="space-y-2">
              {analysis.suggestions.map((suggestion: any, i: number) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border-l-4 p-3',
                    suggestion.severity === 'high'
                      ? 'border-red-500 bg-red-500/10'
                      : suggestion.severity === 'med'
                      ? 'border-yellow-500 bg-yellow-500/10'
                      : 'border-blue-500 bg-blue-500/10'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Badge
                      className={cn(
                        suggestion.severity === 'high'
                          ? 'bg-red-500/20 text-red-200'
                          : suggestion.severity === 'med'
                          ? 'bg-yellow-500/20 text-yellow-200'
                          : 'bg-blue-500/20 text-blue-200'
                      )}
                    >
                      {suggestion.severity.toUpperCase()}
                    </Badge>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-zinc-200">{suggestion.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{suggestion.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function TopIssues({
  summary,
  keyframes,
  onNavigateToFrame,
}: {
  summary: RunSummary;
  keyframes: FrameWithAnalysis[];
  onNavigateToFrame: (frameId: string) => void;
}) {
  if (summary.top_issues.length === 0) return null;

  // Helper to find frame index from frame ID
  const getFrameIndex = (frameId: string): number => {
    return keyframes.findIndex(f => f.id === frameId);
  };

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">Top Issues</h2>
      <div className="space-y-3">
        {summary.top_issues.map((issue, i) => {
          const hasFrameLinks = issue.sourceFrameIds && issue.sourceFrameIds.length > 0;
          const firstFrameId = hasFrameLinks ? issue.sourceFrameIds[0] : null;
          const frameIndex = firstFrameId ? getFrameIndex(firstFrameId) : -1;

          return (
            <Card
              key={i}
              className={cn(
                'flex items-center justify-between p-3 transition-colors',
                hasFrameLinks && 'cursor-pointer hover:bg-zinc-800/50 hover:border-primary/30'
              )}
              onClick={() => {
                if (firstFrameId) {
                  onNavigateToFrame(firstFrameId);
                }
              }}
            >
              <div className="flex-1">
                <div className="font-medium text-zinc-200">{issue.tag.replace(/_/g, ' ')}</div>
                <div className="text-sm text-muted-foreground">{issue.description}</div>
                {hasFrameLinks && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-primary/70">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>
                      {frameIndex >= 0 ? `Frame ${frameIndex + 1}` : 'View frame'}
                      {issue.sourceFrameIds.length > 1 && ` (+${issue.sourceFrameIds.length - 1} more)`}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-primary font-mono">{issue.count} occurrences</span>
                <Badge
                  className={cn(
                    issue.severity === 'high'
                      ? 'bg-red-500/20 text-red-200'
                      : issue.severity === 'med'
                      ? 'bg-yellow-500/20 text-yellow-200'
                      : 'bg-blue-500/20 text-blue-200'
                  )}
                >
                  {issue.severity}
                </Badge>
              </div>
            </Card>
          );
        })}
      </div>
    </Card>
  );
}

function Recommendations({
  summary,
  keyframes,
  onNavigateToFrame,
}: {
  summary: RunSummary;
  keyframes: FrameWithAnalysis[];
  onNavigateToFrame: (frameId: string) => void;
}) {
  if (summary.recommendations.length === 0) return null;

  // Helper to find frame index from frame ID
  const getFrameIndex = (frameId: string): number => {
    return keyframes.findIndex(f => f.id === frameId);
  };

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">Prioritized Recommendations</h2>
      <div className="space-y-4">
        {summary.recommendations.map((rec, i) => {
          const hasFrameLinks = rec.sourceFrameIds && rec.sourceFrameIds.length > 0;
          const firstFrameId = hasFrameLinks ? rec.sourceFrameIds[0] : null;
          const frameIndex = firstFrameId ? getFrameIndex(firstFrameId) : -1;

          return (
            <div
              key={i}
              className={cn(
                'rounded-lg border-l-4 p-4 transition-colors',
                rec.priority === 'high'
                  ? 'border-red-500 bg-red-500/10'
                  : rec.priority === 'med'
                  ? 'border-yellow-500 bg-yellow-500/10'
                  : 'border-blue-500 bg-blue-500/10',
                hasFrameLinks && 'cursor-pointer hover:brightness-110'
              )}
              onClick={() => {
                if (firstFrameId) {
                  onNavigateToFrame(firstFrameId);
                }
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold text-zinc-200">{rec.title}</div>
                <Badge
                  className={cn(
                    rec.priority === 'high'
                      ? 'bg-red-500/20 text-red-200'
                      : rec.priority === 'med'
                      ? 'bg-yellow-500/20 text-yellow-200'
                      : 'bg-blue-500/20 text-blue-200'
                  )}
                >
                  {rec.priority}
                </Badge>
              </div>
              <div className="mb-2 text-sm text-zinc-300">{rec.description}</div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  Category: {rec.category} • Related: {rec.relatedIssues.join(', ')}
                </div>
                {hasFrameLinks && (
                  <div className="flex items-center gap-1 text-xs text-primary/70">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>
                      {frameIndex >= 0 ? `Frame ${frameIndex + 1}` : 'View frame'}
                      {rec.sourceFrameIds.length > 1 && ` (+${rec.sourceFrameIds.length - 1} more)`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// Video Flow Description Section - Synthesized video-level journey description
function VideoFlowDescriptionSection({ description }: { description: VideoFlowDescription }) {
  return (
    <Card className="p-6 border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 via-purple-500/5 to-cyan-500/5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gradient-to-r from-indigo-400 to-purple-400 animate-pulse" />
          <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
            Video Flow Description
          </h2>
        </div>
        {description.synthesis_confidence > 0 && (
          <Badge variant="outline" className="border-indigo-500/30 text-indigo-300">
            {(description.synthesis_confidence * 100).toFixed(0)}% confidence
          </Badge>
        )}
      </div>

      {/* Application & Intent - 2 column grid */}
      <div className="grid grid-cols-1 gap-4 mb-4 md:grid-cols-2">
        <Card className="p-4 bg-zinc-900/50 border-indigo-500/10">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium text-indigo-400 uppercase tracking-wide">Application</span>
          </div>
          <p className="text-lg text-zinc-100">{description.application}</p>
        </Card>
        <Card className="p-4 bg-zinc-900/50 border-purple-500/10">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs font-medium text-purple-400 uppercase tracking-wide">User Intent</span>
          </div>
          <p className="text-lg text-zinc-100">{description.user_intent}</p>
        </Card>
      </div>

      {/* Flow Narrative */}
      <Card className="p-4 bg-zinc-900/50 border-cyan-500/10 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-medium text-cyan-400 uppercase tracking-wide">Flow Narrative</span>
        </div>
        <p className="text-sm text-zinc-200 leading-relaxed">{description.flow_narrative}</p>
      </Card>

      {/* Key Actions */}
      {description.key_actions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wide">Key Actions</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {description.key_actions.map((action, i) => (
              <Badge
                key={i}
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-3 py-1"
              >
                <span className="text-emerald-500 mr-1.5 font-mono">{i + 1}.</span>
                {action}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// Flow Overview Section - Shows what's happening in the interaction (per-frame)
function FlowOverviewSection({ flowOverview }: { flowOverview: FlowOverview }) {
  return (
    <Card className="p-6 border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-purple-500/5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
        <h2 className="text-xl font-bold text-indigo-300">Flow Overview</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* App Context */}
        <Card className="p-4 bg-zinc-900/50 border-indigo-500/10">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium text-indigo-400 uppercase tracking-wide">Application</span>
          </div>
          <p className="text-sm text-zinc-200">{flowOverview.app_context}</p>
        </Card>

        {/* User Intent */}
        <Card className="p-4 bg-zinc-900/50 border-purple-500/10">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs font-medium text-purple-400 uppercase tracking-wide">User Intent</span>
          </div>
          <p className="text-sm text-zinc-200">{flowOverview.user_intent}</p>
        </Card>

        {/* Actions Observed */}
        <Card className="p-4 bg-zinc-900/50 border-cyan-500/10">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            <span className="text-xs font-medium text-cyan-400 uppercase tracking-wide">Actions Observed</span>
          </div>
          <p className="text-sm text-zinc-200">{flowOverview.actions_observed}</p>
        </Card>
      </div>
    </Card>
  );
}

// V3-specific components
function MetricHighlightsV3({ summary }: { summary: ShadowSummary }) {
  const gateClass =
    summary.quality_gate_status === 'pass'
      ? 'bg-emerald-500/20 text-emerald-300'
      : summary.quality_gate_status === 'warn'
      ? 'bg-yellow-500/20 text-yellow-300'
      : 'bg-red-500/20 text-red-300';

  return (
    <Card className="p-6 border-purple-500/20">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={gateClass}>Quality Gate: {summary.quality_gate_status.toUpperCase()}</Badge>
        <Badge variant="outline">Metric Version: {summary.metric_version}</Badge>
        <Badge variant="outline" className="border-purple-500/30 text-purple-300">
          Engine: V3 Hybrid
        </Badge>
        {summary.is_shadow && (
          <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
            Shadow Analysis
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Weighted Score</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{summary.weighted_score_100.toFixed(1)}/100</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Critical Issues</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{summary.critical_issue_count}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Frames Analyzed</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{summary.frames_analyzed}</div>
        </Card>
      </div>
    </Card>
  );
}

function OverallScoresV3({ summary }: { summary: ShadowSummary }) {
  const radarData = Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => ({
    category: label,
    score: summary.overall_scores[key as keyof typeof summary.overall_scores] ?? 0,
    fullScore: 2,
  }));

  return (
    <Card className="p-6 border-purple-500/20">
      <h2 className="mb-4 text-xl font-bold text-purple-300">V3 Overall Scores</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-72 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(148, 163, 184, 0.25)" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <PolarRadiusAxis domain={[0, 2]} tickCount={3} tick={{ fontSize: 10, fill: '#64748b' }} />
              <Radar dataKey="score" stroke="#a855f7" fill="rgba(168, 85, 247, 0.2)" fillOpacity={1} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
            const score = summary.overall_scores[key as keyof typeof summary.overall_scores] ?? 0;
            return (
              <Card key={key} className="p-4 text-center border-purple-500/10">
                <div
                  className={cn(
                    'text-3xl font-bold mb-1 font-mono',
                    score === 2 ? 'text-emerald-400' : score === 1 ? 'text-yellow-400' : 'text-red-400'
                  )}
                >
                  {score}
                </div>
                <div className="mb-1 text-sm text-muted-foreground">
                  {SCORE_LABELS[score as keyof typeof SCORE_LABELS]}
                </div>
                <div className="text-xs text-zinc-400">{label}</div>
              </Card>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ComparisonView({ v2Summary, v3Summary }: { v2Summary: RunSummary; v3Summary: ShadowSummary }) {
  const scoreDelta = v3Summary.weighted_score_100 - v2Summary.weighted_score_100;
  const issueDelta = v3Summary.critical_issue_count - v2Summary.critical_issue_count;

  return (
    <div className="space-y-6">
      {/* Summary Comparison Header */}
      <Card className="p-6 border-cyan-500/20 bg-gradient-to-r from-blue-500/5 to-purple-500/5">
        <h2 className="mb-4 text-xl font-bold text-cyan-300">V2 vs V3 Comparison</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Weighted Score Comparison */}
          <Card className="p-4 bg-zinc-900/50">
            <div className="text-xs text-muted-foreground mb-2">Weighted Score</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-blue-400">V2</div>
                <div className="text-xl font-bold text-foreground">{v2Summary.weighted_score_100.toFixed(1)}</div>
              </div>
              <div className="text-center px-2">
                <span
                  className={cn(
                    'text-lg font-bold',
                    scoreDelta > 0 ? 'text-emerald-400' : scoreDelta < 0 ? 'text-red-400' : 'text-zinc-400'
                  )}
                >
                  {scoreDelta > 0 ? '+' : ''}{scoreDelta.toFixed(1)}
                </span>
              </div>
              <div className="text-right">
                <div className="text-xs text-purple-400">V3</div>
                <div className="text-xl font-bold text-foreground">{v3Summary.weighted_score_100.toFixed(1)}</div>
              </div>
            </div>
          </Card>

          {/* Critical Issues Comparison */}
          <Card className="p-4 bg-zinc-900/50">
            <div className="text-xs text-muted-foreground mb-2">Critical Issues</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-blue-400">V2</div>
                <div className="text-xl font-bold text-foreground">{v2Summary.critical_issue_count}</div>
              </div>
              <div className="text-center px-2">
                <span
                  className={cn(
                    'text-lg font-bold',
                    issueDelta < 0 ? 'text-emerald-400' : issueDelta > 0 ? 'text-red-400' : 'text-zinc-400'
                  )}
                >
                  {issueDelta > 0 ? '+' : ''}{issueDelta}
                </span>
              </div>
              <div className="text-right">
                <div className="text-xs text-purple-400">V3</div>
                <div className="text-xl font-bold text-foreground">{v3Summary.critical_issue_count}</div>
              </div>
            </div>
          </Card>

          {/* Quality Gate Comparison */}
          <Card className="p-4 bg-zinc-900/50">
            <div className="text-xs text-muted-foreground mb-2">Quality Gate</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-blue-400">V2</div>
                <Badge
                  className={cn(
                    'mt-1',
                    v2Summary.quality_gate_status === 'pass'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : v2Summary.quality_gate_status === 'warn'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  )}
                >
                  {v2Summary.quality_gate_status.toUpperCase()}
                </Badge>
              </div>
              <div className="text-center px-2">
                {v2Summary.quality_gate_status !== v3Summary.quality_gate_status ? (
                  <span className="text-yellow-400 text-lg">→</span>
                ) : (
                  <span className="text-zinc-500 text-lg">=</span>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs text-purple-400">V3</div>
                <Badge
                  className={cn(
                    'mt-1',
                    v3Summary.quality_gate_status === 'pass'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : v3Summary.quality_gate_status === 'warn'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  )}
                >
                  {v3Summary.quality_gate_status.toUpperCase()}
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      </Card>

      {/* Side-by-Side Category Scores */}
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-foreground">Category Score Comparison</h2>
        <div className="grid grid-cols-1 gap-4">
          {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
            const v2Score = v2Summary.overall_scores[key as keyof typeof v2Summary.overall_scores];
            const v3Score = v3Summary.overall_scores[key as keyof typeof v3Summary.overall_scores] ?? 0;
            const diff = v3Score - v2Score;

            return (
              <div key={key} className="flex items-center gap-4 p-3 rounded-lg bg-zinc-900/30">
                <div className="flex-1 text-sm font-medium text-zinc-300">{label}</div>
                <div className="flex items-center gap-4">
                  <div className="w-16 text-center">
                    <div className="text-xs text-blue-400 mb-1">V2</div>
                    <div
                      className={cn(
                        'text-lg font-bold',
                        v2Score === 2 ? 'text-emerald-400' : v2Score === 1 ? 'text-yellow-400' : 'text-red-400'
                      )}
                    >
                      {v2Score}
                    </div>
                  </div>
                  <div className="w-12 text-center">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-zinc-500'
                      )}
                    >
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  </div>
                  <div className="w-16 text-center">
                    <div className="text-xs text-purple-400 mb-1">V3</div>
                    <div
                      className={cn(
                        'text-lg font-bold',
                        v3Score === 2 ? 'text-emerald-400' : v3Score === 1 ? 'text-yellow-400' : 'text-red-400'
                      )}
                    >
                      {v3Score}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Side-by-Side Radar Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-6 border-blue-500/20">
          <h3 className="mb-4 text-lg font-bold text-blue-300">V2 Baseline</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => ({
                  category: label,
                  score: v2Summary.overall_scores[key as keyof typeof v2Summary.overall_scores],
                  fullScore: 2,
                }))}
              >
                <PolarGrid stroke="rgba(148, 163, 184, 0.25)" />
                <PolarAngleAxis dataKey="category" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                <PolarRadiusAxis domain={[0, 2]} tickCount={3} tick={{ fontSize: 9, fill: '#64748b' }} />
                <Radar dataKey="score" stroke="#3b82f6" fill="rgba(59, 130, 246, 0.2)" fillOpacity={1} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-purple-500/20">
          <h3 className="mb-4 text-lg font-bold text-purple-300">V3 Hybrid</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => ({
                  category: label,
                  score: v3Summary.overall_scores[key as keyof typeof v3Summary.overall_scores] ?? 0,
                  fullScore: 2,
                }))}
              >
                <PolarGrid stroke="rgba(148, 163, 184, 0.25)" />
                <PolarAngleAxis dataKey="category" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                <PolarRadiusAxis domain={[0, 2]} tickCount={3} tick={{ fontSize: 9, fill: '#64748b' }} />
                <Radar dataKey="score" stroke="#a855f7" fill="rgba(168, 85, 247, 0.2)" fillOpacity={1} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
