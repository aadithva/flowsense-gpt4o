'use client';

import { useCallback, useState } from 'react';
import type { AnalysisRun } from '@/lib/types';

interface UploadState {
  loading: boolean;
  progress: number;
  error: string;
  run: AnalysisRun | null;
}

export function useUpload() {
  const [state, setState] = useState<UploadState>({
    loading: false,
    progress: 0,
    error: '',
    run: null,
  });

  const reset = useCallback(() => {
    setState({ loading: false, progress: 0, error: '', run: null });
  }, []);

  const setErrorMessage = useCallback((message: string) => {
    setState((prev) => ({ ...prev, error: message }));
  }, []);

  const startUpload = useCallback(async (title: string, file: File) => {
    setState({ loading: true, progress: 0, error: '', run: null });

    try {
      const createRes = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          fileName: file.name,
          contentType: file.type,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to create analysis run');
      }

      const { run, uploadUrl } = await createRes.json();
      setState((prev) => ({ ...prev, progress: 20, run }));

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-ms-blob-type': 'BlockBlob', // Required for Azure Blob Storage
        },
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(errText || 'Failed to upload video');
      }

      setState((prev) => ({ ...prev, progress: 80 }));

      const enqueueRes = await fetch(`/api/runs/${run.id}/enqueue`, {
        method: 'POST',
      });

      if (!enqueueRes.ok) {
        const err = await enqueueRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to queue analysis');
      }

      setState((prev) => ({ ...prev, progress: 100, loading: false }));
      return run as AnalysisRun;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setState({ loading: false, progress: 0, error: message, run: null });
      throw err;
    }
  }, []);

  return {
    ...state,
    startUpload,
    reset,
    setErrorMessage,
  };
}
