import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const ANON_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    const db = user ? supabase : createServiceClient();
    const userId = user?.id || ANON_USER_ID;

    if (authError) {
      console.warn('[api/runs/:id] Auth error, proceeding as anonymous', authError);
    }

    // Fetch run
    const { data: run, error: runError } = await db
      .from('analysis_runs')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', userId)
      .single();

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Fetch summary
    const { data: summary } = await db
      .from('run_summaries')
      .select('*')
      .eq('run_id', params.id)
      .single();

    // Fetch keyframes with analyses
    const { data: frames } = await db
      .from('frames')
      .select(`
        *,
        analysis:frame_analyses(*)
      `)
      .eq('run_id', params.id)
      .eq('is_keyframe', true)
      .order('timestamp_ms', { ascending: true });

    // Get signed URLs for frames
    const framesWithUrls = await Promise.all(
      (frames || []).map(async (frame) => {
        const { data: urlData } = await db.storage
          .from('videos')
          .createSignedUrl(frame.storage_path, 3600);

        return {
          ...frame,
          url: urlData?.signedUrl,
        };
      })
    );

    return NextResponse.json({
      run,
      summary,
      keyframes: framesWithUrls,
    });
  } catch (error) {
    console.error('Error in GET /api/runs/:id:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const db = user ? supabase : createServiceClient();
    const userId = user?.id || ANON_USER_ID;

    // Verify ownership
    const { data: run, error: runError } = await db
      .from('analysis_runs')
      .select('video_storage_path')
      .eq('id', params.id)
      .eq('user_id', userId)
      .single();

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Delete video and frames from storage
    if (run.video_storage_path) {
      const videoPath = run.video_storage_path;
      const folderPath = videoPath.substring(0, videoPath.lastIndexOf('/'));

      // Delete entire folder (video + frames)
      const { error: storageError } = await db.storage
        .from('videos')
        .remove([videoPath]);

      if (storageError) {
        console.warn('[api/runs/:id] Storage deletion warning:', storageError);
      }

      // Try to delete frames folder
      const { data: files } = await db.storage
        .from('videos')
        .list(folderPath);

      if (files && files.length > 0) {
        const filePaths = files.map(f => `${folderPath}/${f.name}`);
        await db.storage.from('videos').remove(filePaths);
      }
    }

    // Delete run record (cascade handles related tables)
    const { error: deleteError } = await db
      .from('analysis_runs')
      .delete()
      .eq('id', params.id)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[api/runs/:id] Error deleting run:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete analysis' },
        { status: 500 }
      );
    }

    console.log('[api/runs/:id] Deleted run', { runId: params.id, userId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/runs/:id:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const db = user ? supabase : createServiceClient();
    const userId = user?.id || ANON_USER_ID;

    const body = await request.json();
    const { action } = body;

    if (action === 'stop') {
      // Verify ownership and check status
      const { data: run, error: runError } = await db
        .from('analysis_runs')
        .select('status')
        .eq('id', params.id)
        .eq('user_id', userId)
        .single();

      if (runError || !run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      }

      if (run.status !== 'processing' && run.status !== 'queued') {
        return NextResponse.json(
          { error: 'Can only stop running or queued analyses' },
          { status: 400 }
        );
      }

      // Update status to failed with stop message
      const { error: updateError } = await db
        .from('analysis_runs')
        .update({
          status: 'failed',
          error_message: 'Stopped by user',
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.id)
        .eq('user_id', userId);

      if (updateError) {
        console.error('[api/runs/:id] Error stopping run:', updateError);
        return NextResponse.json(
          { error: 'Failed to stop analysis' },
          { status: 500 }
        );
      }

      console.log('[api/runs/:id] Stopped run', { runId: params.id, userId });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error in PATCH /api/runs/:id:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
