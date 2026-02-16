import {
  deleteRun,
  getKeyframesWithAnalyses,
  getPreviousCompletedRunSummaryByTitle,
  getRunByIdAndUser,
  getRunSummary,
  updateRun,
} from '@/lib/azure/db';
import { deleteBlob, deleteBlobsInFolder, generateDownloadSasUrl } from '@/lib/azure/storage';
import { getAuthenticatedUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth/require-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const routeParamsSchema = z.object({ id: z.string().uuid() });
const patchBodySchema = z.object({ action: z.literal('stop') });
type RouteContext = { params: Promise<{ id: string }> };

function buildDelta(current?: number, previous?: number) {
  if (typeof current !== 'number' || typeof previous !== 'number') return null;
  return Number((current - previous).toFixed(2));
}

export async function GET(
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

    const summary = await getRunSummary(runId);
    const previousSummary = await getPreviousCompletedRunSummaryByTitle({
      userId: user.oid,
      title: run.title,
      currentRunId: runId,
    });

    const frames = await getKeyframesWithAnalyses(runId);
    const framesWithUrls = await Promise.all(
      frames.map(async (frame) => ({
        ...frame,
        url: await generateDownloadSasUrl(frame.storage_path, 15),
      }))
    );

    const regression =
      summary && previousSummary
        ? {
            previous_run_summary: previousSummary,
            weighted_score_delta: buildDelta(summary.weighted_score_100, previousSummary.weighted_score_100),
            critical_issue_delta: buildDelta(summary.critical_issue_count, previousSummary.critical_issue_count),
          }
        : null;

    return NextResponse.json({
      run,
      summary,
      keyframes: framesWithUrls,
      regression,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in GET /api/runs/:id:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
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

    if (run.video_storage_path) {
      const videoPath = run.video_storage_path;
      const folderPath = videoPath.substring(0, videoPath.lastIndexOf('/'));

      try {
        await deleteBlob(videoPath);
      } catch (error) {
        console.warn('[api/runs/:id] Storage deletion warning:', error);
      }

      try {
        await deleteBlobsInFolder(`${folderPath}/frames`);
      } catch (error) {
        console.warn('[api/runs/:id] Frames deletion warning:', error);
      }
    }

    await deleteRun(runId, user.oid);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in DELETE /api/runs/:id:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  try {
    const user = await getAuthenticatedUser();
    const parsedParams = routeParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    }

    const runId = parsedParams.data.id;
    const body = await request.json();
    const parsedBody = patchBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const run = await getRunByIdAndUser(runId, user.oid);
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status === 'cancel_requested' || run.status === 'cancelled') {
      return NextResponse.json({ success: true, status: run.status });
    }

    if (run.status !== 'processing' && run.status !== 'queued') {
      return NextResponse.json({ error: 'Can only cancel queued or running analyses' }, { status: 400 });
    }

    await updateRun(runId, {
      status: 'cancel_requested',
      cancel_requested: 1,
      progress_message: 'Cancellation requested by user',
    });

    return NextResponse.json({ success: true, status: 'cancel_requested' });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in PATCH /api/runs/:id:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
