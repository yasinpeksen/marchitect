import { SupabaseClient } from '@supabase/supabase-js';
import { createApiClient, createMockMetaAdmin, createTestUser, loadIntegrationEnvironment, retryOnNetworkError, waitFor } from './integration-support';

const completeEnvironment = {
  API_BASE_URL: 'http://backend:3001', MOCK_META_URL: 'http://mock-meta:4010', SUPABASE_URL: 'http://supabase', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', REDIS_URL: 'redis://redis:6379',
};

describe('loadIntegrationEnvironment', () => {
  it('maps the environment and defaults the worker health URL', () => {
    expect(loadIntegrationEnvironment(completeEnvironment)).toEqual({
      apiBaseUrl: 'http://backend:3001', mockMetaUrl: 'http://mock-meta:4010', workerHealthUrl: 'http://worker:3002/health', supabaseUrl: 'http://supabase',
      supabaseAnonKey: 'anon', supabaseServiceRoleKey: 'service', redisUrl: 'redis://redis:6379',
    });
  });
  it('lists every missing variable', () => {
    expect(() => loadIntegrationEnvironment({ API_BASE_URL: 'x' })).toThrow('MOCK_META_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL');
  });
});

describe('waitFor', () => {
  it('returns the first truthy result', async () => {
    const check = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(false).mockResolvedValueOnce('ready');
    expect(await waitFor(check, { intervalMs: 1 })).toBe('ready');
    expect(check).toHaveBeenCalledTimes(3);
  });
  it('times out with the description', async () => {
    await expect(waitFor(() => Promise.resolve(null), { timeoutMs: 20, intervalMs: 5, description: 'the run to finish' })).rejects.toThrow('Timed out after 20ms waiting for the run to finish');
  });
});

describe('retryOnNetworkError', () => {
  it('returns the first successful result without retrying', async () => {
    const operation = jest.fn().mockResolvedValue({ error: null, value: 1 });
    expect(await retryOnNetworkError(operation, { delayMs: 1 })).toEqual({ error: null, value: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('retries "fetch failed" errors until one succeeds', async () => {
    const operation = jest.fn().mockResolvedValueOnce({ error: { message: 'fetch failed' } }).mockResolvedValueOnce({ error: { message: 'fetch failed' } }).mockResolvedValueOnce({ error: null });
    expect(await retryOnNetworkError(operation, { delayMs: 1 })).toEqual({ error: null });
    expect(operation).toHaveBeenCalledTimes(3);
  });
  it('gives up after the attempts and returns the last error', async () => {
    const operation = jest.fn().mockResolvedValue({ error: { message: 'fetch failed' } });
    expect(await retryOnNetworkError(operation, { attempts: 2, delayMs: 1 })).toEqual({ error: { message: 'fetch failed' } });
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it('does not retry other errors', async () => {
    const operation = jest.fn().mockResolvedValue({ error: { message: 'User already registered' } });
    await retryOnNetworkError(operation, { delayMs: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('createApiClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 201 })));
  });
  afterEach(() => fetchMock.mockRestore());

  it('sends the bearer token and JSON bodies against the versioned API', async () => {
    const response = await createApiClient('http://api', 'token-1').post('/search/collect', { keywords: ['a'] });
    expect(response).toEqual({ status: 201, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/api/v1/search/collect');
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' }, body: '{"keywords":["a"]}' });
  });

  it('omits authorization when unauthenticated and supports every verb', async () => {
    const client = createApiClient('http://api');
    await client.get('/ads');
    await client.patch('/schedules/1', { enabled: false });
    await client.delete('/schedules/1');
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['GET', 'PATCH', 'DELETE']);
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('tolerates empty response bodies', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await createApiClient('http://api', 't').delete('/x')).toEqual({ status: 204, body: undefined });
  });
});

describe('createMockMetaAdmin', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('[{"method":"GET","path":"me","query":{}}]')));
  });
  afterEach(() => fetchMock.mockRestore());

  it('posts control commands to the admin endpoints', async () => {
    const admin = createMockMetaAdmin('http://mock');
    await admin.reset();
    await admin.failNext({ match: 'ads', times: 2 });
    await admin.setLatency(100);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['http://mock/__admin/reset', 'http://mock/__admin/fail', 'http://mock/__admin/latency']);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ match: 'ads', times: 2 });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ ms: 100 });
  });

  it('reads the request log', async () => {
    expect(await createMockMetaAdmin('http://mock').requests()).toEqual([{ method: 'GET', path: 'me', query: {} }]);
  });
});

describe('createTestUser', () => {
  const buildClients = (overrides: { createError?: string; signInError?: string } = {}) => {
    const createUser = jest.fn().mockResolvedValue(overrides.createError ? { data: { user: null }, error: { message: overrides.createError } } : { data: { user: { id: 'user-1' } }, error: null });
    const signInWithPassword = jest.fn().mockResolvedValue(overrides.signInError ? { data: { session: null }, error: { message: overrides.signInError } } : { data: { session: { access_token: 'jwt' } }, error: null });
    const admin = { auth: { admin: { createUser } } } as unknown as SupabaseClient;
    const anonymous = { auth: { signInWithPassword } } as unknown as SupabaseClient;
    return { admin, anonymous, createUser, signInWithPassword };
  };

  it('creates a confirmed user, signs in and exposes an API client', async () => {
    const { admin, anonymous, createUser, signInWithPassword } = buildClients();
    const user = await createTestUser(admin, () => anonymous, 'http://api', 'alice');
    expect(user).toMatchObject({ id: 'user-1', accessToken: 'jwt', client: anonymous });
    expect(user.email).toMatch(/^alice-\d+-[0-9a-f]{6}@example\.test$/);
    expect(createUser).toHaveBeenCalledWith({ email: user.email, password: expect.stringMatching(/Aa1!$/), email_confirm: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: createUser.mock.calls[0][0].password });
  });

  it('fails clearly when user creation or sign-in fails', async () => {
    const creation = buildClients({ createError: 'exists' });
    await expect(createTestUser(creation.admin, () => creation.anonymous, 'http://api', 'a')).rejects.toThrow('Could not create test user: exists');
    const signIn = buildClients({ signInError: 'bad password' });
    await expect(createTestUser(signIn.admin, () => signIn.anonymous, 'http://api', 'a')).rejects.toThrow('Could not sign in test user: bad password');
  });
});
