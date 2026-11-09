import {
  AdAccountSummary, collectAndWait, connectMeta, connectTikTok, createIntegrationContext, IntegrationContext, isoDaysAgo, waitForRun,
} from '../../src/testing/integration-flows';
import { waitFor } from '../../src/testing/integration-support';
import { MOCK_TOKENS } from '../../src/testing/mock-meta/fixtures';
import { MOCK_TIKTOK_ADVERTISER, MOCK_TIKTOK_TOKENS } from '../../src/testing/mock-meta/tiktok-mock';

interface AdListItem {
  id: string;
  platform: string;
  meta_ad_id: string;
  name: string;
  format: string;
  platforms: string[] | null;
  campaign_name: string;
  ad_set_name: string;
  effective_status: string;
  media: { kind: string; status: string; url: string | null }[];
}

interface AdsResponse {
  items: AdListItem[];
  total: number;
}

interface Analytics {
  range: { days_with_data: number };
  metrics: Record<string, number | null>;
}

interface TikTokConnection {
  id: string;
  status: string;
  last_error: string | null;
}

/** TikTok through the same pipeline as Meta: connect -> search -> collect -> persist -> insights -> media -> analytics. */
describe('TikTok ads (integration)', () => {
  let context: IntegrationContext;
  let accountId: string;
  const days = 10;
  const advertiserIds = [MOCK_TIKTOK_ADVERTISER.advertiser_id];

  beforeAll(async () => {
    context = await createIntegrationContext(['tiktok', 'tiktok-other']);
  });
  afterAll(() => context.cleanup());
  const api = () => context.users[0].api;
  const searchAds = async (keywords: string) => (await api().get<AdsResponse>(`/ads?keywords=${keywords}&sort=name&dir=asc`)).body;

  it('rejects tokens TikTok refuses or that cannot access the advertisers', async () => {
    for (const token of [MOCK_TIKTOK_TOKENS.expired, MOCK_TIKTOK_TOKENS.noAccess, 'tiktok-mock-unknown-token-000']) {
      const response = await api().post('/tiktok/connections', { token, advertiser_ids: advertiserIds });
      expect(response.status).toBe(400);
    }
    expect((await api().post('/tiktok/connections', { token: MOCK_TIKTOK_TOKENS.valid, advertiser_ids: ['not-a-number'] })).status).toBe(400);
  });

  it('connects a token, creating a TikTok ad account that Meta endpoints do not list', async () => {
    const accounts = await connectTikTok(api(), MOCK_TIKTOK_TOKENS.valid, advertiserIds);
    const account = accounts.find((entry) => entry.meta_account_id === 'tiktok:7001001') as AdAccountSummary & { platform: string };
    expect(account).toMatchObject({ name: 'Mock TikTok Advertiser', currency: 'USD', selected: true, platform: 'tiktok' });
    accountId = account.id;

    const connections = (await api().get<TikTokConnection[]>('/tiktok/connections')).body;
    expect(connections).toHaveLength(1);
    expect(JSON.stringify(connections)).not.toContain(MOCK_TIKTOK_TOKENS.valid); // the token is never returned
    expect((await api().get<unknown[]>('/meta/connections')).body).toEqual([]);
  });

  it('collects TikTok ads through ad, campaign and ad group name searches', async () => {
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days });
    expect(run.status).toBe('succeeded');
    expect(run.counters).toMatchObject({ ads_found: 2, ads_new: 2, ads_updated: 0 });

    const result = await searchAds('summer');
    expect(result.total).toBe(2);
    expect(result.items.map((ad) => ad.name)).toEqual(['Summer Banner', 'Summer Dance Video']);
    expect(result.items[1]).toMatchObject({
      platform: 'tiktok', meta_ad_id: 'tiktok:ta1', format: 'video', platforms: ['tiktok'], campaign_name: 'Summer TikTok Campaign', ad_set_name: 'US Gen Z', effective_status: 'ACTIVE',
    });
    expect(result.items[0]).toMatchObject({ meta_ad_id: 'tiktok:ta2', format: 'image' });
  });

  it('finds ads through their campaign name and maps paused status', async () => {
    const run = await collectAndWait(api(), { accountId, keywords: ['winter'], days });
    expect(run.counters).toMatchObject({ ads_found: 1, ads_new: 1 });
    const [ad] = (await searchAds('winter')).items;
    expect(ad).toMatchObject({ name: 'Winter Promo Carousel', format: 'carousel', effective_status: 'PAUSED' });
  });

  it('computes analytics from TikTok report data and keeps unreported metrics null', async () => {
    const [banner] = (await searchAds('summer banner')).items;
    const analytics = (await api().get<Analytics>(`/ads/${banner.id}/analytics`)).body;
    expect(analytics.range.days_with_data).toBe(days);
    expect(analytics.metrics.spend).toBeCloseTo(20 * days); // adIndex 1 -> 20 per day
    expect(analytics.metrics.impressions).toBeGreaterThan(0);
    for (const unreported of ['revenue', 'purchases', 'roas', 'cpa', 'installs', 'hook_rate']) expect(analytics.metrics[unreported]).toBeNull();
  });

  it('stores cover images and images in the private bucket', async () => {
    const items = await waitFor(
      async () => {
        const { items: collected } = await searchAds('summer');
        const media = collected.flatMap((ad) => ad.media);
        return media.length >= 2 && media.every((entry) => entry.status === 'stored' && entry.url) ? collected : null;
      },
      { timeoutMs: 60_000, description: 'TikTok media to be stored' },
    );
    expect(items.find((ad) => ad.meta_ad_id === 'tiktok:ta1')?.media.map((entry) => entry.kind)).toContain('thumbnail');
  });

  it('re-collecting is idempotent and also works alongside Meta in one search', async () => {
    const rerun = await collectAndWait(api(), { accountId, keywords: ['summer'], days });
    expect(rerun.counters).toMatchObject({ ads_found: 2, ads_new: 0, ads_updated: 2 });

    const metaAccounts = await connectMeta(api(), MOCK_TOKENS.valid);
    const metaAccountId = metaAccounts.find((account) => account.meta_account_id === 'act_1001')?.id as string;
    await collectAndWait(api(), { accountId: metaAccountId, keywords: ['summer'], days });

    const mixed = await searchAds('summer');
    expect(mixed.total).toBe(4);
    expect(new Set(mixed.items.map((ad) => ad.platform))).toEqual(new Set(['meta', 'tiktok']));
  });

  it('schedules a TikTok account like any other', async () => {
    const created = await api().post<{ id: string }>('/schedules', {
      name: 'TikTok summer', keywords: ['summer'], ad_account_id: accountId, interval_unit: 'day', interval_value: 1, timezone: 'UTC', lookback_days: 7, start_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(created.status).toBe(201);
    const run = await waitFor(
      async () => (await api().get<{ items: { id: string; schedule_id: string | null }[] }>('/collection-runs?page_size=50')).body.items.find((entry) => entry.schedule_id === created.body.id) ?? null,
      { timeoutMs: 60_000, description: 'the scheduled TikTok run to start' },
    );
    expect(['succeeded', 'partial']).toContain((await waitForRun(api(), run.id)).status);
    await api().delete(`/schedules/${created.body.id}`);
  });

  it('keeps a partial result when one report call fails, and reports it', async () => {
    await context.mock.failNext({ match: 'report/integrated/get', times: 1, status: 200, error: { code: 40_002, message: 'Invalid metrics' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days });
    expect(run.status).toBe('partial');
    expect(run.errors.some((entry) => entry.message.includes('daily insights: Invalid metrics'))).toBe(true);
  });

  it('marks the connection expired and fails the run when TikTok rejects the token', async () => {
    await context.mock.failNext({ match: 'ad/get', times: 50, status: 200, error: { code: 40_105, message: 'Access token is invalid or expired' } });
    const started = await api().post<{ run: { id: string } }>('/search/collect', {
      keywords: ['summer'], ad_account_id: accountId, date_from: isoDaysAgo(days - 1), date_to: isoDaysAgo(0),
    });
    const run = await waitForRun(api(), started.body.run.id);
    expect(run.status).toBe('failed');
    const [connection] = (await api().get<TikTokConnection[]>('/tiktok/connections')).body;
    expect(connection.status).toBe('expired');
    expect(connection.last_error).toContain('invalid or expired');
  });

  it("does not let another user use or see the first user's TikTok account", async () => {
    const other = context.users[1].api;
    expect((await other.get<unknown[]>('/tiktok/connections')).body).toEqual([]);
    const response = await other.post('/search/collect', { keywords: ['summer'], ad_account_id: accountId });
    expect(response.status).toBe(404);
  });

  it('disconnects the connection', async () => {
    const [connection] = (await api().get<TikTokConnection[]>('/tiktok/connections')).body;
    expect((await api().delete(`/tiktok/connections/${connection.id}`)).status).toBe(204);
    expect((await api().get<TikTokConnection[]>('/tiktok/connections')).body).toEqual([]);
    expect((await api().delete(`/tiktok/connections/${connection.id}`)).status).toBe(404);
  });
});
