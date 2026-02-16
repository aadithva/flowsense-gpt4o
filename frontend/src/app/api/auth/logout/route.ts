import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL('/login', url.origin));
  clearSessionCookie(response);
  return response;
}

export async function GET(request: Request) {
  return POST(request);
}
