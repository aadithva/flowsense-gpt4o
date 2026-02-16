import { jwtVerify, SignJWT } from 'jose';
import { getServerEnv } from '@/lib/env/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const SESSION_COOKIE_NAME = 'flowsense_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface AuthSession {
  oid: string;
  email?: string;
  name?: string;
}

function getSessionKey() {
  const env = getServerEnv();
  return new TextEncoder().encode(env.AUTH_SESSION_SECRET);
}

export async function createSessionToken(session: AuthSession): Promise<string> {
  return new SignJWT({
    oid: session.oid,
    email: session.email,
    name: session.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionKey());
}

export async function readSessionToken(token?: string | null): Promise<AuthSession | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionKey(), {
      algorithms: ['HS256'],
    });

    const oidParse = z.string().uuid().safeParse(payload.oid);
    if (!oidParse.success) {
      return null;
    }

    return {
      oid: oidParse.data,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  const secureCookie = getServerEnv().NODE_ENV === 'production';
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  const secureCookie = getServerEnv().NODE_ENV === 'production';
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
