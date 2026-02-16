import { type NextRequest, NextResponse } from 'next/server';

// Authentication disabled for local development
// To re-enable, restore the Entra ID session validation

export async function middleware(_request: NextRequest) {
  // Allow all requests through without authentication
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
