import {
  createRun,
  ensureProfile,
  getFrameCountForRun,
  getRunSummary,
  getRunsByUser,
} from '@/lib/azure/db';
import { generateUploadSasUrl } from '@/lib/azure/storage';
import { getAuthenticatedUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth/require-auth';
import { createRunSchema } from '@interactive-flow/shared';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_EXTENSIONS = new Set(['mp4', 'mov', 'mkv']);
const ALLOWED_CONTENT_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/matroska']);
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;

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
    const user = await getAuthenticatedUser();
    await ensureProfile(user.oid, user.name ?? user.email ?? null);

    const body = await request.json();
    const validation = createRunSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request', details: validation.error.flatten() }, { status: 400 });
    }

    const { title, fileName, contentType } = validation.data;

    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: 'Unsupported video type. Please upload MP4, MOV, or MKV.' },
        { status: 400 }
      );
    }

    const extension = resolveVideoExtension(fileName, contentType);

    if (!extension) {
      return NextResponse.json(
        { error: 'Unsupported video type. Please upload MP4, MOV, or MKV.' },
        { status: 400 }
      );
    }

    const runId = uuidv4();
    const videoPath = `${user.oid}/runs/${runId}/video.${extension}`;

    const run = await createRun({
      id: runId,
      userId: user.oid,
      title,
      videoStoragePath: videoPath,
    });

    if (!run) {
      throw new Error('Run was not created');
    }

    const uploadUrl = await generateUploadSasUrl(videoPath, 20);

    return NextResponse.json({
      run,
      uploadUrl,
      uploadConstraints: {
        maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
        allowedMimeTypes: Array.from(ALLOWED_CONTENT_TYPES),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in POST /api/runs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    const runs = await getRunsByUser(user.oid);

    const enrichedRuns = await Promise.all(
      runs.map(async (run) => {
        const frameCount = await getFrameCountForRun(run.id);

        let overallScore: number | undefined;
        let weightedScore100: number | undefined;
        let criticalIssueCount: number | undefined;
        let qualityGateStatus: 'pass' | 'warn' | 'block' | undefined;
        let metricVersion: string | undefined;

        if (run.status === 'completed') {
          const summary = await getRunSummary(run.id);

          if (summary?.overall_scores) {
            overallScore = Object.values(summary.overall_scores).reduce(
              (sum: number, score) => sum + (score as number),
              0
            );
            weightedScore100 = summary.weighted_score_100;
            criticalIssueCount = summary.critical_issue_count;
            qualityGateStatus = summary.quality_gate_status;
            metricVersion = summary.metric_version;
          }
        }

        return {
          ...run,
          frameCount,
          overallScore,
          weighted_score_100: weightedScore100,
          critical_issue_count: criticalIssueCount,
          quality_gate_status: qualityGateStatus,
          metric_version: metricVersion,
        };
      })
    );

    return NextResponse.json({ runs: enrichedRuns });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    console.error('Error in GET /api/runs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
