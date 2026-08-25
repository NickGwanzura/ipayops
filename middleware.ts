import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { canAccessModule, modulesForRole } from './lib/rbac';
import { getOrCreateRequestId, REQUEST_ID_HEADER } from './lib/observability';

const cookieName = 'ipaytech_session';

export async function middleware(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  if (request.nextUrl.pathname === '/api' || request.nextUrl.pathname.startsWith('/api/')) return next();

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
      return next();
    } catch {
      // Fall through to the login redirect and clear the stale client cookie.
    }
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(login);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.cookies.delete(cookieName);
  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api|login|verify|invite|forgot-password|reset-password|_next/static|_next/image|favicon.ico|iPaytechLogo.jpg|pos-login-hero.webp).*)',
  ],
};
