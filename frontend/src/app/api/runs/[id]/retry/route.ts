import {
  deleteFramesForRun,
  deleteSummaryForRun,
  getRunByIdAndUser,
  updateRun,
} from '@/lib/azure/db';
import { getBlobInfo } from '@/lib/azure/storage';
import { getAuthenticatedUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth/require-auth';
import { notifyProcessor } from '@/lib/security/webhook';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const routeParamsSchema = z.object({ id: z.string().uuid() });
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const user = await getAuthenticatedUser();
    const parsedParams = routeParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    }

    const runId = parsedParams.data.id;
    const run = await getRunByIdAndUser(runId, user.oid);

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status === 'queued' || run.status === 'processing') {
      return NextResponse.json({ success: true, status: run.status });
    }

    if (!['completed', 'failed', 'cancelled', 'cancel_requested'].includes(run.status)) {
      return NextResponse.json({ error: 'Retry is not available for this run state' }, { status: 400 });
    }

    if (!run.video_storage_path) {
      return NextResponse.json({ error: 'Video path missing for run' }, { status: 400 });
    }

    const blobInfo = await getBlobInfo(run.video_storage_path);

    if (!blobInfo.exists || blobInfo.size <= 0) {
      return NextResponse.json({ error: 'Uploaded video not found or empty' }, { status: 400 });
    }

    if (blobInfo.size > MAX_VIDEO_SIZE_BYTES) {
      return NextResponse.json({ error: 'Uploaded video exceeds the 500MB limit' }, { status: 400 });
    }

    await deleteSummaryForRun(runId);
    await deleteFramesForRun(runId);

    await updateRun(runId, {
      status: 'queued',
      progress_percentage: 0,
      progress_message: 'Queued for processing',
      cancel_requested: 0,
      error_message: null,
    });

    try {
      await notifyProcessor(runId);
    } catch (error) {
      console.error('[api/runs/retry] Failed to notify processor:', error);
    }

    return NextResponse.json({ success: true, status: 'queued' });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in POST /api/runs/:id/retry:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
