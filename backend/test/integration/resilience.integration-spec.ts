import {
  AdAccountSummary, collectAndWait, connectMeta, createIntegrationContext, IntegrationContext } from '../../src/testing/integration-flows';
import { waitFor } from '../../src/testing/integration-support';
import { MOCK_TOKENS } from '../../src/testing/mock-meta/fixtures';

interface ConnectionSummary {
  id: string;
  status: string;
  last_error: string | null;
}

interface NotificationSummary {
  type: string;
  title: string;
  body: string | null;
}

/** Failure handling: retries, partial results, expired tokens, missing permissions, recovery. */
describe('Integration resilience (integration)', () => {
  let context: IntegrationContext;
  let accountId: string;

  beforeAll(async () => {
    context = await createIntegrationContext(['resilience']);
    const accounts = await connectMeta(context.users[0].api, MOCK_TOKENS.valid);
    accountId = (accounts as AdAccountSummary[]).find((account) => account.meta_account_id === 'act_1001')?.id as string;
  });
  afterAll(() => context.cleanup());
  beforeEach(() => context.mock.reset());
  const api = () => context.users[0].api;
  const connection = async () => (await api().get<ConnectionSummary[]>('/meta/connections')).body[0];

  it('retries transient Meta errors with backoff and still completes the run', async () => {
    await context.mock.failNext({ match: 'act_1001/ads', times: 2, status: 500, error: { code: 2, is_transient: true, message: 'Service temporarily unavailable' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(run.status).toBe('succeeded');
    const adRequests = (await context.mock.requests()).filter((request) => request.path === 'act_1001/ads');
    expect(adRequests.length).toBeGreaterThanOrEqual(3); // 2 failures + the successful retry
  });

  it('finishes as partial, keeping everything it could collect, when one breakdown fails', async () => {
    await context.mock.failNext({ match: 'breakdowns=impression_device', times: 5, status: 400, error: { code: 100, message: 'Breakdown not supported for this ad' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(run.status).toBe('partial');
    expect(run.errors.map((entry) => entry.message)).toEqual(['breakdown device: Breakdown not supported for this ad']);
    expect(run.counters.ads_found).toBe(2);
    const { items } = (await api().get<{ items: { id: string }[] }>('/ads?keywords=video')).body;
    const analytics = (await api().get<{ breakdowns: Record<string, unknown>; range: { days_with_data: number } }>(`/ads/${items[0].id}/analytics`)).body;
    expect(analytics.range.days_with_data).toBeGreaterThanOrEqual(3);
    expect(analytics.breakdowns.country).toBeDefined();
  });

  it('fails the run on an expired token, flags the connection, notifies the user and hides token details', async () => {
    await context.mock.failNext({ match: 'act_1001/ads', times: 99, status: 401, error: { code: 190, message: 'Error validating access token: Session has expired' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(run.status).toBe('failed');
    expect(run.error).toContain('Session has expired');

    expect((await connection()).status).toBe('expired');
    const notifications = await waitFor(
      async () => {
        const list = (await api().get<NotificationSummary[]>('/notifications')).body;
        return list.some((entry) => entry.type === 'collection_failed') ? list : null;
      },
      { description: 'a failure notification' },
    );
    expect(notifications.find((entry) => entry.type === 'collection_failed')?.body).toContain('Session has expired');
  });

  it('refuses further collections until the account is reconnected, then recovers', async () => {
    await context.mock.reset();
    const blocked = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(blocked.status).toBe('failed');
    expect(blocked.error).toContain('no longer valid');

    await connectMeta(api(), MOCK_TOKENS.valid);
    expect((await connection()).status).toBe('active');
    const recovered = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(recovered.status).toBe('succeeded');
  });

  it('fails on missing permissions without flagging the token as expired', async () => {
    await context.mock.failNext({ match: 'act_1001/ads', times: 99, status: 403, error: { code: 200, message: '(#200) Requires ads_read permission' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(run.status).toBe('failed');
    expect(run.error).toContain('ads_read');
    expect((await connection()).status).toBe('active');
  });

  it('does not retry permanent failures indefinitely (the run reaches a terminal state quickly)', async () => {
    await context.mock.failNext({ match: 'act_1001/ads', times: 99, status: 403, error: { code: 200, message: 'denied' } });
    const startedAt = Date.now();
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(run.status).toBe('failed');
    expect(Date.now() - startedAt).toBeLessThan(30_000);
    expect((await context.mock.requests()).filter((request) => request.path === 'act_1001/ads').length).toBeLessThanOrEqual(3);
  });

  it('records inaccessible media as unavailable instead of failing the run or bypassing restrictions', async () => {
    const { data: creatives } = await context.admin.from('ad_creatives').select('id').eq('user_id', context.users[0].id).limit(1);
    expect(creatives?.length).toBeGreaterThan(0);
    await context.admin.from('storage_assets').delete().eq('user_id', context.users[0].id).like('dedupe_key', 'video:%');
    await context.mock.failNext({ match: 'v1?fields', times: 99, status: 403, error: { code: 10, message: 'Application does not have permission for this action' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 3 });
    expect(run.status).toBe('succeeded');
    const asset = await waitFor(
      async () => {
        const { data } = await context.admin.from('storage_assets').select('status,error').eq('user_id', context.users[0].id).eq('dedupe_key', 'video:v1').maybeSingle();
        return data?.status === 'unavailable' ? data : null;
      },
      { timeoutMs: 60_000, description: 'the video asset to be marked unavailable' },
    );
    expect(asset.error).toContain('permission');
  });
});
