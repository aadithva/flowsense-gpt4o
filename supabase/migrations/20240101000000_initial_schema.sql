-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for analysis status
CREATE TYPE analysis_status AS ENUM ('uploaded', 'queued', 'processing', 'completed', 'failed');

-- Profiles table (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analysis runs table
CREATE TABLE analysis_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_storage_path TEXT NOT NULL,
  status analysis_status NOT NULL DEFAULT 'uploaded',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Frames table
CREATE TABLE frames (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  is_keyframe BOOLEAN NOT NULL DEFAULT FALSE,
  diff_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Frame analyses table
CREATE TABLE frame_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  frame_id UUID NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  rubric_scores JSONB NOT NULL,
  justifications JSONB NOT NULL,
  issue_tags TEXT[] NOT NULL DEFAULT '{}',
  suggestions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Run summaries table
CREATE TABLE run_summaries (
  run_id UUID PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  overall_scores JSONB NOT NULL,
  top_issues JSONB NOT NULL DEFAULT '[]',
  recommendations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_analysis_runs_user_id ON analysis_runs(user_id);
CREATE INDEX idx_analysis_runs_status ON analysis_runs(status);
CREATE INDEX idx_frames_run_id ON frames(run_id);
CREATE INDEX idx_frames_is_keyframe ON frames(is_keyframe);
CREATE INDEX idx_frame_analyses_frame_id ON frame_analyses(frame_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to analysis_runs
CREATE TRIGGER update_analysis_runs_updated_at
  BEFORE UPDATE ON analysis_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
