'use client';

import { useCallback, useState } from 'react';
import { FileVideo, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface UploadZoneProps {
  onFileSelect: (file: File, title: string) => void;
  onClear?: () => void;
  onError?: (message: string) => void;
  isUploading?: boolean;
  uploadProgress?: number;
}

export default function UploadZone({
  onFileSelect,
  onClear,
  onError,
  isUploading = false,
  uploadProgress = 0,
}: UploadZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.type === 'dragenter' || event.type === 'dragover') {
      setIsDragActive(true);
    } else if (event.type === 'dragleave') {
      setIsDragActive(false);
    }
  }, []);

  const validateAndSelect = useCallback(
    (file: File) => {
      const validTypes = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/matroska'];
      if (!validTypes.includes(file.type)) {
        onError?.('Please upload MP4, MOV, or MKV files only.');
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        onError?.('File size must be less than 500MB.');
        return;
      }
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, ''));
      }
    },
    [onError, title]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragActive(false);

      const file = event.dataTransfer.files?.[0];
      if (file) {
        validateAndSelect(file);
      }
    },
    [validateAndSelect]
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      validateAndSelect(file);
    }
  };

  const handleSubmit = () => {
    if (selectedFile && title.trim()) {
      onFileSelect(selectedFile, title);
      setSelectedFile(null);
      setTitle('');
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setTitle('');
    onClear?.();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Uploading state
  if (isUploading) {
    return (
      <Card className="p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Upload className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">Uploading video...</h3>
            <p className="text-sm text-muted-foreground">{uploadProgress}% complete</p>
          </div>
        </div>
        <Progress value={uploadProgress} className="h-2" />
      </Card>
    );
  }

  // File selected state (showing title input)
  if (selectedFile) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
            <FileVideo className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-foreground">{selectedFile.name}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{formatFileSize(selectedFile.size)}</p>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium text-zinc-300">
                Analysis Title
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Login Flow - v1"
                autoFocus
              />
            </div>

            <div className="mt-4 flex gap-3">
              <Button
                onClick={handleSubmit}
                disabled={!title.trim()}
              >
                Start Analysis
              </Button>
              <Button
                variant="outline"
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // Default upload state
  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200',
        isDragActive
          ? 'scale-[1.01] border-primary bg-primary/5'
          : 'border-border bg-card/40 hover:border-muted-foreground/50 hover:bg-card/60'
      )}
    >
      <input
        type="file"
        accept=".mp4,.mov,.mkv,video/*"
        onChange={handleChange}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />

      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
        <Upload
          className={cn(
            'h-7 w-7 transition-colors',
            isDragActive ? 'text-primary' : 'text-muted-foreground'
          )}
        />
      </div>

      <p className="mb-1 text-lg font-medium text-foreground">
        {isDragActive ? 'Drop video here' : 'Drop video or click to browse'}
      </p>
      <p className="text-sm text-muted-foreground">MP4, MOV, MKV up to 500MB</p>
    </div>
  );
}
