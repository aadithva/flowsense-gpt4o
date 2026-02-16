import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getServerEnv } from '@/lib/env/server';
import { randomBytes } from 'crypto';

const OAUTH_STATE_COOKIE = 'flowsense_oauth_state';
const OAUTH_NONCE_COOKIE = 'flowsense_oauth_nonce';
const OAUTH_NEXT_COOKIE = 'flowsense_oauth_next';

const OAUTH_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

interface EntraIdClaims {
  oid: string;
  email?: string;
  name?: string;
}

function getIssuerBase() {
  const env = getServerEnv();
  return `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`;
}

function getAuthorizeEndpoint() {
  return `${getIssuerBase()}/oauth2/v2.0/authorize`;
}

function getTokenEndpoint() {
  return `${getIssuerBase()}/oauth2/v2.0/token`;
}

function getJwksUri() {
  return `${getIssuerBase()}/discovery/v2.0/keys`;
}

function getRedirectUri() {
  const env = getServerEnv();
  return `${env.APP_BASE_URL}${env.ENTRA_REDIRECT_PATH}`;
}

export function generateOauthState(): string {
  return randomBytes(32).toString('hex');
}

export function generateOauthNonce(): string {
  return randomBytes(24).toString('hex');
}

export function getOauthCookieMetadata() {
  return {
    stateCookieName: OAUTH_STATE_COOKIE,
    nonceCookieName: OAUTH_NONCE_COOKIE,
    nextCookieName: OAUTH_NEXT_COOKIE,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };
}

export function buildAuthorizeUrl(options: { state: string; nonce: string; next?: string }): string {
  const env = getServerEnv();
  const params = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    response_mode: 'query',
    scope: 'openid profile email',
    state: options.state,
    nonce: options.nonce,
  });

  if (options.next) {
    params.set('prompt', 'select_account');
  }

  return `${getAuthorizeEndpoint()}?${params.toString()}`;
}

async function fetchToken(code: string) {
  const env = getServerEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.ENTRA_CLIENT_ID,
    client_secret: env.ENTRA_CLIENT_SECRET,
    code,
    redirect_uri: getRedirectUri(),
    scope: 'openid profile email',
  });

  const response = await fetch(getTokenEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${payload}`);
  }

  return response.json() as Promise<{ id_token?: string }>;
}

export async function exchangeCodeForClaims(code: string, nonce: string): Promise<EntraIdClaims> {
  const env = getServerEnv();
  const tokenResponse = await fetchToken(code);
  if (!tokenResponse.id_token) {
    throw new Error('Token exchange response missing id_token');
  }

  const jwks = createRemoteJWKSet(new URL(getJwksUri()));
  const { payload } = await jwtVerify(tokenResponse.id_token, jwks, {
    issuer: getIssuerBase(),
    audience: env.ENTRA_CLIENT_ID,
  });

  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) {
    throw new Error('Invalid nonce in ID token');
  }

  const oid = payload.oid;
  if (typeof oid !== 'string') {
    throw new Error('ID token missing oid claim');
  }

  const email =
    typeof payload.preferred_username === 'string'
      ? payload.preferred_username
      : typeof payload.email === 'string'
      ? payload.email
      : undefined;

  const name = typeof payload.name === 'string' ? payload.name : undefined;

  return { oid, email, name };
}
