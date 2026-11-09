import { vi } from 'vitest';

/** Shared test doubles. They are wired into the app modules by `src/testing/setup.ts`. */

export const navigationMock = {
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() },
  pathname: '/dashboard',
  searchParameters: new URLSearchParams(),
  routeParameters: { id: 'ad-1' } as Record<string, string>,
};

export const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), remove: vi.fn() };

export const supabaseMock = {
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithOAuth: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
};

export const dataState = {
  /** Responses by exact request path; first matching key (exact, else prefix) wins. */
  responses: {} as Record<string, unknown>,
  errors: {} as Record<string, Error>,
  mutate: vi.fn(),
};

/** Resets every shared mock to a clean, signed-in default state. */
export function resetMocks(): void {
  for (const mock of [...Object.values(navigationMock.router), ...Object.values(apiMock)]) mock.mockReset();
  navigationMock.pathname = '/dashboard';
  navigationMock.searchParameters = new URLSearchParams();
  navigationMock.routeParameters = { id: 'ad-1' };
  for (const mock of Object.values(supabaseMock.auth)) mock.mockReset();
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt', user: { email: 'me@example.test' } } } });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  dataState.responses = {};
  dataState.errors = {};
  dataState.mutate.mockReset();
  dataState.mutate.mockResolvedValue(undefined);
}

/** What `useData(path)` returns in tests. */
export function lookupData(path: string | null) {
  if (path === null) return { data: undefined, error: undefined, isLoading: false, mutate: dataState.mutate };
  const exact = Object.keys(dataState.errors).find((key) => path === key || path.startsWith(key));
  if (exact) return { data: undefined, error: dataState.errors[exact], isLoading: false, mutate: dataState.mutate };
  const key = Object.keys(dataState.responses).find((candidate) => path === candidate) ?? Object.keys(dataState.responses).find((candidate) => path.startsWith(candidate));
  return { data: key === undefined ? undefined : dataState.responses[key], error: undefined, isLoading: key === undefined, mutate: dataState.mutate };
}
