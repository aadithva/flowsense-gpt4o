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
      console.warn('[api/runs/enqueue] Auth error, proceeding as anonymous', authError);
    }

    // Verify run ownership
    const { data: run, error: runError } = await db
      .from('analysis_runs')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', userId)
      .single();

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status !== 'uploaded') {
      return NextResponse.json(
        { error: 'Run already queued or processing' },
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

    console.log('[api/runs/enqueue] Upload verified', {
      runId: run.id,
      videoPath: run.video_storage_path,
      sizeBytes: uploadedSize,
    });

    // Update status to queued
    const { error: updateError } = await db
      .from('analysis_runs')
      .update({
        status: 'queued',
        progress_percentage: 0,
        progress_message: 'Queued for processing',
      })
      .eq('id', params.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to queue run' },
        { status: 500 }
      );
    }

    console.log('[api/runs/enqueue] Run queued', {
      runId: run.id,
      userId,
    });

    // Trigger processor via webhook
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
        console.error('Failed to notify processor:', error);
        // Don't fail the request if processor notification fails
        // The processor can poll for queued jobs instead
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST /api/runs/:id/enqueue:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
