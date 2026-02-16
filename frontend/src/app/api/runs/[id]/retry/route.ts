import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const ANON_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    const db = user ? supabase : createServiceClient();
    const userId = user?.id || ANON_USER_ID;

    if (authError) {
      console.warn('[api/runs/retry] Auth error, proceeding as anonymous', authError);
    }

    const { data: run, error: runError } = await db
      .from('analysis_runs')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', userId)
      .single();

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (!['completed', 'failed'].includes(run.status)) {
      return NextResponse.json(
        { error: 'Retry is only available after analysis is complete' },
        { status: 400 }
      );
    }

    if (!run.video_storage_path) {
      return NextResponse.json(
        { error: 'Video path missing for run' },
        { status: 400 }
      );
    }

    const pathParts = run.video_storage_path.split('/');
    const fileName = pathParts.pop();
    const folderPath = pathParts.join('/');

    if (!fileName) {
      return NextResponse.json(
        { error: 'Video path is invalid' },
        { status: 400 }
      );
    }

    const { data: files, error: listError } = await db.storage
      .from('videos')
      .list(folderPath, { search: fileName, limit: 10 });

    if (listError) {
      console.error('Error verifying uploaded video:', listError);
      return NextResponse.json(
        { error: 'Failed to verify uploaded video' },
        { status: 500 }
      );
    }

    const uploadedFile = files?.find((file) => file.name === fileName);
    const uploadedSize =
      uploadedFile?.metadata?.size ?? (uploadedFile as { size?: number } | undefined)?.size;

    if (!uploadedFile || !uploadedSize || uploadedSize <= 0) {
      return NextResponse.json(
        { error: 'Uploaded video not found or empty' },
        { status: 400 }
      );
    }

    console.log('[api/runs/retry] Clearing previous analysis', {
      runId: run.id,
      userId,
    });

    const { error: summaryDeleteError } = await db
      .from('run_summaries')
      .delete()
      .eq('run_id', params.id);

    if (summaryDeleteError) {
      console.error('[api/runs/retry] Failed to delete summary', summaryDeleteError);
      return NextResponse.json(
        { error: 'Failed to clear previous summary' },
        { status: 500 }
      );
    }

    const { error: framesDeleteError } = await db
      .from('frames')
      .delete()
      .eq('run_id', params.id);

    if (framesDeleteError) {
      console.error('[api/runs/retry] Failed to delete frames', framesDeleteError);
      return NextResponse.json(
        { error: 'Failed to clear previous frames' },
        { status: 500 }
      );
    }

    const { error: updateError } = await db
      .from('analysis_runs')
      .update({
        status: 'queued',
        progress_percentage: 0,
        progress_message: 'Queued for processing',
        error_message: null,
      })
      .eq('id', params.id);

    if (updateError) {
      console.error('[api/runs/retry] Failed to queue run', updateError);
      return NextResponse.json(
        { error: 'Failed to queue run' },
        { status: 500 }
      );
    }

    const processorUrl = process.env.PROCESSOR_BASE_URL;
    const webhookSecret = process.env.PROCESSOR_WEBHOOK_SECRET;

    if (processorUrl && webhookSecret) {
      try {
        await fetch(`${processorUrl}/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': webhookSecret,
          },
          body: JSON.stringify({ run_id: params.id }),
        });
      } catch (error) {
        console.error('[api/runs/retry] Failed to notify processor:', error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST /api/runs/:id/retry:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
