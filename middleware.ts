import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const cookieName = 'ipaytech_session';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(cookieName)?.value;
  const secret = process.env.AUTH_SECRET;
  if (token && secret && secret.length >= 32) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      return NextResponse.next();
    } catch {
      // Fall through to the login redirect and clear the stale client cookie.
    }
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(login);
  response.cookies.delete(cookieName);
  return response;
}

export const config = { matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'] };
