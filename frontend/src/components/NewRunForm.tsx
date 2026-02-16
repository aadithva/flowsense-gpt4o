'use client';

import { useRouter } from 'next/navigation';
import UploadZone from './upload/UploadZone';
import { useUpload } from '@/hooks/useUpload';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default function NewRunForm() {
  const { loading, error, progress, startUpload, reset, setErrorMessage } = useUpload();
  const router = useRouter();

  const handleUpload = async (file: File, title: string) => {
    try {
      await startUpload(title, file);
      router.push('/history');
      router.refresh();
    } catch {
      // state is handled by the upload hook
    }
  };

  return (
    <div className="space-y-4">
      <UploadZone
        onFileSelect={handleUpload}
        onError={setErrorMessage}
        onClear={reset}
        isUploading={loading}
        uploadProgress={progress}
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
