import { IntegrationContext, createIntegrationContext, AdAccountSummary } from '../../src/testing/integration-flows';
import { MOCK_TOKENS } from '../../src/testing/mock-meta/fixtures';

/** Meta connection management against the mock Graph API: tokens, permissions, accounts, OAuth, Ad Library. */
describe('Meta connections (integration)', () => {
  let context: IntegrationContext;

  beforeAll(async () => {
    context = await createIntegrationContext(['connections-a', 'connections-b']);
  });
  afterAll(() => context.cleanup());

  const userA = () => context.users[0];
  const userB = () => context.users[1];

  it('connects a valid token, syncs personal and business ad accounts and never exposes the token', async () => {
    const response = await userA().api.post<{ id: string; scopes: string[] }>('/meta/connections', { token: MOCK_TOKENS.valid, name: 'Mock connection' });
    expect(response.status).toBe(201);
    expect(response.body.scopes).toEqual(['ads_read', 'business_management']);
    expect(JSON.stringify(response.body)).not.toContain(MOCK_TOKENS.valid);

    const listed = await userA().api.get<Record<string, unknown>[]>('/meta/connections');
    expect(JSON.stringify(listed.body)).not.toContain(MOCK_TOKENS.valid);
    expect(listed.body[0]).not.toHaveProperty('token_encrypted');

    const accounts = (await userA().api.get<AdAccountSummary[]>('/ad-accounts')).body;
    expect(accounts.map((account) => account.meta_account_id).sort()).toEqual(['act_1001', 'act_1002']);
    expect(accounts.find((account) => account.meta_account_id === 'act_1002')).toMatchObject({ currency: 'EUR', selected: true });
  });

  it('stores the token encrypted at rest (AES-GCM payload, not the plain token)', async () => {
    const { data } = await context.admin.from('meta_connections').select('token_encrypted').eq('user_id', userA().id).single();
    expect(data?.token_encrypted).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(data?.token_encrypted).not.toContain(MOCK_TOKENS.valid);
  });

  it('is idempotent: reconnecting the same Meta user updates the connection instead of duplicating it', async () => {
    await userA().api.post('/meta/connections', { token: MOCK_TOKENS.valid });
    expect((await userA().api.get<unknown[]>('/meta/connections')).body).toHaveLength(1);
    expect((await userA().api.get<unknown[]>('/ad-accounts')).body).toHaveLength(2);
  });

  it('re-syncs ad accounts on demand and can toggle an account', async () => {
    const [connection] = (await userA().api.get<{ id: string }[]>('/meta/connections')).body;
    expect((await userA().api.post<{ synced: number }>(`/meta/connections/${connection.id}/sync`)).body.synced).toBe(2);
    const [account] = (await userA().api.get<AdAccountSummary[]>('/ad-accounts')).body;
    const toggled = await userA().api.patch<{ selected: boolean }>(`/ad-accounts/${account.id}`, { selected: false });
    expect(toggled.body.selected).toBe(false);
    await userA().api.patch(`/ad-accounts/${account.id}`, { selected: true });
  });

  it('rejects a token without the ads_read permission', async () => {
    const response = await userB().api.post<{ message: string }>('/meta/connections', { token: MOCK_TOKENS.noAdsRead });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('ads_read');
  });

  it('rejects an expired token', async () => {
    const response = await userB().api.post<{ message: string }>('/meta/connections', { token: MOCK_TOKENS.expired });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Meta rejected the token');
  });

  it('never echoes a rejected token back in the error message', async () => {
    const malformed = 'EAA_FAKE_MALFORMED_TOKEN_123456';
    const response = await userB().api.post<{ message: string }>('/meta/connections', { token: malformed });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(malformed);
    expect(response.body.message).toContain('[redacted-token]');
  });

  it('validates the request body', async () => {
    expect((await userB().api.post('/meta/connections', { token: 'short' })).status).toBe(400);
  });

  it('isolates connections between users', async () => {
    expect((await userB().api.get<unknown[]>('/meta/connections')).body).toEqual([]);
    expect((await userB().api.get<unknown[]>('/ad-accounts')).body).toEqual([]);
    const [connection] = (await userA().api.get<{ id: string }[]>('/meta/connections')).body;
    expect((await userB().api.delete(`/meta/connections/${connection.id}`)).status).toBe(404);
    expect((await userB().api.post(`/meta/connections/${connection.id}/sync`)).status).toBe(404);
  });

  it('completes the OAuth flow: login dialog -> callback -> long-lived token stored', async () => {
    const status = (await userB().api.get<{ oauthConfigured: boolean }>('/meta/status')).body;
    expect(status.oauthConfigured).toBe(true);

    const { url } = (await userB().api.get<{ url: string }>('/meta/oauth/url')).body;
    expect(url.startsWith(`${context.environment.mockMetaUrl}/v`)).toBe(true);
    expect(new URL(url).searchParams.get('scope')).toBe('ads_read,business_management');

    const dialog = await fetch(url, { redirect: 'manual' });
    expect(dialog.status).toBe(302);
    const callbackUrl = dialog.headers.get('location') as string;
    expect(callbackUrl).toContain('/api/v1/meta/oauth/callback');

    const callback = await fetch(callbackUrl, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain('/connections?connected=1');

    const connections = (await userB().api.get<{ meta_user_id: string; token_expires_at: string }[]>('/meta/connections')).body;
    expect(connections).toHaveLength(1);
    expect(connections[0].token_expires_at).not.toBeNull();
    const { data } = await context.admin.from('meta_connections').select('token_encrypted').eq('user_id', userB().id).single();
    expect(data?.token_encrypted).not.toContain(MOCK_TOKENS.longLived);
    expect((await userB().api.get<unknown[]>('/ad-accounts')).body.length).toBeGreaterThan(0);
  });

  it('rejects a forged or tampered OAuth state', async () => {
    const callback = await fetch(`${context.environment.apiBaseUrl}/api/v1/meta/oauth/callback?code=mock-valid-code&state=${userA().id}.${Date.now()}.forged`, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain('error=');
  });

  it('searches the Ad Library as a separate optional integration', async () => {
    const [connection] = (await userA().api.get<{ id: string }[]>('/meta/connections')).body;
    const response = await userA().api.get<{ data: { page_name: string }[] }>(`/meta/ad-library/search?connection_id=${connection.id}&q=shoes&countries=US`);
    expect(response.status).toBe(200);
    expect(response.body.data[0].page_name).toBe('Competitor Shoes');
    expect((await userA().api.get(`/meta/ad-library/search?connection_id=${connection.id}`)).status).toBe(400);
  });

  it('disconnects while keeping a clear audit trail', async () => {
    const [connection] = (await userB().api.get<{ id: string }[]>('/meta/connections')).body;
    expect((await userB().api.delete(`/meta/connections/${connection.id}`)).status).toBe(204);
    expect((await userB().api.get<unknown[]>('/meta/connections')).body).toEqual([]);
    const { data } = await context.admin.from('audit_logs').select('action').eq('user_id', userB().id);
    expect((data ?? []).map((row) => row.action)).toEqual(expect.arrayContaining(['meta.connect', 'meta.disconnect']));
  });
});
