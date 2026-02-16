import { createHmac, timingSafeEqual } from 'crypto';

export function createWebhookSignature(secret: string, timestamp: string, nonce: string, body: string): string {
  const payload = `${timestamp}.${nonce}.${body}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  body: string;
  providedSignature: string;
}): boolean {
  const expectedSignature = createWebhookSignature(input.secret, input.timestamp, input.nonce, input.body);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(input.providedSignature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
