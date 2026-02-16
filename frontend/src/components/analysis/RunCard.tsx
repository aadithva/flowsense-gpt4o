'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Clock, Film, Loader2, Square, Trash2 } from 'lucide-react';
import type { AnalysisRun } from '@interactive-flow/shared';
import { cn, formatRelativeTime } from '@/lib/utils';

interface RunCardProps {
  run: AnalysisRun & {
    frameCount?: number;
    overallScore?: number;
  };
  onDelete?: (runId: string) => void;
  onStop?: (runId: string) => void;
}

const STATUS_CONFIG = {
  uploaded: { icon: Clock, color: 'text-zinc-500', animate: false },
  queued: { icon: Loader2, color: 'text-cyan-400', animate: true },
  processing: { icon: Loader2, color: 'text-cyan-400', animate: true },
  completed: { icon: CheckCircle2, color: 'text-emerald-400', animate: false },
  failed: { icon: AlertCircle, color: 'text-red-400', animate: false },
};

export default function RunCard({ run, onDelete, onStop }: RunCardProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.uploaded;
  const Icon = config.icon;

  const getScoreColor = (score: number) => {
    if (score >= 12) return 'text-emerald-400';
    if (score >= 8) return 'text-amber-400';
    return 'text-red-400';
  };

  const getScoreBars = (score: number) => {
    const maxScore = 14;
    const filled = Math.round((score / maxScore) * 8);
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-3 w-1.5 rounded-sm',
              i < filled
                ? score >= 12
                  ? 'bg-emerald-400'
                  : score >= 8
                  ? 'bg-amber-400'
                  : 'bg-red-400'
                : 'bg-zinc-800'
            )}
          />
        ))}
      </div>
    );
  };

  const handleCardClick = () => {
    router.push(`/runs/${run.id}`);
  };

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/runs/${run.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete analysis');
      }

      onDelete?.(run.id);
    } catch (error) {
      console.error('Error deleting run:', error);
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(false);
  };

  const handleStopClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setIsStopping(true);
    try {
      const response = await fetch(`/api/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (!response.ok) {
        throw new Error('Failed to stop analysis');
      }

      onStop?.(run.id);
    } catch (error) {
      console.error('Error stopping run:', error);
      setIsStopping(false);
      setShowConfirm(false);
    }
  };

  const isProcessing = run.status === 'processing' || run.status === 'queued';

  return (
    <div
      onClick={handleCardClick}
      className="group relative cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-all duration-200 hover:border-cyan-500/50 hover:bg-zinc-900/60"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Title with status icon */}
          <div className="mb-1 flex items-center gap-2">
            <Icon
              className={cn(
                'h-4 w-4',
                config.color,
                config.animate && 'animate-spin'
              )}
            />
            <h3 className="truncate font-medium text-white">{run.title}</h3>
          </div>

          {/* Metadata: Time + Frame count */}
          <div className="mb-3 flex items-center gap-3 text-sm text-zinc-500">
            <span>{formatRelativeTime(run.created_at)}</span>
            {run.frameCount !== undefined && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Film className="h-3.5 w-3.5" />
                  {run.frameCount} frames
                </span>
              </>
            )}
          </div>

          {/* Processing progress */}
          {isProcessing && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-cyan-400">
                  {run.progress_message || 'Processing...'}
                </span>
                <span className="text-zinc-500">{run.progress_percentage || 0}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-cyan-500 transition-all duration-300"
                  style={{ width: `${run.progress_percentage || 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Score bars for completed */}
          {run.status === 'completed' && run.overallScore !== undefined && (
            <div className="flex items-center gap-3">
              {getScoreBars(run.overallScore)}
              <span className={cn('text-sm font-medium', getScoreColor(run.overallScore))}>
                {run.overallScore}/14
              </span>
            </div>
          )}

          {/* Error message */}
          {run.status === 'failed' && run.error_message && (
            <p className="text-sm text-red-400">{run.error_message}</p>
          )}
        </div>

        {/* Right side: Score or Stop/Delete button */}
        <div className="flex items-center gap-3">
          {/* Overall score (for completed only) */}
          {run.status === 'completed' && run.overallScore !== undefined && !showConfirm && (
            <div className={cn('text-lg font-semibold', getScoreColor(run.overallScore))}>
              {run.overallScore}/14
            </div>
          )}

          {/* Stop button (for processing/queued) or Delete button (shows on hover) */}
          <div className={cn(
            'transition-opacity',
            isProcessing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}>
            {showConfirm ? (
              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={isProcessing ? handleStopClick : handleDeleteClick}
                  disabled={isDeleting || isStopping}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {isStopping ? 'Stopping...' : isDeleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  onClick={handleCancelDelete}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
                >
                  Cancel
                </button>
              </div>
            ) : isProcessing ? (
              <button
                onClick={handleStopClick}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition-colors hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-400"
                title="Stop analysis"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleDeleteClick}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition-colors hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-400"
                title="Delete analysis"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
