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
} from '@interactive-flow/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ReportData {
  run: RunWithSummary;
  summary?: RunSummary;
  keyframes: FrameWithAnalysis[];
  regression?: {
    previous_run_summary: RunSummary;
    weighted_score_delta: number | null;
    critical_issue_delta: number | null;
  } | null;
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

  const { run, summary, keyframes, regression } = data;

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

      <MetricHighlights summary={summary} regression={regression} />
      <OverallScores summary={summary} />
      <TimelineStrip keyframes={keyframes} selectedFrame={selectedFrame} onSelectFrame={setSelectedFrame} />
      {currentFrame && <FrameDetail frame={currentFrame} />}
      <TopIssues summary={summary} />
      <Recommendations summary={summary} />
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
}: {
  summary: RunSummary;
  regression?: ReportData['regression'];
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
    </Card>
  );
}

function TimelineStrip({
  keyframes,
  selectedFrame,
  onSelectFrame,
}: {
  keyframes: FrameWithAnalysis[];
  selectedFrame: number;
  onSelectFrame: (index: number) => void;
}) {
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">Timeline</h2>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {keyframes.map((frame, index) => (
          <button
            key={frame.id}
            onClick={() => onSelectFrame(index)}
            className={cn(
              'flex-shrink-0 relative rounded overflow-hidden',
              index === selectedFrame && 'ring-2 ring-primary/50'
            )}
          >
            {(frame as any).url && (
              <img src={(frame as any).url} alt={`Frame ${index + 1}`} className="h-20 w-32 object-cover" />
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-xs text-primary font-mono">
              {(frame.timestamp_ms / 1000).toFixed(1)}s
            </div>
          </button>
        ))}
      </div>
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

function TopIssues({ summary }: { summary: RunSummary }) {
  if (summary.top_issues.length === 0) return null;

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">Top Issues</h2>
      <div className="space-y-3">
        {summary.top_issues.map((issue, i) => (
          <Card key={i} className="flex items-center justify-between p-3">
            <div className="flex-1">
              <div className="font-medium text-zinc-200">{issue.tag.replace(/_/g, ' ')}</div>
              <div className="text-sm text-muted-foreground">{issue.description}</div>
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
        ))}
      </div>
    </Card>
  );
}

function Recommendations({ summary }: { summary: RunSummary }) {
  if (summary.recommendations.length === 0) return null;

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-xl font-bold text-foreground">Prioritized Recommendations</h2>
      <div className="space-y-4">
        {summary.recommendations.map((rec, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg border-l-4 p-4',
              rec.priority === 'high'
                ? 'border-red-500 bg-red-500/10'
                : rec.priority === 'med'
                ? 'border-yellow-500 bg-yellow-500/10'
                : 'border-blue-500 bg-blue-500/10'
            )}
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
            <div className="text-xs text-muted-foreground">
              Category: {rec.category} • Related: {rec.relatedIssues.join(', ')}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
