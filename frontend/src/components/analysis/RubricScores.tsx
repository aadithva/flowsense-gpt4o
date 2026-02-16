'use client';

import { Info } from 'lucide-react';
import { RUBRIC_CATEGORIES, SCORE_LABELS } from '@interactive-flow/shared';
import type { Justifications, RubricScores } from '@interactive-flow/shared';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RubricScoresProps {
  scores: RubricScores;
  justifications?: Justifications;
  title?: string;
}

export default function RubricScoresComponent({ scores, justifications, title = 'UX Rubric Scores' }: RubricScoresProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {Object.entries(RUBRIC_CATEGORIES).map(([key, label]) => {
        const score = scores[key as keyof RubricScores] ?? 0;
        const percentage = (score / 2) * 100;
        const justification = justifications?.[key as keyof Justifications];

        return (
          <div key={key} className="group">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-300">{label}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{label}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <span
                className={cn(
                  'text-sm font-bold',
                  percentage >= 75 ? 'text-emerald-400' : percentage >= 50 ? 'text-yellow-400' : 'text-red-400'
                )}
              >
                {score}/2
              </span>
            </div>

            <Progress
              value={percentage}
              className={cn(
                'h-2',
                percentage >= 75 && '[&>div]:bg-emerald-500',
                percentage >= 50 && percentage < 75 && '[&>div]:bg-yellow-500',
                percentage < 50 && '[&>div]:bg-red-500'
              )}
            />

            {justification && (
              <p className="mt-1.5 text-xs text-muted-foreground">{justification}</p>
            )}
            {!justification && (
              <p className="mt-1.5 text-xs text-muted-foreground/60">
                {SCORE_LABELS[score as keyof typeof SCORE_LABELS]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
