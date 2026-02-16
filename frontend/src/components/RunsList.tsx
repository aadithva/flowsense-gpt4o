'use client';

import { useEffect, useState } from 'react';
import type { AnalysisRun } from '@interactive-flow/shared';
import RunCard from './analysis/RunCard';

export default function RunsList() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRuns();

    // Poll for updates every 2 seconds if there are processing runs
    const interval = setInterval(() => {
      if (runs.some(run => run.status === 'processing' || run.status === 'queued')) {
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
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-cyan-500" />
          <p className="text-sm text-zinc-500">Loading analyses...</p>
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
          <svg
            className="h-8 w-8 text-zinc-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-white">No analyses yet</h3>
        <p className="text-sm text-zinc-500">
          Upload your first screen recording to get started
        </p>
      </div>
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
