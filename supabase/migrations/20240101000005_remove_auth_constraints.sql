-- Remove foreign key constraint from analysis_runs to profiles
-- This allows us to use anonymous user IDs for development without authentication

-- First, drop the existing foreign key constraint
ALTER TABLE analysis_runs DROP CONSTRAINT IF EXISTS analysis_runs_user_id_fkey;

-- Make user_id nullable to allow runs without users
ALTER TABLE analysis_runs ALTER COLUMN user_id DROP NOT NULL;

-- Drop the profiles table entirely since we're not using authentication
DROP TABLE IF EXISTS profiles CASCADE;

-- Recreate profiles table without foreign key to auth.users
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the anonymous user profile
INSERT INTO profiles (id, full_name) VALUES
  ('00000000-0000-0000-0000-000000000000', 'Anonymous User')
ON CONFLICT (id) DO NOTHING;

-- Add back a simpler foreign key constraint that allows NULL
ALTER TABLE analysis_runs
  ADD CONSTRAINT analysis_runs_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES profiles(id)
  ON DELETE SET NULL;
