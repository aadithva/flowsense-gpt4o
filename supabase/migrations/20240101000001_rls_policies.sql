-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE frame_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_summaries ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Analysis runs policies
CREATE POLICY "Users can view their own runs"
  ON analysis_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own runs"
  ON analysis_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own runs"
  ON analysis_runs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own runs"
  ON analysis_runs FOR DELETE
  USING (auth.uid() = user_id);

-- Frames policies
CREATE POLICY "Users can view frames from their runs"
  ON frames FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM analysis_runs
      WHERE analysis_runs.id = frames.run_id
      AND analysis_runs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert frames for their runs"
  ON frames FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM analysis_runs
      WHERE analysis_runs.id = frames.run_id
      AND analysis_runs.user_id = auth.uid()
    )
  );

-- Frame analyses policies
CREATE POLICY "Users can view analyses from their runs"
  ON frame_analyses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM frames
      JOIN analysis_runs ON analysis_runs.id = frames.run_id
      WHERE frames.id = frame_analyses.frame_id
      AND analysis_runs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert analyses for their frames"
  ON frame_analyses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM frames
      JOIN analysis_runs ON analysis_runs.id = frames.run_id
      WHERE frames.id = frame_analyses.frame_id
      AND analysis_runs.user_id = auth.uid()
    )
  );

-- Run summaries policies
CREATE POLICY "Users can view summaries of their runs"
  ON run_summaries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM analysis_runs
      WHERE analysis_runs.id = run_summaries.run_id
      AND analysis_runs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert summaries for their runs"
  ON run_summaries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM analysis_runs
      WHERE analysis_runs.id = run_summaries.run_id
      AND analysis_runs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update summaries of their runs"
  ON run_summaries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM analysis_runs
      WHERE analysis_runs.id = run_summaries.run_id
      AND analysis_runs.user_id = auth.uid()
    )
  );
