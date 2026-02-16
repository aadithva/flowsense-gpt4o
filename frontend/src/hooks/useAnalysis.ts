'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AnalysisRun } from '@/lib/types';

export function useAnalysisRuns() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const fetchRuns = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/runs');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to fetch runs');
      }
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (!runs.some((run) => run.status === 'processing' || run.status === 'queued')) return;
    const interval = setInterval(fetchRuns, 2000);
    return () => clearInterval(interval);
  }, [runs, fetchRuns]);

  return { runs, loading, error, refresh: fetchRuns };
}
