'use client';

import { useCallback, useState } from 'react';
import { FileVideo, Upload, Video, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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

  const validateAndSelect = (file: File) => {
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
    // Auto-fill title from filename (remove extension)
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

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
    [title]
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
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
            <Upload className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">Uploading video...</h3>
            <p className="text-sm text-zinc-500">{uploadProgress}% complete</p>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-cyan-500 transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      </div>
    );
  }

  // File selected state (showing title input)
  if (selectedFile) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
            <FileVideo className="h-6 w-6 text-cyan-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-white">{selectedFile.name}</p>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full p-1 transition-colors hover:bg-zinc-800"
              >
                <X className="h-4 w-4 text-zinc-500" />
              </button>
            </div>
            <p className="text-sm text-zinc-500">{formatFileSize(selectedFile.size)}</p>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Analysis Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Login Flow - v1"
                className="w-full rounded-lg border border-zinc-800 bg-black px-4 py-2 text-white placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                autoFocus
              />
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={!title.trim()}
                className="rounded-lg bg-cyan-500 px-4 py-2 font-medium text-black transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-cyan-500"
              >
                Start Analysis
              </button>
              <button
                onClick={handleCancel}
                className="rounded-lg border border-zinc-800 bg-transparent px-4 py-2 font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
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
          ? 'scale-[1.01] border-cyan-500 bg-cyan-500/5'
          : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/60'
      )}
    >
      <input
        type="file"
        accept=".mp4,.mov,.mkv,video/*"
        onChange={handleChange}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />

      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
        <Upload
          className={cn(
            'h-7 w-7 transition-colors',
            isDragActive ? 'text-cyan-400' : 'text-zinc-500'
          )}
        />
      </div>

      <p className="mb-1 text-lg font-medium text-white">
        {isDragActive ? 'Drop video here' : 'Drop video or click to browse'}
      </p>
      <p className="text-sm text-zinc-500">MP4, MOV, MKV up to 500MB</p>
    </div>
  );
}
