import { createWebhookSignature } from '@interactive-flow/shared/security';
import { getServerEnv } from '@/lib/env/server';
import { randomUUID } from 'crypto';

export async function notifyProcessor(runId: string): Promise<void> {
  const env = getServerEnv();
  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const payload = JSON.stringify({ run_id: runId });
  const signature = createWebhookSignature(
    env.PROCESSOR_WEBHOOK_SECRET,
    timestamp,
    nonce,
    payload
  );

  const response = await fetch(`${env.PROCESSOR_BASE_URL}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': env.PROCESSOR_WEBHOOK_SECRET,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Nonce': nonce,
      'X-Webhook-Signature': signature,
    },
    body: payload,
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`Processor webhook failed (${response.status}): ${errorPayload}`);
  }
}
