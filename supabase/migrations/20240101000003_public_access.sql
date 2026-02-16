-- Disable RLS for development (allow public access)
ALTER TABLE analysis_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE frames DISABLE ROW LEVEL SECURITY;
ALTER TABLE frame_analyses DISABLE ROW LEVEL SECURITY;
ALTER TABLE run_summaries DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Drop existing storage policies
DROP POLICY IF EXISTS "Users can upload their own videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own videos" ON storage.objects;
DROP POLICY IF EXISTS "Service role has full access" ON storage.objects;

-- Allow public access to videos bucket
CREATE POLICY "Public can upload videos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'videos');

CREATE POLICY "Public can read videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'videos');

CREATE POLICY "Public can delete videos"
ON storage.objects FOR DELETE
USING (bucket_id = 'videos');
