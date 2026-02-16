import { createClient, createServiceClient } from '@/lib/supabase/server';
import { createRunSchema } from '@interactive-flow/shared';
import { NextResponse } from 'next/server';

const ANON_USER_ID = '00000000-0000-0000-0000-000000000000';
const ALLOWED_EXTENSIONS = new Set(['mp4', 'mov', 'mkv']);
const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/matroska': 'mkv',
};

function resolveVideoExtension(fileName?: string, contentType?: string) {
  const nameExtension = fileName?.split('.').pop()?.toLowerCase();
  if (nameExtension && ALLOWED_EXTENSIONS.has(nameExtension)) {
    return nameExtension;
  }

  const contentExtension = contentType ? CONTENT_TYPE_EXTENSION_MAP[contentType] : undefined;
  if (contentExtension && ALLOWED_EXTENSIONS.has(contentExtension)) {
    return contentExtension;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const db = user ? supabase : createServiceClient();

    // Use anonymous user ID if not authenticated (for development)
    const userId = user?.id || ANON_USER_ID;

    const body = await request.json();
    const validation = createRunSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error },
        { status: 400 }
      );
    }

    const { title, fileName, contentType } = validation.data;
    const extension = resolveVideoExtension(fileName, contentType);

    if (!extension) {
      return NextResponse.json(
        { error: 'Unsupported video type. Please upload MP4, MOV, or MKV.' },
        { status: 400 }
      );
    }

    // Create analysis run
    const { data: run, error: insertError } = await db
      .from('analysis_runs')
      .insert({
        user_id: userId,
        title,
        video_storage_path: '', // Will be updated after upload
        status: 'uploaded',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating run:', insertError);
      return NextResponse.json(
        { error: 'Failed to create analysis run' },
        { status: 500 }
      );
    }

    console.log('[api/runs] Created run', {
      runId: run.id,
      userId,
      title,
      fileName,
      contentType,
    });

    // Generate signed upload URL with user ID in path
    const videoPath = `${userId}/runs/${run.id}/video.${extension}`;
    const { data: uploadData, error: uploadError } = await db.storage
      .from('videos')
      .createSignedUploadUrl(videoPath);

    if (uploadError) {
      console.error('Error creating upload URL:', uploadError);
      return NextResponse.json(
        { error: 'Failed to create upload URL' },
        { status: 500 }
      );
    }

    // Update run with video path
    const { error: updateError } = await db
      .from('analysis_runs')
      .update({ video_storage_path: videoPath })
      .eq('id', run.id);

    if (updateError) {
      console.error('Error updating run video path:', updateError);
      return NextResponse.json(
        { error: 'Failed to update analysis run' },
        { status: 500 }
      );
    }

    console.log('[api/runs] Upload URL issued', {
      runId: run.id,
      videoPath,
    });

    return NextResponse.json({
      run: { ...run, video_storage_path: videoPath },
      uploadUrl: uploadData.signedUrl,
      uploadToken: uploadData.token,
    });
  } catch (error) {
    console.error('Error in POST /api/runs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const db = user ? supabase : createServiceClient();

    // Use anonymous user ID if not authenticated (for development)
    const userId = user?.id || ANON_USER_ID;

    const { data: runs, error } = await db
      .from('analysis_runs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching runs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch runs' },
        { status: 500 }
      );
    }

    // Enrich each run with frame count and overall score
    const enrichedRuns = await Promise.all(
      runs.map(async (run) => {
        // Get frame count
        const { count: frameCount } = await db
          .from('frames')
          .select('*', { count: 'exact', head: true })
          .eq('run_id', run.id);

        // Get overall score from summary (only for completed runs)
        let overallScore;
        if (run.status === 'completed') {
          const { data: summary } = await db
            .from('run_summaries')
            .select('overall_scores')
            .eq('run_id', run.id)
            .single();

          if (summary?.overall_scores) {
            // Calculate overall score as sum of all categories (7 categories, 0-2 each = max 14)
            overallScore = Object.values(summary.overall_scores).reduce(
              (sum: number, score) => sum + (score as number),
              0
            );
          }
        }

        return {
          ...run,
          frameCount: frameCount || 0,
          overallScore,
        };
      })
    );

    return NextResponse.json({ runs: enrichedRuns });
  } catch (error) {
    console.error('Error in GET /api/runs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
