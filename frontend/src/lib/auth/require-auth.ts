import { NextResponse } from 'next/server';
import type { AuthSession } from '@/lib/auth/session';

// Anonymous user - authentication disabled
const ANONYMOUS_USER: AuthSession = {
  oid: '00000000-0000-0000-0000-000000000000',
  email: 'anonymous@localhost',
  name: 'Anonymous User',
};

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// Authentication disabled - always return anonymous user
export async function getAuthenticatedUser(): Promise<AuthSession> {
  return ANONYMOUS_USER;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
