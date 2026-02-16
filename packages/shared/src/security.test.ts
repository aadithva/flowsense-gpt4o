import { describe, expect, it } from 'vitest';
import { createWebhookSignature, verifyWebhookSignature } from './security';

describe('webhook signatures', () => {
  it('validates authentic signatures', () => {
    const secret = 'super-secret-1234567890';
    const timestamp = Date.now().toString();
    const nonce = 'nonce-1';
    const body = JSON.stringify({ run_id: 'run-123' });
    const signature = createWebhookSignature(secret, timestamp, nonce, body);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        nonce,
        body,
        providedSignature: signature,
      })
    ).toBe(true);
  });

  it('rejects tampered payloads', () => {
    const secret = 'super-secret-1234567890';
    const timestamp = Date.now().toString();
    const nonce = 'nonce-1';
    const body = JSON.stringify({ run_id: 'run-123' });
    const signature = createWebhookSignature(secret, timestamp, nonce, body);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        nonce,
        body: JSON.stringify({ run_id: 'run-999' }),
        providedSignature: signature,
      })
    ).toBe(false);
  });
});
