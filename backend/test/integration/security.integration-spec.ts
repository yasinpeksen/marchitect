import Redis from 'ioredis';
import {
  AdAccountSummary, collectAndWait, connectMeta, createIntegrationContext, IntegrationContext } from '../../src/testing/integration-flows';
import { waitFor } from '../../src/testing/integration-support';
import { createApiClient } from '../../src/testing/integration-support';
import { MOCK_TOKENS } from '../../src/testing/mock-meta/fixtures';

/** Row Level Security, tenant isolation, private storage and infrastructure wiring (Redis, worker, Supabase). */
describe('Security and infrastructure (integration)', () => {
  let context: IntegrationContext;
  let accountId: string;
  let adId: string;
  let runId: string;

  beforeAll(async () => {
    context = await createIntegrationContext(['owner', 'intruder']);
    const accounts = await connectMeta(context.users[0].api, MOCK_TOKENS.valid);
    accountId = (accounts as AdAccountSummary[]).find((account) => account.meta_account_id === 'act_1001')?.id as string;
    const run = await collectAndWait(context.users[0].api, { accountId, keywords: ['summer'], days: 3 });
    runId = run.id;
    adId = (await context.users[0].api.get<{ items: { id: string }[] }>('/ads?keywords=video')).body.items[0].id;
    await waitFor(
      async () => {
        const { data } = await context.admin.from('storage_assets').select('status').eq('user_id', context.users[0].id);
        return data && data.length > 0 && data.every((asset) => asset.status === 'stored') ? data : null;
      },
      { timeoutMs: 90_000, description: 'media to be stored' },
    );
  });
  afterAll(() => context.cleanup());
  const owner = () => context.users[0];
  const intruder = () => context.users[1];

  describe('authentication', () => {
    it.each(['/ads', '/dashboard', '/schedules', '/meta/connections', '/collection-runs', '/saved-searches', '/notifications', '/users/me'])('requires a session for %s', async (path) => {
      expect((await createApiClient(context.environment.apiBaseUrl).get(path)).status).toBe(401);
    });
    it('rejects forged and garbage tokens', async () => {
      expect((await createApiClient(context.environment.apiBaseUrl, 'garbage').get('/auth/me')).status).toBe(401);
      expect((await createApiClient(context.environment.apiBaseUrl, `${owner().accessToken}x`).get('/auth/me')).status).toBe(401);
    });
    it('identifies the signed-in user and creates a profile on registration', async () => {
      expect((await owner().api.get<{ id: string }>('/auth/me')).body.id).toBe(owner().id);
      expect((await owner().api.get<{ id: string; timezone: string }>('/users/me')).body).toMatchObject({ id: owner().id, timezone: 'UTC' });
    });
    it('validates profile updates (IANA timezone)', async () => {
      expect((await owner().api.patch<{ timezone: string }>('/users/me', { timezone: 'Europe/Berlin', display_name: 'Owner' })).body.timezone).toBe('Europe/Berlin');
      expect((await owner().api.patch('/users/me', { timezone: 'Nowhere/Land' })).status).toBe(400);
    });
  });

  describe('tenant isolation through the API', () => {
    it("hides another user's data behind 404s and empty lists", async () => {
      expect((await intruder().api.get<{ total: number }>('/ads')).body.total).toBe(0);
      expect((await intruder().api.get(`/ads/${adId}`)).status).toBe(404);
      expect((await intruder().api.get(`/ads/${adId}/raw`)).status).toBe(404);
      expect((await intruder().api.get(`/ads/${adId}/analytics`)).status).toBe(404);
      expect((await intruder().api.get(`/collection-runs/${runId}`)).status).toBe(404);
      expect((await intruder().api.post('/ads/' + adId + '/tags', { tag: 'mine' })).status).toBe(404);
      expect((await intruder().api.get<unknown[]>('/campaigns')).body).toEqual([]);
    });
    it("cannot start collections or schedules on another user's ad account", async () => {
      expect((await intruder().api.post('/search/collect', { keywords: ['summer'], ad_account_id: accountId })).status).toBe(404);
      expect((await intruder().api.post('/schedules', { name: 'x', keywords: ['summer'], ad_account_id: accountId, interval_unit: 'day', interval_value: 1, start_at: new Date().toISOString() })).status).toBe(404);
    });
    it("cannot modify another user's schedules or saved searches", async () => {
      const schedule = (await owner().api.post<{ id: string }>('/schedules', { name: 'Private', keywords: ['summer'], ad_account_id: accountId, interval_unit: 'day', interval_value: 1, start_at: new Date(Date.now() + 86_400_000).toISOString() })).body;
      expect((await intruder().api.patch(`/schedules/${schedule.id}`, { enabled: false })).status).toBe(404);
      expect((await intruder().api.delete(`/schedules/${schedule.id}`)).status).toBe(404);
      expect((await intruder().api.post(`/schedules/${schedule.id}/run`)).status).toBe(404);
      const saved = (await owner().api.post<{ id: string }>('/saved-searches', { name: 'Private', tags: ['summer'] })).body;
      expect((await intruder().api.patch(`/saved-searches/${saved.id}`, { name: 'Hacked' })).status).toBe(404);
      expect((await intruder().api.delete(`/saved-searches/${saved.id}`)).status).toBe(404);
    });
  });

  describe('Row Level Security (direct database access with a user session)', () => {
    it.each(['ads', 'ad_accounts', 'campaigns', 'ad_sets', 'ad_creatives', 'ad_daily_metrics', 'ad_insights', 'ad_breakdowns', 'collection_runs', 'search_results', 'storage_assets', 'meta_connections', 'saved_searches', 'schedules', 'notifications', 'audit_logs'])(
      'lets the owner read but not the intruder read %s',
      async (table) => {
        // meta_connections exposes only non-secret columns to clients (token_encrypted is column-revoked).
        const columns = table === 'meta_connections' ? 'id,status,scopes' : '*';
        const ownRows = await owner().client.from(table).select(columns).limit(5);
        const otherRows = await intruder().client.from(table).select(columns).limit(5);
        expect(ownRows.error).toBeNull();
        expect(otherRows.error).toBeNull();
        expect(otherRows.data).toEqual([]);
        if (!['schedules', 'notifications'].includes(table)) expect((ownRows.data ?? []).length).toBeGreaterThan(0);
      },
    );
    it('never lets clients read the encrypted Meta token column', async () => {
      expect((await owner().client.from('meta_connections').select('token_encrypted')).error).not.toBeNull();
      expect((await owner().client.from('meta_connections').select('id,status,scopes')).data).toHaveLength(1);
    });
    it('blocks client-side writes (the backend is the only writer)', async () => {
      const update = await owner().client.from('ads').update({ name: 'tampered' }).eq('id', adId).select();
      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
      const insert = await owner().client.from('saved_searches').insert({ user_id: owner().id, name: 'x', tags: ['x'] });
      expect(insert.error).not.toBeNull();
      const remove = await owner().client.from('ads').delete().eq('id', adId).select();
      expect(remove.error !== null || (remove.data ?? []).length === 0).toBe(true);
      const { data } = await context.admin.from('ads').select('name').eq('id', adId).single();
      expect(data?.name).not.toBe('tampered');
    });
    it('keeps the server-only SQL functions away from clients', async () => {
      expect((await owner().client.rpc('search_ads', { p_user_id: owner().id })).error).not.toBeNull();
      expect((await owner().client.rpc('refresh_ad_totals', { p_ad_ids: [adId] })).error).not.toBeNull();
      expect((await owner().client.rpc('daily_totals', { p_user_id: owner().id })).error).not.toBeNull();
    });
    it('lets a user update only their own profile fields', async () => {
      const own = await owner().client.from('profiles').update({ display_name: 'Via RLS' }).eq('id', owner().id).select();
      expect(own.data).toHaveLength(1);
      const other = await intruder().client.from('profiles').update({ display_name: 'Hijack' }).eq('id', owner().id).select();
      expect(other.data ?? []).toHaveLength(0);
    });
  });

  describe('Supabase Storage', () => {
    it('keeps the media bucket private with a size limit', async () => {
      const { data } = await context.admin.storage.getBucket('ad-media');
      expect(data).toMatchObject({ public: false });
      expect(Number(data?.file_size_limit)).toBeGreaterThan(0);
    });
    it('lets the owner sign URLs for their media and denies everyone else', async () => {
      const { data: asset } = await context.admin.from('storage_assets').select('path').eq('user_id', owner().id).eq('status', 'stored').limit(1).single();
      const own = await owner().client.storage.from('ad-media').createSignedUrl(asset?.path as string, 60);
      expect(own.error).toBeNull();
      expect((await fetch(own.data?.signedUrl as string)).status).toBe(200);
      expect((await intruder().client.storage.from('ad-media').createSignedUrl(asset?.path as string, 60)).error).not.toBeNull();
      expect((await intruder().client.storage.from('ad-media').download(asset?.path as string)).error).not.toBeNull();
      expect((await fetch(`${context.environment.supabaseUrl}/storage/v1/object/public/ad-media/${asset?.path}`)).status).toBeGreaterThanOrEqual(400);
    });
    it('stores objects under the owner folder only', async () => {
      const { data } = await context.admin.from('storage_assets').select('path').eq('user_id', owner().id);
      expect((data ?? []).every((asset) => String(asset.path).startsWith(`${owner().id}/`))).toBe(true);
    });
  });

  describe('Redis, BullMQ and the worker', () => {
    it('reports backend and worker health with Redis and database connected', async () => {
      const backend = await fetch(`${context.environment.apiBaseUrl}/health`);
      expect(backend.status).toBe(200);
      expect(await backend.json()).toMatchObject({ status: 'ok', redis: true, database: true });
      expect((await fetch(context.environment.workerHealthUrl)).status).toBe(200);
    });
    it('has the BullMQ queues and the recurring scheduler tick registered in Redis', async () => {
      const redis = new Redis(context.environment.redisUrl);
      try {
        expect(await redis.ping()).toBe('PONG');
        expect(await redis.exists('bull:scheduler:repeat:scheduler-tick')).toBe(1);
        for (const queue of ['collection', 'media', 'analytics', 'scheduler']) expect(await redis.exists(`bull:${queue}:meta`)).toBe(1);
        const lockKeys = await redis.keys('lock:collect:*');
        expect(lockKeys).toEqual([]); // locks are released after runs
      } finally {
        await redis.quit();
      }
    });
    it('uses idempotent job ids so a run is only ever queued once', async () => {
      const redis = new Redis(context.environment.redisUrl);
      try {
        expect(await redis.exists(`bull:collection:run_${runId}`)).toBe(1);
      } finally {
        await redis.quit();
      }
    });
  });

  describe('database schema and migrations', () => {
    it('has every required table, unique ad ids per user and the search indexes', async () => {
      for (const table of ['profiles', 'meta_connections', 'ad_accounts', 'campaigns', 'ad_sets', 'ads', 'ad_creatives', 'ad_assets', 'ad_insights', 'ad_daily_metrics', 'ad_breakdowns', 'search_tags', 'saved_searches', 'search_results', 'schedules', 'schedule_executions', 'analytics', 'ai_creative_tags', 'storage_assets', 'collection_runs', 'notifications', 'audit_logs']) {
        expect((await context.admin.from(table).select('*', { count: 'exact', head: true })).error).toBeNull();
      }
      const duplicate = await context.admin.from('ads').insert({ user_id: owner().id, ad_account_id: accountId, meta_ad_id: 'ad_1' });
      expect(duplicate.error?.code).toBe('23505');
    });
    it('records raw Meta responses as JSONB alongside normalised columns', async () => {
      const { data } = await context.admin.from('ads').select('raw,name,meta_ad_id').eq('id', adId).single();
      expect(data?.raw).toMatchObject({ id: 'ad_1' });
      expect(data?.meta_ad_id).toBe('ad_1');
    });
    it('writes audit logs for key actions', async () => {
      const { data } = await context.admin.from('audit_logs').select('action').eq('user_id', owner().id);
      expect((data ?? []).map((row) => row.action)).toEqual(expect.arrayContaining(['meta.connect', 'collection.start']));
    });
  });
});
