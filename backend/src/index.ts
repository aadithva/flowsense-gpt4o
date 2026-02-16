import 'dotenv/config';
import express from 'express';
import { processRun } from './processor';
import { pollForJobs } from './poller';
import { claimRunById } from './azure-db';
import { getEnv } from './env';
import { verifyWebhookSignature } from '@interactive-flow/shared/security';
import { trackEvent, trackException } from './telemetry';

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

const app = express();
const env = getEnv();
const nonceCache = new Map<string, number>();
const NONCE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as Express.Request).rawBody = buffer.toString('utf8');
    },
  })
);

function cleanupNonceCache(now: number) {
  for (const [nonce, expiresAt] of nonceCache.entries()) {
    if (expiresAt <= now) {
      nonceCache.delete(nonce);
    }
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', workerId: env.PROCESSOR_WORKER_ID });
});

app.post('/process', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const nonce = req.headers['x-webhook-nonce'];
  const signature = req.headers['x-webhook-signature'];

  if (
    typeof secret !== 'string' ||
    typeof timestamp !== 'string' ||
    typeof nonce !== 'string' ||
    typeof signature !== 'string'
  ) {
    return res.status(401).json({ error: 'Missing webhook authentication headers' });
  }

  if (secret !== env.WEBHOOK_SECRET) {
    trackEvent('processor.webhook_rejected', { reason: 'secret_mismatch' });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return res.status(400).json({ error: 'Invalid webhook timestamp' });
  }

  const now = Date.now();
  if (Math.abs(now - timestampMs) > CLOCK_SKEW_MS) {
    trackEvent('processor.webhook_rejected', { reason: 'stale_timestamp' });
    return res.status(401).json({ error: 'Stale webhook timestamp' });
  }

  cleanupNonceCache(now);
  if (nonceCache.has(nonce)) {
    trackEvent('processor.webhook_rejected', { reason: 'replay_nonce' });
    return res.status(409).json({ error: 'Webhook nonce replay detected' });
  }

  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const isValidSignature = verifyWebhookSignature({
    secret: env.WEBHOOK_SECRET,
    timestamp,
    nonce,
    body: rawBody,
    providedSignature: signature,
  });

  if (!isValidSignature) {
    trackEvent('processor.webhook_rejected', { reason: 'invalid_signature' });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  nonceCache.set(nonce, now + NONCE_TTL_MS);

  const runId = typeof req.body?.run_id === 'string' ? req.body.run_id : null;
  if (!runId) {
    trackEvent('processor.webhook_rejected', { reason: 'missing_run_id' });
    return res.status(400).json({ error: 'run_id is required' });
  }

  const claimed = await claimRunById(runId, env.PROCESSOR_WORKER_ID);
  if (!claimed) {
    trackEvent('processor.run_claim_skipped', { runId });
    return res.status(202).json({ success: true, message: 'Run already claimed or not queued' });
  }

  trackEvent('processor.run_claimed', { runId, workerId: env.PROCESSOR_WORKER_ID });
  processRun(runId).catch((error) => {
    console.error(`Failed to process run ${runId}:`, error);
    trackException(error, { runId });
  });

  return res.json({ success: true, message: 'Processing started', run_id: runId });
});

app.listen(env.PORT, () => {
  console.log(`Processor running on port ${env.PORT}`);
  pollForJobs();
});
