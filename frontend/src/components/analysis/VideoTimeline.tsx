'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameWithAnalysis } from '@interactive-flow/shared';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface VideoTimelineProps {
  videoUrl: string | null;
  keyframes: FrameWithAnalysis[];
  selectedIndex: number;
  onSelectFrame: (index: number) => void;
  videoDuration?: number;
}

export default function VideoTimeline({
  videoUrl,
  keyframes,
  selectedIndex,
  onSelectFrame,
  videoDuration: externalDuration,
}: VideoTimelineProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(externalDuration || 0);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);

  // Update current time as video plays
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime * 1000);
    const handleDurationChange = () => setDuration(video.duration * 1000);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('loadedmetadata', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('loadedmetadata', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Sync selected frame with video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || keyframes.length === 0) return;

    const selectedFrame = keyframes[selectedIndex];
    if (selectedFrame) {
      const targetTime = selectedFrame.timestamp_ms / 1000;
      // Only seek if difference is significant (> 100ms)
      if (Math.abs(video.currentTime - targetTime) > 0.1) {
        video.currentTime = targetTime;
      }
    }
  }, [selectedIndex, keyframes]);

  // Find nearest keyframe to current time
  useEffect(() => {
    if (!isPlaying || keyframes.length === 0) return;

    // Find the keyframe closest to current time
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    keyframes.forEach((frame, index) => {
      const distance = Math.abs(frame.timestamp_ms - currentTime);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    // Auto-select if within 200ms of a keyframe
    if (nearestDistance < 200 && nearestIndex !== selectedIndex) {
      onSelectFrame(nearestIndex);
    }
  }, [currentTime, isPlaying, keyframes, selectedIndex, onSelectFrame]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  }, [isPlaying]);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      const timeline = timelineRef.current;
      if (!video || !timeline || !duration) return;

      const rect = timeline.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      const newTime = percentage * duration;

      video.currentTime = newTime / 1000;
      setCurrentTime(newTime);
    },
    [duration]
  );

  const handleTimelineHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const timeline = timelineRef.current;
      if (!timeline || !duration) return;

      const rect = timeline.getBoundingClientRect();
      const hoverX = e.clientX - rect.left;
      const percentage = hoverX / rect.width;
      setHoverTime(percentage * duration);
    },
    [duration]
  );

  const handleMarkerClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const video = videoRef.current;
      const frame = keyframes[index];

      if (video && frame) {
        video.currentTime = frame.timestamp_ms / 1000;
        setCurrentTime(frame.timestamp_ms);
      }

      onSelectFrame(index);
    },
    [keyframes, onSelectFrame]
  );

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const playheadPosition = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!videoUrl) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground text-center">Video not available</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-4">
      <h2 className="text-xl font-bold text-foreground">Video Timeline</h2>

      {/* Video Player */}
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          playsInline
          onClick={togglePlayPause}
        />

        {/* Play/Pause Overlay */}
        <button
          onClick={togglePlayPause}
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity',
            isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
          )}
        >
          <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            {isPlaying ? (
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        </button>

        {/* Current Time Display */}
        <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-xs text-white font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      {/* Timeline Bar */}
      <div
        ref={timelineRef}
        className="relative h-12 bg-zinc-800 rounded-lg cursor-pointer select-none"
        onClick={handleTimelineClick}
        onMouseMove={handleTimelineHover}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Progress Bar */}
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-600/40 to-cyan-500/20 rounded-l-lg transition-all"
          style={{ width: `${playheadPosition}%` }}
        />

        {/* Keyframe Markers */}
        {keyframes.map((frame, index) => {
          const position = duration > 0 ? (frame.timestamp_ms / duration) * 100 : 0;
          const isSelected = index === selectedIndex;

          return (
            <button
              key={frame.id}
              onClick={(e) => handleMarkerClick(index, e)}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 transition-all',
                'w-4 h-4 rounded-full border-2',
                isSelected
                  ? 'bg-cyan-400 border-cyan-300 scale-125 shadow-lg shadow-cyan-400/50'
                  : 'bg-zinc-600 border-zinc-500 hover:bg-cyan-500 hover:border-cyan-400 hover:scale-110'
              )}
              style={{ left: `${position}%` }}
              title={`Keyframe ${index + 1} - ${formatTime(frame.timestamp_ms)}`}
            />
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 shadow-lg shadow-cyan-400/50 z-20"
          style={{ left: `${playheadPosition}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-full" />
        </div>

        {/* Hover Time Indicator */}
        {isHovering && (
          <div
            className="absolute -top-8 -translate-x-1/2 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-white font-mono"
            style={{ left: `${(hoverTime / duration) * 100}%` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>

      {/* Keyframe Navigation Hint */}
      <p className="text-xs text-muted-foreground text-center">
        Click markers to jump to keyframes. {keyframes.length} keyframes detected.
      </p>
    </Card>
  );
}
