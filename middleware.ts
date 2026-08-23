import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { canAccessModule, modulesForRole } from './lib/rbac';

const cookieName = 'ipaytech_session';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(cookieName)?.value;
  const secret = process.env.AUTH_SECRET;
  if (token && secret && secret.length >= 32) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      if (request.nextUrl.pathname === '/operations') {
        const requestedModule = request.nextUrl.searchParams.get('module');
        const role = typeof payload.role === 'string' ? payload.role : '';
        if (requestedModule && role && !canAccessModule(role, requestedModule as never)) {
          const fallback = modulesForRole(role)[0] || 'Reports';
          const redirect = new URL('/operations', request.url);
          redirect.searchParams.set('module', fallback);
          return NextResponse.redirect(redirect);
        }
      }
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

export const config = { matcher: ['/((?!login|verify|invite|api|_next/static|_next/image|favicon.ico|iPaytechLogo.jpg|pos-login-hero.webp).*)'] };
