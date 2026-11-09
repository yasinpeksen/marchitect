import {
  AdAccountSummary, collectAndWait, connectMeta, createIntegrationContext, IntegrationContext, isoDaysAgo } from '../../src/testing/integration-flows';
import { waitFor } from '../../src/testing/integration-support';
import { MOCK_TOKENS, MP4_BYTES } from '../../src/testing/mock-meta/fixtures';
import { rangeTotals } from '../../src/testing/mock-meta/insights';

interface AdListItem {
  id: string;
  meta_ad_id: string;
  name: string;
  format: string;
  platforms: string[] | null;
  campaign_name: string;
  media: { kind: string; status: string; url: string | null }[];
}

interface AdsResponse {
  items: AdListItem[];
  total: number;
}

interface AdDetail {
  campaign: { name: string; objective: string };
  ad_set: { name: string; optimization_goal: string };
  targeting: { age_min: number; genders: number[]; geo_locations: { countries: string[] } };
  creative: { title: string; body: string; call_to_action_type: string; video_id: string; format: string };
}

interface AdRaw {
  ad: { id: string };
  latest_insights: { ad_id: string };
}

interface AnalyticsResponse {
  range: { days_with_data: number };
  metrics: Record<string, number | null>;
  rankings: { quality: string } | null;
  fatigue: { status: string };
  daily: unknown[];
  breakdowns: Record<string, { rows: { dim_key: string }[] }>;
}

