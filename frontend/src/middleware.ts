import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth'];

export const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));

/** True when any cookie looks like a Supabase auth session cookie (chunked cookies included). */
export const hasSessionCookie = (cookieNames: string[]): boolean => cookieNames.some((cookieName) => /^sb-.+-auth-token/.test(cookieName));

/** Where to send the visitor, or `null` to let the request through. */
export function resolveRedirect(pathname: string, hasSession: boolean): string | null {
  if (!hasSession && !isPublicPath(pathname)) return '/login';
  if (hasSession && pathname === '/login') return '/dashboard';
  return null;
}

/**
 * Route protection (UX redirect). Real authorization is enforced by the API (Bearer token verified
 * against Supabase) and by Row Level Security, never by this cookie check alone.
 */
export function middleware(request: NextRequest) {
  const target = resolveRedirect(request.nextUrl.pathname, hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name)));
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/|favicon.ico|api/).*)'] };
