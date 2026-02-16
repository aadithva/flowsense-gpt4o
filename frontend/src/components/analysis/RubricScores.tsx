'use client';

import { Info } from 'lucide-react';
import { RUBRIC_CATEGORIES, SCORE_LABELS } from '@interactive-flow/shared';
import type { Justifications, RubricScores } from '@interactive-flow/shared';
import { cn } from '@/lib/utils';

interface RubricScoresProps {
  scores: RubricScores;
  justifications?: Justifications;
  title?: string;
}

export default function RubricScores({ scores, justifications, title = 'UX Rubric Scores' }: RubricScoresProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
        const score = scores[key as keyof RubricScores] ?? 0;
        const percentage = (score / 2) * 100;
        const justification = justifications?.[key as keyof Justifications];

        return (
          <div key={key} className="group">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-300">{label}</span>
                <div className="relative">
                  <Info className="h-3.5 w-3.5 text-zinc-600" />
                  <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 w-64 -translate-x-1/2 rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100">
                    {label}
                  </div>
                </div>
              </div>
              <span
                className={cn(
                  'text-sm font-bold',
                  percentage >= 75 ? 'text-green-400' : percentage >= 50 ? 'text-yellow-400' : 'text-red-400'
                )}
              >
                {score}/2
              </span>
            </div>

            <div className="h-2 rounded-full bg-zinc-800">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  percentage >= 75 ? 'bg-green-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                )}
                style={{ width: `${percentage}%` }}
              />
            </div>

            {justification && (
              <p className="mt-1.5 text-xs text-zinc-500">{justification}</p>
            )}
            {!justification && (
              <p className="mt-1.5 text-xs text-zinc-600">
                {SCORE_LABELS[score as keyof typeof SCORE_LABELS]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
