'use client';

import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
          <span className="text-zinc-400">Analysis Progress</span>
          <span className="font-mono text-cyan-400">{Math.round(overallProgress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-900">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      <div className="grid gap-3">
        {steps.map((step, idx) => (
          <div
            key={step.label}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 transition-all',
              step.status === 'processing' && 'border-cyan-500/20 bg-cyan-500/5',
              step.status === 'completed' && 'border-zinc-800 bg-zinc-900/50',
              step.status === 'pending' && 'border-zinc-900 bg-zinc-900/30 opacity-50',
              step.status === 'error' && 'border-red-500/20 bg-red-500/5'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                step.status === 'processing' && 'bg-cyan-500/20 text-cyan-400',
                step.status === 'completed' && 'bg-green-500/20 text-green-400',
                step.status === 'pending' && 'bg-zinc-800 text-zinc-600',
                step.status === 'error' && 'bg-red-500/20 text-red-400'
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
                    step.status === 'processing' ? 'text-cyan-400' : 'text-zinc-300'
                  )}
                >
                  {step.label}
                </span>
                {step.progress !== undefined && step.status === 'processing' && (
                  <span className="text-xs font-mono text-zinc-500">{step.progress}%</span>
                )}
              </div>
              {step.progress !== undefined && step.status === 'processing' && (
                <div className="mt-2 h-1 rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all duration-300"
                    style={{ width: `${step.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