/** The whole pipeline against mock Meta: search -> collect -> persist -> insights -> media -> analytics. */
describe('Ad collection pipeline (integration)', () => {
  let context: IntegrationContext;
  let accountId: string;
  const days = 10;

  beforeAll(async () => {
    context = await createIntegrationContext(['collection']);
    const accounts = await connectMeta(context.users[0].api, MOCK_TOKENS.valid);
    accountId = (accounts as AdAccountSummary[]).find((account) => account.meta_account_id === 'act_1001')?.id as string;
  });
  afterAll(() => context.cleanup());
  const api = () => context.users[0].api;
  const searchAds = async (keywords: string) => (await api().get<AdsResponse>(`/ads?keywords=${keywords}&sort=name&dir=asc`)).body;

  it('collects ads matching a keyword through ad-name, campaign-name and ad-set filters', async () => {
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days });
    expect(run.status).toBe('succeeded');
    expect(run.counters).toMatchObject({ ads_found: 2, ads_new: 2, ads_updated: 0 });
    expect(run.errors).toEqual([]);

    const result = await searchAds('summer');
    expect(result.total).toBe(2);
    expect(result.items.map((ad) => ad.name)).toEqual(['Summer Banner', 'Summer Sale Video']);
    expect(result.items[1]).toMatchObject({ meta_ad_id: 'ad_1', format: 'video', campaign_name: 'Summer Sale Campaign', platforms: ['facebook', 'instagram'] });
    expect(result.items[0]).toMatchObject({ meta_ad_id: 'ad_2', format: 'image' });
  });

  it('persists the campaign / ad set / creative hierarchy with raw JSON next to normalised fields', async () => {
    const { items } = await searchAds('video');
    const detail = (await api().get<AdDetail>(`/ads/${items[0].id}`)).body;
    expect(detail.campaign).toMatchObject({ name: 'Summer Sale Campaign', objective: 'OUTCOME_SALES' });
    expect(detail.ad_set).toMatchObject({ name: 'US Adults 25-44', optimization_goal: 'OFFSITE_CONVERSIONS' });
    expect(detail.targeting).toMatchObject({ age_min: 25, genders: [2], geo_locations: { countries: ['US'] } });
    expect(detail.creative).toMatchObject({ title: 'Summer deals', body: 'Save big this summer', call_to_action_type: 'SHOP_NOW', video_id: 'v1', format: 'video' });
    const raw = (await api().get<AdRaw>(`/ads/${items[0].id}/raw`)).body;
    expect(raw.ad.id).toBe('ad_1');
    expect(raw.latest_insights.ad_id).toBe('ad_1');
  });

  it('calculates analytics from the collected daily metrics with the documented formulas', async () => {
    const { items } = await searchAds('video');
    const analytics = (await api().get<AnalyticsResponse>(`/ads/${items[0].id}/analytics`)).body;
    const expected = rangeTotals('ad_1', isoDaysAgo(days - 1), isoDaysAgo(0));
    expect(analytics.range.days_with_data).toBe(days);
    expect(analytics.metrics.spend).toBeCloseTo(expected.spend);
    expect(analytics.metrics.impressions).toBe(expected.impressions);
    expect(analytics.metrics.link_clicks).toBe(expected.linkClicks);
    expect(analytics.metrics.ctr).toBeCloseTo((expected.linkClicks / expected.impressions) * 100);
    expect(analytics.metrics.cpm).toBeCloseTo((expected.spend / expected.impressions) * 1000);
    expect(analytics.metrics.cpc).toBeCloseTo(expected.spend / expected.linkClicks);
    expect(analytics.metrics.roas).toBeCloseTo(expected.revenue / expected.spend);
    expect(analytics.metrics.cpa).toBeCloseTo(expected.spend / expected.purchases);
    expect(analytics.metrics.hook_rate).toBeCloseTo((expected.videoViews / expected.impressions) * 100);
    expect(analytics.metrics.hold_rate).toBeCloseTo(((150 * days) / expected.videoViews) * 100);
    expect(analytics.metrics.reach).toBe(Math.round(expected.impressions * 0.8));
    expect(analytics.metrics.installs).toBeNull(); // not reported by Meta: never invented as 0
    expect(analytics.rankings?.quality).toBe('ABOVE_AVERAGE');
    expect(analytics.daily).toHaveLength(days);
    expect(analytics.fatigue.status).toBe('insufficient_data'); // needs 14 days
  });

  it('stores age/gender, country, placement and device breakdowns', async () => {
    const { items } = await searchAds('video');
    const { breakdowns } = (await api().get<AnalyticsResponse>(`/ads/${items[0].id}/analytics`)).body;
    expect(breakdowns.age_gender.rows.map((row) => row.dim_key).sort()).toEqual(['18-24|female', '25-34|female', '35-44|male']);
    expect(breakdowns.country.rows.map((row) => row.dim_key).sort()).toEqual(['CA', 'US']);
    expect(breakdowns.placement.rows.map((row) => row.dim_key).sort()).toEqual(['facebook|feed', 'instagram|story']);
    expect(breakdowns.device.rows.map((row) => row.dim_key).sort()).toEqual(['android_smartphone', 'iphone']);
    expect(breakdowns.image_asset).toBeUndefined(); // dynamic-creative breakdowns only for dynamic ads
  });

  it('downloads accessible media into the private bucket and serves it through signed URLs', async () => {
    const media = await waitFor(
      async () => {
        const { items } = await searchAds('summer');
        const all = items.flatMap((ad) => ad.media);
        return all.length >= 4 && all.every((entry) => entry.status === 'stored' && entry.url) ? items : null;
      },
      { timeoutMs: 90_000, description: 'media downloads to finish' },
    );
    const video = media.find((ad) => ad.meta_ad_id === 'ad_1')?.media.find((entry) => entry.kind === 'video');
    const response = await fetch(video?.url as string);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect((await response.arrayBuffer()).byteLength).toBe(MP4_BYTES.length);

    const { data: assets } = await context.admin.from('storage_assets').select('dedupe_key,status,path,sha256,size_bytes').eq('user_id', context.users[0].id);
    const keys = (assets ?? []).map((asset) => asset.dedupe_key);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(expect.arrayContaining(['imagehash:h1', 'video:v1']));
    expect(keys.filter((key) => key.startsWith('thumb:'))).toHaveLength(2);
    for (const asset of assets ?? []) {
      expect(asset.path).toMatch(new RegExp(`^${context.users[0].id}/(video|image|thumbnail)/[0-9a-f]{64}\\.(mp4|png)$`));
      expect(asset.sha256).toHaveLength(64);
    }
  });

  it('does not expose stored media publicly', async () => {
    const { data } = await context.admin.from('storage_assets').select('path').eq('user_id', context.users[0].id).limit(1).single();
    const publicResponse = await fetch(`${context.environment.supabaseUrl}/storage/v1/object/public/ad-media/${data?.path}`);
    expect(publicResponse.status).toBeGreaterThanOrEqual(400);
  });

  it('is idempotent: collecting again updates in place, with no duplicates and no media re-downloads', async () => {
    await context.mock.reset();
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days });
    expect(run.status).toBe('succeeded');
    expect(run.counters).toMatchObject({ ads_found: 2, ads_new: 0, ads_updated: 2 });

    const { count: adCount } = await context.admin.from('ads').select('id', { count: 'exact', head: true }).eq('user_id', context.users[0].id);
    expect(adCount).toBe(2);
    const { count: dailyCount } = await context.admin.from('ad_daily_metrics').select('id', { count: 'exact', head: true }).eq('user_id', context.users[0].id);
    expect(dailyCount).toBe(2 * days);
    const { count: snapshotCount } = await context.admin.from('ad_insights').select('id', { count: 'exact', head: true }).eq('user_id', context.users[0].id);
    expect(snapshotCount).toBe(2); // one snapshot per ad per range per day

    await new Promise((resolve) => setTimeout(resolve, 3000)); // let any (unexpected) media job reach the mock
    const mediaRequests = (await context.mock.requests()).filter((request) => request.path.startsWith('media/'));
    expect(mediaRequests).toEqual([]);
  });

  it('reuses an identical in-flight collection instead of starting another', async () => {
    await context.mock.setLatency(400);
    const body = { keywords: ['winter'], ad_account_id: accountId, date_from: isoDaysAgo(4), date_to: isoDaysAgo(0) };
    const first = (await api().post<{ run: { id: string }; reused: boolean }>('/search/collect', body)).body;
    const second = (await api().post<{ run: { id: string }; reused: boolean }>('/search/collect', body)).body;
    expect(first.reused).toBe(false);
    expect(second).toMatchObject({ reused: true, run: { id: first.run.id } });
    await context.mock.setLatency(0);
    await waitFor(async () => ((await api().get<{ status: string }>(`/collection-runs/${first.run.id}`)).body.status === 'succeeded' ? true : null), { timeoutMs: 90_000 });
  });

  it('reports collection progress while it runs', async () => {
    await context.mock.setLatency(300);
    const started = (await api().post<{ run: { id: string } }>('/search/collect', { keywords: ['banner'], ad_account_id: accountId, date_from: isoDaysAgo(2), date_to: isoDaysAgo(0) })).body;
    const sawProgress = await waitFor(
      async () => {
        const run = (await api().get<{ status: string; progress: number; stage: string }>(`/collection-runs/${started.run.id}`)).body;
        return run.status === 'running' && run.progress > 0 && run.progress < 100 ? run : null;
      },
      { timeoutMs: 60_000, intervalMs: 100, description: 'a running run with progress' },
    );
    expect(sawProgress.stage).toBeTruthy();
    await context.mock.setLatency(0);
    await waitFor(async () => ((await api().get<{ status: string }>(`/collection-runs/${started.run.id}`)).body.status === 'succeeded' ? true : null), { timeoutMs: 90_000 });
  });

  it('uses asynchronous insight reports for long ranges and stores dynamic-creative breakdowns', async () => {
    await context.mock.reset();
    const run = await collectAndWait(api(), { accountId, keywords: ['winter'], days: 60 });
    expect(run.status).toBe('succeeded');
    expect(run.counters.ads_found).toBe(1);

    const requests = await context.mock.requests();
    expect(requests.some((request) => request.method === 'POST' && request.path === 'act_1001/insights')).toBe(true);
    expect(requests.filter((request) => /^report-\d+$/.test(request.path)).length).toBeGreaterThanOrEqual(2); // polled until completed

    const { items } = await searchAds('winter');
    const analytics = (await api().get<AnalyticsResponse>(`/ads/${items[0].id}/analytics`)).body;
    expect(analytics.range.days_with_data).toBe(60);
    expect(analytics.fatigue.status).toBe('none'); // flat CTR across 60 days
    expect(Object.keys(analytics.breakdowns)).toEqual(expect.arrayContaining(['image_asset', 'body_asset', 'title_asset', 'call_to_action_asset']));
    expect(analytics.breakdowns.image_asset.rows.map((row) => row.dim_key).sort()).toEqual(['h3a', 'h3b']);

    const detail = (await api().get<{ creative_variations: { dynamic: { bodies: string[]; images: string[] } } }>(`/ads/${items[0].id}`)).body;
    expect(detail.creative_variations.dynamic.bodies).toEqual(['Stay warm', 'Winter is coming']);
    expect(detail.creative_variations.dynamic.images).toEqual(['h3a', 'h3b']);
  });

  it('detects ad fatigue from a declining CTR over a long range', async () => {
    await collectAndWait(api(), { accountId, keywords: ['summer sale'], days: 40 });
    const { items } = await searchAds('video');
    const analytics = (await api().get<AnalyticsResponse>(`/ads/${items[0].id}/analytics`)).body;
    expect(analytics.fatigue.status).toBe('high');
  });

  it('answers instant search from the database with filters and sorting, without calling Meta', async () => {
    await context.mock.reset();
    const filtered = (await api().get<AdsResponse>('/ads?formats=video&statuses=ACTIVE&min_spend=1&sort=spend&dir=desc')).body;
    expect(filtered.items.map((ad) => ad.meta_ad_id)).toEqual(['ad_1']);
    const all = (await api().get<AdsResponse>('/ads?keywords=summer,winter&match=any&sort=name&dir=asc')).body;
    expect(all.total).toBe(3);
    expect((await api().get<AdsResponse>('/ads?keywords=summer,winter&match=all')).body.total).toBe(0);
    expect((await api().get<AdsResponse>('/ads?keywords=100%25')).body.total).toBe(0); // LIKE wildcards are escaped
    expect((await context.mock.requests()).filter((request) => request.path.startsWith('act_'))).toEqual([]);
  });

  it('records search history, tag suggestions and run history', async () => {
    expect((await api().get<{ tag: string }[]>('/search/tags?q=sum')).body.map((entry) => entry.tag)).toEqual(expect.arrayContaining(['summer', 'summer sale']));
    expect((await api().get<{ keywords: string[] }[]>('/search/history')).body.length).toBeGreaterThanOrEqual(3);
    const runs = (await api().get<{ items: { status: string }[]; total: number }>('/collection-runs?page_size=100')).body;
    expect(runs.total).toBeGreaterThanOrEqual(5);
    expect(runs.items.every((run) => ['succeeded', 'partial'].includes(run.status))).toBe(true);
  });

  it('refreshes insights for a new date range on demand and recalculates analytics', async () => {
    const { items } = await searchAds('video');
    const refresh = await api().post<{ id: string }>('/insights/refresh', { ad_ids: [items[0].id], date_from: isoDaysAgo(59), date_to: isoDaysAgo(0) });
    expect(refresh.status).toBe(201);
    await waitFor(async () => ((await api().get<{ status: string }>(`/collection-runs/${refresh.body.id}`)).body.status === 'succeeded' ? true : null), { timeoutMs: 90_000 });
    const analytics = (await api().get<AnalyticsResponse>(`/ads/${items[0].id}/analytics`)).body;
    expect(analytics.range.days_with_data).toBe(60);
    const recalculation = await api().post<{ queued: number }>('/analytics/recalculate', { ad_ids: [items[0].id] });
    expect(recalculation.status).toBe(202);
    await waitFor(
      async () => {
        const { data } = await context.admin.from('analytics').select('metrics').eq('ad_id', items[0].id).eq('range_key', 'lifetime');
        return data && data.length === 1 ? data : null;
      },
      { timeoutMs: 60_000, description: 'the analytics job to cache lifetime metrics' },
    );
  });

  it('builds the dashboard overview from collected data', async () => {
    const dashboard = (await api().get<{ totals: { ads: number }; top_ads: unknown[]; performance: unknown[]; activity: unknown[]; recent_ads: unknown[] }>('/dashboard')).body;
    expect(dashboard.totals.ads).toBe(3);
    expect(dashboard.recent_ads.length).toBeGreaterThan(0);
    expect(dashboard.activity).toHaveLength(14);
    expect(dashboard.performance.length).toBeGreaterThan(0);
    expect(dashboard.top_ads.length).toBeGreaterThan(0);
  });

  it('validates collection requests', async () => {
    expect((await api().post('/search/collect', { keywords: [], ad_account_id: accountId })).status).toBe(400);
    expect((await api().post('/search/collect', { keywords: ['a'], ad_account_id: accountId })).status).toBe(400); // too short
    expect((await api().post('/search/collect', { keywords: ['ok'], ad_account_id: '5f0d6d3e-8f4e-4d3c-8f8e-3c0b3a8f9a11' })).status).toBe(404);
    expect((await api().post('/search/collect', { keywords: ['ok'], ad_account_id: accountId, date_from: '2026-02-01', date_to: '2026-01-01' })).status).toBe(400);
  });

  it('supports saved searches end to end', async () => {
    const created = (await api().post<{ id: string }>('/saved-searches', { name: 'Summer set', tags: ['Summer', 'summer', 'banner'], ad_account_id: accountId })).body;
    const listed = (await api().get<{ id: string; tags: string[] }[]>('/saved-searches')).body;
    expect(listed.find((search) => search.id === created.id)?.tags).toEqual(['summer', 'banner']);
    const run = (await api().post<{ run: { id: string } }>(`/saved-searches/${created.id}/run`)).body.run;
    await waitFor(async () => ((await api().get<{ status: string }>(`/collection-runs/${run.id}`)).body.status === 'succeeded' ? true : null), { timeoutMs: 90_000 });
    expect((await api().patch<{ name: string }>(`/saved-searches/${created.id}`, { name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await api().delete(`/saved-searches/${created.id}`)).status).toBe(204);
    expect((await api().delete(`/saved-searches/${created.id}`)).status).toBe(404);
  });
});
