'use client';

import type { FrameWithAnalysis } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Play } from 'lucide-react';

interface TimelineProps {
  frames: FrameWithAnalysis[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function getAnalysis(frame: FrameWithAnalysis) {
  if (Array.isArray(frame.analysis)) {
    return frame.analysis[0];
  }
  return frame.analysis;
}

function getAverageScore(frame: FrameWithAnalysis) {
  const analysis = getAnalysis(frame);
  if (!analysis) return null;
  const values = Object.values(analysis.rubric_scores || {}) as number[];
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default function Timeline({ frames, selectedIndex, onSelect }: TimelineProps) {
  return (
    <div className="relative">
      <div className="flex gap-2 overflow-x-auto pb-4">
        {frames.map((frame, idx) => {
          const avg = getAverageScore(frame);
          const isSelected = idx === selectedIndex;
          const badgeClass =
            avg === null
              ? 'bg-zinc-800 text-zinc-300'
              : avg >= 1.5
              ? 'bg-green-500/20 text-green-400'
              : avg >= 1
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-red-500/20 text-red-400';

          return (
            <button
              key={frame.id}
              onClick={() => onSelect(idx)}
              className={cn(
                'relative flex-shrink-0 w-32 overflow-hidden rounded-xl border-2 transition-all',
                isSelected ? 'border-cyan-500 ring-2 ring-cyan-500/20' : 'border-zinc-800 hover:border-zinc-700'
              )}
            >
              <div className="relative aspect-video bg-zinc-900">
                {frame.url ? (
                  <img src={frame.url} alt={`Frame ${idx + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
                    <span className="text-xs text-zinc-600">Frame {idx + 1}</span>
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <div className="flex items-center gap-1 text-xs text-white">
                    <Play className="h-3 w-3" />
                    {(frame.timestamp_ms / 1000).toFixed(1)}s
                  </div>
                </div>

                <div className={cn('absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', badgeClass)}>
                  {avg === null ? '-' : avg.toFixed(1)}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="pointer-events-none absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-black to-transparent" />
    </div>
  );
}
