'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import UploadZone from './upload/UploadZone';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default function NewRunForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const router = useRouter();

  const handleUpload = async (file: File, title: string) => {
    setLoading(true);
    setError('');
    setUploadProgress(0);

    try {
      // Create run and get upload URL
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
      setUploadProgress(20);

      // Upload video to Supabase Storage
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(errText || 'Failed to upload video');
      }

      setUploadProgress(70);

      // Enqueue processing job
      const enqueueRes = await fetch(`/api/runs/${run.id}/enqueue`, {
        method: 'POST',
      });

      if (!enqueueRes.ok) {
        const err = await enqueueRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to queue analysis');
      }

      setUploadProgress(100);

      // Redirect to history
      router.push('/history');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      <UploadZone
        onFileSelect={handleUpload}
        onError={setError}
        isUploading={loading}
        uploadProgress={uploadProgress}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
