-- Add progress tracking fields to analysis_runs table
ALTER TABLE analysis_runs
ADD COLUMN progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
ADD COLUMN progress_message TEXT DEFAULT '';

-- Create index for querying runs by progress
CREATE INDEX idx_analysis_runs_progress ON analysis_runs(progress_percentage);

-- Update existing runs to have 0 progress
UPDATE analysis_runs SET progress_percentage = 0 WHERE progress_percentage IS NULL;
