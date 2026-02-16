import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  generateOauthNonce,
  generateOauthState,
  getOauthCookieMetadata,
} from '@/lib/auth/entra';
import { getServerEnv } from '@/lib/env/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const nextParam = requestUrl.searchParams.get('next') || '/';
  const nextPath = nextParam.startsWith('/') ? nextParam : '/';
  const state = generateOauthState();
  const nonce = generateOauthNonce();
  const authorizeUrl = buildAuthorizeUrl({ state, nonce, next: nextPath });
  const response = NextResponse.redirect(authorizeUrl);
  const metadata = getOauthCookieMetadata();
  const secureCookie = getServerEnv().NODE_ENV === 'production';

  response.cookies.set({
    name: metadata.stateCookieName,
    value: state,
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: metadata.maxAge,
  });

  response.cookies.set({
    name: metadata.nonceCookieName,
    value: nonce,
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: metadata.maxAge,
  });

  response.cookies.set({
    name: metadata.nextCookieName,
    value: nextPath,
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: metadata.maxAge,
  });

  return response;
}
