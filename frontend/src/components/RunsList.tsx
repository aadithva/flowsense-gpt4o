'use client';

import { useEffect, useState } from 'react';
import type { AnalysisRun } from '@interactive-flow/shared';
import RunCard from './analysis/RunCard';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileVideo } from 'lucide-react';

export default function RunsList() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRuns();

    // Poll for updates every 2 seconds if there are processing runs
    const interval = setInterval(() => {
      if (runs.some(run => run.status === 'processing' || run.status === 'queued' || run.status === 'cancel_requested')) {
        fetchRuns();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runs]);

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/runs');
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (runId: string) => {
    // Optimistically remove from UI
    setRuns(runs.filter(run => run.id !== runId));
  };

  const handleStop = (runId: string) => {
    // Refresh to get updated status
    fetchRuns();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <Card className="p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
          <FileVideo className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-foreground">No analyses yet</h3>
        <p className="text-sm text-muted-foreground">
          Upload your first screen recording to get started
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          onDelete={handleDelete}
          onStop={handleStop}
        />
      ))}
    </div>
  );
}
