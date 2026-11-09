import { randomBytes } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

/** Shared helpers for the integration tests that run against the real Docker stack + mock Meta. */

export interface IntegrationEnvironment {
  apiBaseUrl: string;
  mockMetaUrl: string;
  workerHealthUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  redisUrl: string;
}

const REQUIRED_VARIABLES = ['API_BASE_URL', 'MOCK_META_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'REDIS_URL'] as const;

export function loadIntegrationEnvironment(source: Record<string, string | undefined> = process.env): IntegrationEnvironment {
  const missing = REQUIRED_VARIABLES.filter((name) => !source[name]);
  if (missing.length > 0) throw new Error(`Integration tests need these environment variables: ${missing.join(', ')}`);
  return {
    apiBaseUrl: source.API_BASE_URL as string,
    mockMetaUrl: source.MOCK_META_URL as string,
    workerHealthUrl: source.WORKER_HEALTH_URL ?? 'http://worker:3002/health',
    supabaseUrl: source.SUPABASE_URL as string,
    supabaseAnonKey: source.SUPABASE_ANON_KEY as string,
    supabaseServiceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY as string,
    redisUrl: source.REDIS_URL as string,
  };
}

/** Polls `check` until it returns a truthy value, or fails with a description of what never happened. */
export async function waitFor<Value>(
  check: () => Promise<Value | undefined | null | false>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<Value> {
  const { timeoutMs = 60_000, intervalMs = 500, description = 'condition' } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Retries an operation whose result carries a transient network error (e.g. Supabase still settling after a restart). */
export async function retryOnNetworkError<Result extends { error: { message: string } | null }>(
  operation: () => Promise<Result>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<Result> {
  const { attempts = 4, delayMs = 1000 } = options;
  let result = await operation();
  for (let attempt = 1; attempt < attempts && result.error?.message.includes('fetch failed'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await operation();
  }
  return result;
}

export interface ApiResponse<Body = unknown> {
  status: number;
  body: Body;
}

export interface ApiClient {
  get<Body = unknown>(path: string): Promise<ApiResponse<Body>>;
  post<Body = unknown>(path: string, body?: unknown): Promise<ApiResponse<Body>>;
  patch<Body = unknown>(path: string, body: unknown): Promise<ApiResponse<Body>>;
  delete(path: string): Promise<ApiResponse>;
}

/** HTTP client for the backend API using a user's Supabase access token (or none for unauthenticated calls). */
export function createApiClient(baseUrl: string, accessToken?: string): ApiClient {
  const send = async <Body>(method: string, path: string, body?: unknown): Promise<ApiResponse<Body>> => {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as Body };
  };
  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body ?? {}),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
  };
}

export interface RecordedMetaRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

/** Control channel of the mock Meta server (reset state, inject failures/latency, read the request log). */
export function createMockMetaAdmin(mockMetaUrl: string) {
  const post = (path: string, body: unknown = {}) =>
    fetch(`${mockMetaUrl}/__admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    reset: async () => void (await post('reset')),
    failNext: async (failure: { match: string; times?: number; status?: number; error?: Record<string, unknown> }) => void (await post('fail', failure)),
    setLatency: async (milliseconds: number) => void (await post('latency', { ms: milliseconds })),
    requests: async (): Promise<RecordedMetaRequest[]> => (await (await fetch(`${mockMetaUrl}/__admin/requests`)).json()) as RecordedMetaRequest[],
  };
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  /** Supabase client authenticated as the user (subject to RLS). */
  client: SupabaseClient;
  api: ApiClient;
}

/** Creates a confirmed user through the admin API and signs in as them. Delete with `admin.auth.admin.deleteUser`. */
export async function createTestUser(
  admin: SupabaseClient,
  createAnonymousClient: () => SupabaseClient,
  apiBaseUrl: string,
  label: string,
): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`;
  const password = `${randomBytes(12).toString('hex')}Aa1!`;
  const created = await retryOnNetworkError(() => admin.auth.admin.createUser({ email, password, email_confirm: true }));
  if (created.error || !created.data.user) throw new Error(`Could not create test user: ${created.error?.message}`);
  const client = createAnonymousClient();
  const session = await retryOnNetworkError(() => client.auth.signInWithPassword({ email, password }));
  if (session.error || !session.data.session) throw new Error(`Could not sign in test user: ${session.error?.message}`);
  const accessToken = session.data.session.access_token;
  return { id: created.data.user.id, email, accessToken, client, api: createApiClient(apiBaseUrl, accessToken) };
}
