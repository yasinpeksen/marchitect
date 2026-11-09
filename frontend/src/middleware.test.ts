import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { hasSessionCookie, isPublicPath, middleware, resolveRedirect } from './middleware';

describe('isPublicPath', () => {
  it.each(['/login', '/auth/callback', '/auth/reset'])('allows %s', (path) => expect(isPublicPath(path)).toBe(true));
  it.each(['/dashboard', '/loginx', '/authentic', '/'])('protects %s', (path) => expect(isPublicPath(path)).toBe(false));
});

describe('hasSessionCookie', () => {
  it('recognises Supabase auth cookies, including chunked ones', () => {
    expect(hasSessionCookie(['sb-localhost-auth-token'])).toBe(true);
    expect(hasSessionCookie(['theme', 'sb-abc-auth-token.0'])).toBe(true);
  });
  it('ignores other cookies', () => {
    expect(hasSessionCookie([])).toBe(false);
    expect(hasSessionCookie(['sb-x-refresh', 'session'])).toBe(false);
  });
});

describe('resolveRedirect', () => {
  it('sends visitors without a session to /login', () => expect(resolveRedirect('/dashboard', false)).toBe('/login'));
  it('sends signed-in visitors away from /login', () => expect(resolveRedirect('/login', true)).toBe('/dashboard'));
  it('lets everything else through', () => {
    expect(resolveRedirect('/login', false)).toBeNull();
    expect(resolveRedirect('/auth/callback', false)).toBeNull();
    expect(resolveRedirect('/dashboard', true)).toBeNull();
  });
});

describe('middleware', () => {
  const run = (path: string, cookie?: string) =>
    middleware(new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined));

  it('redirects unauthenticated requests to /login', () => {
    const response = run('/dashboard');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login');
  });
  it('redirects a signed-in user from /login to the dashboard', () => {
    expect(run('/login', 'sb-localhost-auth-token=abc').headers.get('location')).toBe('http://localhost:3000/dashboard');
  });
  it('passes allowed requests through', () => {
    expect(run('/dashboard', 'sb-localhost-auth-token=abc').headers.get('x-middleware-next')).toBe('1');
  });
});
