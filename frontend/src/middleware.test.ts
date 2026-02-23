import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

describe('middleware', () => {
  it('should allow all requests through (auth disabled)', async () => {
    const request = new NextRequest('http://localhost:3000/api/runs');
    const response = await middleware(request);
    expect(response.status).toBe(200);
  });

  it('should allow dashboard access', async () => {
    const request = new NextRequest('http://localhost:3000/dashboard');
    const response = await middleware(request);
    expect(response.status).toBe(200);
  });

  it('should allow API access', async () => {
    const request = new NextRequest('http://localhost:3000/api/runs/123');
    const response = await middleware(request);
    expect(response.status).toBe(200);
  });
});
