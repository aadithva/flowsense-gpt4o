'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Clock, Film, Loader2, Square, Trash2 } from 'lucide-react';
import type { AnalysisRun } from '@interactive-flow/shared';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface RunCardProps {
  run: AnalysisRun & {
    frameCount?: number;
    overallScore?: number;
  };
  onDelete?: (runId: string) => void;
  onStop?: (runId: string) => void;
}

const STATUS_CONFIG = {
  uploaded: { icon: Clock, color: 'text-muted-foreground', animate: false },
  queued: { icon: Loader2, color: 'text-primary', animate: true },
  processing: { icon: Loader2, color: 'text-primary', animate: true },
  completed: { icon: CheckCircle2, color: 'text-emerald-400', animate: false },
  failed: { icon: AlertCircle, color: 'text-destructive', animate: false },
};

export default function RunCard({ run, onDelete, onStop }: RunCardProps) {
  const router = useRouter();
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
                : 'bg-secondary'
            )}
          />
        ))}
      </div>
    );
  };

  const handleCardClick = () => {
    router.push(`/runs/${run.id}`);
  };

  const handleDelete = async () => {
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
    }
  };

  const handleStop = async () => {
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
    }
  };

  const isProcessing = run.status === 'processing' || run.status === 'queued';

  return (
    <Card
      onClick={handleCardClick}
      className="group cursor-pointer p-4 transition-all duration-200 hover:border-primary/50 hover:bg-card/60"
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
            <h3 className="truncate font-medium text-foreground">{run.title}</h3>
          </div>

          {/* Metadata: Time + Frame count */}
          <div className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
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
                <span className="text-primary">
                  {run.progress_message || 'Processing...'}
                </span>
                <span className="text-muted-foreground">{run.progress_percentage || 0}%</span>
              </div>
              <Progress value={run.progress_percentage || 0} className="h-1.5" />
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
            <p className="text-sm text-destructive">{run.error_message}</p>
          )}
        </div>

        {/* Right side: Score or Stop/Delete button */}
        <div className="flex items-center gap-3">
          {/* Overall score (for completed only) */}
          {run.status === 'completed' && run.overallScore !== undefined && (
            <div className={cn('text-lg font-semibold', getScoreColor(run.overallScore))}>
              {run.overallScore}/14
            </div>
          )}

          {/* Stop button (for processing/queued) or Delete button (shows on hover) */}
          <div
            className={cn(
              'transition-opacity',
              isProcessing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {isProcessing ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Stop Analysis?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will stop the analysis process. You can restart it later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleStop}
                      disabled={isStopping}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isStopping ? 'Stopping...' : 'Stop'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Analysis?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this analysis run and all associated data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
