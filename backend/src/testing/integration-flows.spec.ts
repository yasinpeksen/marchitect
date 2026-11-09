import { createClient } from '@supabase/supabase-js';
import { collectAndWait, connectMeta, connectTikTok, createIntegrationContext, isoDaysAgo, waitForRun } from './integration-flows';
import { ApiClient } from './integration-support';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const environment = {
  API_BASE_URL: 'http://backend:3001', MOCK_META_URL: 'http://mock-meta:4010', SUPABASE_URL: 'http://supabase', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', REDIS_URL: 'redis://redis',
};

const buildApi = () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() }) as unknown as ApiClient & Record<'get' | 'post' | 'patch' | 'delete', jest.Mock>;

describe('isoDaysAgo', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  it('formats the UTC date', () => expect(isoDaysAgo(0, now)).toBe('2026-03-10'));
  it('subtracts days', () => expect(isoDaysAgo(9, now)).toBe('2026-03-01'));
});

describe('createIntegrationContext', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const deleteUser = jest.fn();
  const createUser = jest.fn();
  const signInWithPassword = jest.fn();

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}')));
    createUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null }).mockResolvedValueOnce({ data: { user: { id: 'u2' } }, error: null });
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
    (createClient as jest.Mock).mockImplementation((_url: string, key: string) =>
      key === 'service' ? { auth: { admin: { createUser, deleteUser } } } : { auth: { signInWithPassword } });
  });
  afterEach(() => {
    fetchMock.mockRestore();
    jest.clearAllMocks();
  });

  it('resets the mock, creates a user per label and cleans them up', async () => {
    const context = await createIntegrationContext(['alice', 'bob'], environment);
    expect(fetchMock.mock.calls[0][0]).toBe('http://mock-meta:4010/__admin/reset');
    expect(context.users.map((user) => user.id)).toEqual(['u1', 'u2']);
    await context.cleanup();
    expect(deleteUser.mock.calls).toEqual([['u1'], ['u2']]);
  });

  it('fails fast when the environment is incomplete', async () => {
    await expect(createIntegrationContext(['a'], {})).rejects.toThrow('Integration tests need these environment variables');
  });
});

describe('connectMeta', () => {
  it('connects the token and returns the synced accounts', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 201, body: {} });
    api.get.mockResolvedValue({ status: 200, body: [{ id: 'a1' }] });
    expect(await connectMeta(api, 'EAAtoken')).toEqual([{ id: 'a1' }]);
    expect(api.post).toHaveBeenCalledWith('/meta/connections', { token: 'EAAtoken' });
  });
  it('explains a failed connection', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 400, body: { message: 'bad token' } });
    await expect(connectMeta(api, 'x')).rejects.toThrow('Connecting Meta failed with HTTP 400');
  });
});

describe('connectTikTok', () => {
  it('connects the token for the advertisers and returns the accounts', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 201, body: {} });
    api.get.mockResolvedValue({ status: 200, body: [{ id: 'a1' }] });
    expect(await connectTikTok(api, 'tt-token', ['700'])).toEqual([{ id: 'a1' }]);
    expect(api.post).toHaveBeenCalledWith('/tiktok/connections', { token: 'tt-token', advertiser_ids: ['700'] });
  });
  it('explains a failed connection', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 400, body: { message: 'TikTok rejected the token' } });
    await expect(connectTikTok(api, 'x', ['700'])).rejects.toThrow('Connecting TikTok failed with HTTP 400');
  });
});

describe('waitForRun', () => {
  it('polls until the run reaches a terminal status', async () => {
    const api = buildApi();
    api.get.mockResolvedValueOnce({ status: 200, body: { status: 'queued' } }).mockResolvedValueOnce({ status: 200, body: { status: 'running' } }).mockResolvedValueOnce({ status: 200, body: { status: 'partial' } });
    expect((await waitForRun(api, 'run-1', 5000)).status).toBe('partial');
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenCalledWith('/collection-runs/run-1');
  });
});

describe('collectAndWait', () => {
  it('starts a collection over the last N days and waits for it', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 201, body: { run: { id: 'run-1' }, reused: false } });
    api.get.mockResolvedValue({ status: 200, body: { id: 'run-1', status: 'succeeded' } });
    const run = await collectAndWait(api, { accountId: 'acc', keywords: ['summer'], days: 5 });
    expect(run.status).toBe('succeeded');
    expect(api.post).toHaveBeenCalledWith('/search/collect', { keywords: ['summer'], ad_account_id: 'acc', date_from: isoDaysAgo(4), date_to: isoDaysAgo(0) });
  });
  it('defaults to ten days', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 201, body: { run: { id: 'r' }, reused: false } });
    api.get.mockResolvedValue({ status: 200, body: { status: 'succeeded' } });
    await collectAndWait(api, { accountId: 'acc', keywords: ['a'] });
    expect(api.post.mock.calls[0][1].date_from).toBe(isoDaysAgo(9));
  });
  it('explains a rejected start', async () => {
    const api = buildApi();
    api.post.mockResolvedValue({ status: 400, body: { message: 'no' } });
    await expect(collectAndWait(api, { accountId: 'acc', keywords: ['a'] })).rejects.toThrow('Starting collection failed with HTTP 400');
  });
});
