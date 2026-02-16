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
      console.warn('[api/runs/:id/status] Auth error, proceeding as anonymous', authError);
    }

    const { data: run, error } = await db
      .from('analysis_runs')
      .select('id, status, error_message, updated_at')
      .eq('id', params.id)
      .eq('user_id', userId)
      .single();

    if (error || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    return NextResponse.json(run);
  } catch (error) {
    console.error('Error in GET /api/runs/:id/status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
