import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE_NAME, type AuthSession } from '@/lib/auth/session';

// Anonymous user for local development (auth disabled)
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

export async function getAuthenticatedUser(): Promise<AuthSession> {
  // For local development: return anonymous user without requiring auth
  // To re-enable auth, remove this early return
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await readSessionToken(token);

  // Return anonymous user if no session (auth disabled for local dev)
  return session ?? ANONYMOUS_USER;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
