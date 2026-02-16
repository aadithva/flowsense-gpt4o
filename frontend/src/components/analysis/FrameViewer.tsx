'use client';

import { CheckCircle2, Lightbulb } from 'lucide-react';
import type { FrameWithAnalysis } from '@/lib/types';
import { RUBRIC_CATEGORIES } from '@interactive-flow/shared';
import { cn } from '@/lib/utils';

interface FrameViewerProps {
  frame: FrameWithAnalysis;
  frameNumber: number;
  totalFrames: number;
}

function getAnalysis(frame: FrameWithAnalysis) {
  if (Array.isArray(frame.analysis)) {
    return frame.analysis
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }
  return frame.analysis;
}

function scoreColor(score: number) {
  if (score === 2) return 'text-green-400 bg-green-500/10 border-green-500/20';
  if (score === 1) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

export default function FrameViewer({ frame, frameNumber, totalFrames }: FrameViewerProps) {
  const analysis = getAnalysis(frame);
  const justifications = analysis?.justifications;
  const suggestions = analysis?.suggestions || [];

  return (
    <div className="space-y-6">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        {frame.url ? (
          <img src={frame.url} alt={`Frame ${frameNumber}`} className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
            Frame Preview <span className="ml-2 font-mono text-cyan-400">({frameNumber}/{totalFrames})</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{
          backgroundImage:
            'linear-gradient(cyan 1px, transparent 1px), linear-gradient(90deg, cyan 1px, transparent 1px)',
          backgroundSize: '20% 20%',
        }} />
      </div>

      {analysis && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
            const score = analysis.rubric_scores[key as keyof typeof analysis.rubric_scores] ?? 0;
            return (
              <div key={key} className={cn('rounded-xl border p-3 text-center', scoreColor(score))}>
                <div className="mb-1 text-2xl font-bold">{score}/2</div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
            <CheckCircle2 className="h-4 w-4 text-cyan-400" />
            Observations
          </div>
          <ul className="space-y-2">
            {justifications ? (
              Object.entries(justifications).map(([key, value]) => (
                <li key={key} className="flex items-start gap-2 text-sm text-zinc-400">
                  <span className="mt-1.5 text-cyan-500/50">•</span>
                  {String(value)}
                </li>
              ))
            ) : (
              <li className="text-sm text-zinc-500">No analysis available for this frame yet.</li>
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
            <Lightbulb className="h-4 w-4 text-yellow-400" />
            Recommendations
          </div>
          <ul className="space-y-2">
            {suggestions.length > 0 ? (
              suggestions.map((suggestion: any, index: number) => (
                <li key={`${suggestion.title}-${index}`} className="flex items-start gap-2 text-sm text-zinc-400">
                  <span className="mt-1.5 text-yellow-500/50">→</span>
                  {suggestion.description}
                </li>
              ))
            ) : (
              <li className="text-sm text-zinc-500">No recommendations for this frame yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
