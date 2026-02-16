import { getRunByIdAndUser } from '@/lib/azure/db';
import { getAuthenticatedUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth/require-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const routeParamsSchema = z.object({ id: z.string().uuid() });
type RouteContext = { params: Promise<{ id: string }> };

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

    const run = await getRunByIdAndUser(parsedParams.data.id, user.oid);

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: run.id,
      status: run.status,
      cancel_requested: Boolean(run.cancel_requested),
      error_message: run.error_message,
      updated_at: run.updated_at,
      progress_percentage: run.progress_percentage,
      progress_message: run.progress_message,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in GET /api/runs/:id/status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
