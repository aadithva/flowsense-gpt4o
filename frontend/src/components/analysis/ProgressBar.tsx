'use client';

import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';

interface ProgressStep {
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress?: number;
}

interface ProgressBarProps {
  steps: ProgressStep[];
  overallProgress: number;
}

export default function ProgressBar({ steps, overallProgress }: ProgressBarProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Analysis Progress</span>
          <span className="font-mono text-primary">{Math.round(overallProgress)}%</span>
        </div>
        <Progress value={overallProgress} className="h-2" />
      </div>

      <div className="grid gap-3">
        {steps.map((step, idx) => (
          <Card
            key={step.label}
            className={cn(
              'flex items-center gap-3 p-3 transition-all',
              step.status === 'processing' && 'border-primary/20 bg-primary/5',
              step.status === 'completed' && 'bg-card/50',
              step.status === 'pending' && 'bg-card/30 opacity-50',
              step.status === 'error' && 'border-destructive/20 bg-destructive/5'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                step.status === 'processing' && 'bg-primary/20 text-primary',
                step.status === 'completed' && 'bg-emerald-500/20 text-emerald-400',
                step.status === 'pending' && 'bg-secondary text-muted-foreground',
                step.status === 'error' && 'bg-destructive/20 text-destructive'
              )}
            >
              {step.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
              {step.status === 'completed' && <Check className="h-4 w-4" />}
              {step.status === 'pending' && <span className="text-xs font-mono">{idx + 1}</span>}
              {step.status === 'error' && <AlertCircle className="h-4 w-4" />}
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-sm font-medium',
                    step.status === 'processing' ? 'text-primary' : 'text-zinc-300'
                  )}
                >
                  {step.label}
                </span>
                {step.progress !== undefined && step.status === 'processing' && (
                  <span className="text-xs font-mono text-muted-foreground">{step.progress}%</span>
                )}
              </div>
              {step.progress !== undefined && step.status === 'processing' && (
                <Progress value={step.progress} className="mt-2 h-1" />
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
