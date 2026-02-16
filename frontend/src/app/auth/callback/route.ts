import { NextResponse } from 'next/server';
import { exchangeCodeForClaims, getOauthCookieMetadata } from '@/lib/auth/entra';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { getServerEnv } from '@/lib/env/server';
import { z } from 'zod';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const metadata = getOauthCookieMetadata();
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const error = requestUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', requestUrl.origin));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/login?error=missing_code', requestUrl.origin));
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieMap = new Map(
    cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex === -1) return [entry, ''];
        return [entry.slice(0, separatorIndex), decodeURIComponent(entry.slice(separatorIndex + 1))];
      })
  );

  const expectedState = cookieMap.get(metadata.stateCookieName);
  const nonce = cookieMap.get(metadata.nonceCookieName);
  const nextCookiePath = cookieMap.get(metadata.nextCookieName) || '/';
  const nextPath = nextCookiePath.startsWith('/') ? nextCookiePath : '/';

  if (!expectedState || expectedState !== state || !nonce) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', requestUrl.origin));
  }

  try {
    const claims = await exchangeCodeForClaims(code, nonce);
    const oidValidation = z.string().uuid().safeParse(claims.oid);
    if (!oidValidation.success) {
      throw new Error('Entra oid is not a GUID');
    }

    const sessionToken = await createSessionToken({
      oid: oidValidation.data,
      email: claims.email,
      name: claims.name,
    });

    const response = NextResponse.redirect(new URL(nextPath, requestUrl.origin));
    setSessionCookie(response, sessionToken);
    const secureCookie = getServerEnv().NODE_ENV === 'production';

    response.cookies.set(metadata.stateCookieName, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie });
    response.cookies.set(metadata.nonceCookieName, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie });
    response.cookies.set(metadata.nextCookieName, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie });

    return response;
  } catch (authError) {
    console.error('[auth/callback] OAuth callback error', authError);
    return NextResponse.redirect(new URL('/login?error=token_exchange', requestUrl.origin));
  }
}
