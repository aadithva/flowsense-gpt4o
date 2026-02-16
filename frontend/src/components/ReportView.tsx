'use client';

import { useEffect, useRef, useState } from 'react';
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
  Suggestion,
} from '@interactive-flow/shared';

interface ReportData {
  run: RunWithSummary;
  summary?: RunSummary;
  keyframes: FrameWithAnalysis[];
}

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

  const processingSteps = [
    {
      label: 'Action → Response Integrity',
      detail: 'Checking clarity of system response',
    },
    {
      label: 'Feedback & System Status',
      detail: 'Scanning for visibility of state changes',
    },
    {
      label: 'Interaction Predictability',
      detail: 'Assessing affordance and intent cues',
    },
    {
      label: 'Flow Continuity',
      detail: 'Looking for friction or backtracking',
    },
    {
      label: 'Error Handling',
      detail: 'Inspecting recovery paths and messaging',
    },
    {
      label: 'Micro-interactions',
      detail: 'Reviewing polish and transitions',
    },
    {
      label: 'Efficiency',
      detail: 'Evaluating steps and interaction cost',
    },
  ];

  useEffect(() => {
    fetchData();
  }, [runId]);

  useEffect(() => {
    if (!data) return;
    if (data.run.status === 'processing' || data.run.status === 'queued') {
      const interval = setInterval(() => {
        fetchStatus();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [data?.run.status, runId]);

  useEffect(() => {
    if (!data) return;
    if (data.run.status === 'processing' || data.run.status === 'queued') {
      const interval = setInterval(() => {
        setActiveStep((prev) => (prev + 1) % processingSteps.length);
      }, 1800);
      return () => clearInterval(interval);
    }
  }, [data?.run.status, processingSteps.length]);

  const fetchData = async () => {
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
      console.error('Failed to fetch run data:', error);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/status`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to fetch status');
      }
      const status = await res.json();
      if (status.status === 'completed' || status.status === 'failed') {
        fetchData();
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

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
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'pt',
        format: 'a4',
      });

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
    return <div className="py-8 text-center text-zinc-400">Loading analysis...</div>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <h2 className="mb-2 text-xl font-bold text-red-200">Unable to load analysis</h2>
        <p className="text-red-300">{error}</p>
      </div>
    );
  }

  if (!data) {
    return <div className="py-8 text-center text-zinc-400">Analysis not found</div>;
  }

  const { run, summary, keyframes } = data;

  if (run.status === 'failed') {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-red-200">Analysis Failed</h2>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition-colors hover:border-red-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? 'Retrying...' : 'Retry Analysis'}
          </button>
        </div>
        <p className="mt-3 text-red-300">{run.error_message}</p>
        {retryError && <p className="mt-2 text-sm text-red-200">{retryError}</p>}
      </div>
    );
  }

  if (run.status !== 'completed') {
    const progress = Math.max(0, Math.min(100, run.progress_percentage ?? 0));
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-zinc-100">{run.title}</h2>
          <div className="inline-flex items-center gap-2 text-xs text-zinc-500 font-mono">
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">
              {run.status === 'queued' ? 'Queued' : 'Processing'}
            </span>
            <span>{progress}%</span>
          </div>
        </div>

        <div className="relative mt-5 inline-flex">
          <div className="absolute inset-x-0 -bottom-1 h-6 bg-gradient-to-r from-cyan-500/0 via-cyan-500/20 to-cyan-500/0 blur-sm" />
          <p className="relative text-sm text-zinc-200">
            {processingSteps[activeStep]?.label}: {processingSteps[activeStep]?.detail}
          </p>
        </div>

        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-zinc-900">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500/60 to-cyan-300/60 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="mt-3 text-xs text-zinc-500">
          {run.progress_message || 'Analyzing extracted frames for UX signals...'}
        </p>
      </div>
    );
  }

  if (!summary || keyframes.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="mb-4 text-xl font-bold text-zinc-100">{run.title}</h2>
        <p className="text-zinc-400">No analysis data available yet.</p>
      </div>
    );
  }

  const currentFrame = keyframes[selectedFrame];

  return (
    <div ref={reportRef} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-zinc-100">{run.title}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200 transition-colors hover:border-cyan-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? 'Retrying...' : 'Retry Analysis'}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportingPdf ? 'Exporting PDF...' : 'Export PDF'}
          </button>
          <button
            onClick={() => {
              const dataStr = JSON.stringify({ run, summary, keyframes }, null, 2);
              const blob = new Blob([dataStr], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `analysis-${run.id}.json`;
              a.click();
            }}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
          >
            Export JSON
          </button>
        </div>
      </div>
      {retryError && <p className="text-sm text-red-300">{retryError}</p>}
      {exportError && <p className="text-sm text-red-300">{exportError}</p>}

      <OverallScores summary={summary} />

      <TimelineStrip
        keyframes={keyframes}
        selectedFrame={selectedFrame}
        onSelectFrame={setSelectedFrame}
      />

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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <h2 className="mb-4 text-xl font-bold text-zinc-100">Overall Scores</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <div className="h-72 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(148, 163, 184, 0.25)" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <PolarRadiusAxis domain={[0, 2]} tickCount={3} tick={{ fontSize: 10, fill: '#64748b' }} />
              <Radar
                dataKey="score"
                stroke="#22d3ee"
                fill="rgba(34, 211, 238, 0.2)"
                fillOpacity={1}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
            const score = summary.overall_scores[key as keyof typeof summary.overall_scores];
            return (
              <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-center">
                <div
                  className={`text-3xl font-bold mb-1 font-mono ${
                    score === 2
                      ? 'text-green-400'
                      : score === 1
                      ? 'text-yellow-400'
                      : 'text-red-400'
                  }`}
                >
                  {score}
                </div>
                <div className="mb-1 text-sm text-zinc-500">
                  {SCORE_LABELS[score as keyof typeof SCORE_LABELS]}
                </div>
                <div className="text-xs text-zinc-400">{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <h2 className="mb-4 text-xl font-bold text-zinc-100">Timeline</h2>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {keyframes.map((frame, index) => (
          <button
            key={frame.id}
            onClick={() => onSelectFrame(index)}
            className={`flex-shrink-0 relative ${
              index === selectedFrame ? 'ring-2 ring-cyan-500/50' : ''
            }`}
          >
          {(frame as any).url && (
              <div className="relative overflow-hidden rounded">
                <img
                  src={(frame as any).url}
                  alt={`Frame ${index + 1}`}
                  className="h-20 w-32 object-cover"
                />
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 px-1 text-xs text-cyan-400 font-mono">
              {(frame.timestamp_ms / 1000).toFixed(1)}s
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FrameDetail({ frame }: { frame: FrameWithAnalysis }) {
  const analysis = Array.isArray(frame.analysis)
    ? frame.analysis
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : frame.analysis;

  if (!analysis) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <p className="text-zinc-400">No analysis available for this frame.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <h2 className="mb-4 text-xl font-bold text-zinc-100">
        Frame Detail <span className="font-mono text-cyan-400">({(frame.timestamp_ms / 1000).toFixed(1)}s)</span>
      </h2>

      {(frame as any).url && (
        <div className="relative mx-auto mb-6 w-full max-w-2xl overflow-hidden rounded-lg">
          <img
            src={(frame as any).url}
            alt="Frame"
            className="w-full object-cover"
          />
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h3 className="mb-3 font-semibold text-zinc-100">Rubric Scores</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
              const score = analysis.rubric_scores[key as keyof typeof analysis.rubric_scores];
              const justification = analysis.justifications[key as keyof typeof analysis.justifications];
              return (
                <div key={key} className="flex gap-3">
                  <div
                    className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border font-bold text-xl ${
                      score === 2
                        ? 'border-green-500/40 bg-green-500/10 text-green-300'
                        : score === 1
                        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
                        : 'border-red-500/40 bg-red-500/10 text-red-300'
                    }`}
                  >
                    <span className="font-mono">{score}</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-zinc-200">{label}</div>
                    <div className="text-xs text-zinc-400">{justification}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {analysis.issue_tags.length > 0 && (
          <div>
            <h3 className="mb-3 font-semibold text-zinc-100">Issues Detected</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.issue_tags.map((tag: any) => (
                <span
                  key={tag}
                  className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
                >
                  {tag.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {analysis.suggestions.length > 0 && (
          <div>
            <h3 className="mb-3 font-semibold text-zinc-100">Improvement Suggestions</h3>
            <div className="space-y-2">
              {analysis.suggestions.map((suggestion, i) => (
                <div
                  key={i}
                  className={`rounded-lg border-l-4 p-3 ${
                    suggestion.severity === 'high'
                      ? 'border-red-500 bg-red-500/10'
                      : suggestion.severity === 'med'
                      ? 'border-yellow-500 bg-yellow-500/10'
                      : 'border-blue-500 bg-blue-500/10'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        suggestion.severity === 'high'
                          ? 'bg-red-500/20 text-red-200'
                          : suggestion.severity === 'med'
                          ? 'bg-yellow-500/20 text-yellow-200'
                          : 'bg-blue-500/20 text-blue-200'
                      }`}
                    >
                      {suggestion.severity.toUpperCase()}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-zinc-200">{suggestion.title}</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {suggestion.description}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TopIssues({ summary }: { summary: RunSummary }) {
  if (summary.top_issues.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <h2 className="mb-4 text-xl font-bold text-zinc-100">Top Issues</h2>
      <div className="space-y-3">
        {summary.top_issues.map((issue, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
          >
            <div className="flex-1">
              <div className="font-medium text-zinc-200">{issue.tag.replace(/_/g, ' ')}</div>
              <div className="text-sm text-zinc-400">{issue.description}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-cyan-400 font-mono">
                {issue.count} occurrences
              </span>
              <span
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  issue.severity === 'high'
                    ? 'bg-red-500/20 text-red-200'
                    : issue.severity === 'med'
                    ? 'bg-yellow-500/20 text-yellow-200'
                    : 'bg-blue-500/20 text-blue-200'
                }`}
              >
                {issue.severity}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Recommendations({ summary }: { summary: RunSummary }) {
  if (summary.recommendations.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <h2 className="mb-4 text-xl font-bold text-zinc-100">Prioritized Recommendations</h2>
      <div className="space-y-4">
        {summary.recommendations.map((rec, i) => (
          <div
            key={i}
            className={`rounded-lg border-l-4 p-4 ${
              rec.priority === 'high'
                ? 'border-red-500 bg-red-500/10'
                : rec.priority === 'med'
                ? 'border-yellow-500 bg-yellow-500/10'
                : 'border-blue-500 bg-blue-500/10'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="font-semibold text-zinc-200">{rec.title}</div>
              <span
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  rec.priority === 'high'
                    ? 'bg-red-500/20 text-red-200'
                    : rec.priority === 'med'
                    ? 'bg-yellow-500/20 text-yellow-200'
                    : 'bg-blue-500/20 text-blue-200'
                }`}
              >
                {rec.priority}
              </span>
            </div>
            <div className="mb-2 text-sm text-zinc-300">{rec.description}</div>
            <div className="text-xs text-zinc-500">
              Category: {rec.category} • Related: {rec.relatedIssues.join(', ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
