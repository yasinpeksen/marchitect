import { collectAndWait, connectMeta, createIntegrationContext, IntegrationContext } from '../../src/testing/integration-flows';
import { MOCK_TOKENS } from '../../src/testing/mock-meta/fixtures';

interface AdListItem {
  id: string;
  platform: string;
  meta_ad_id: string;
  name: string;
  campaign_name: string;
  headline: string;
  primary_text: string;
  platforms: string[];
  effective_status: string;
  total_spend: number;
}

/** "Collect ads" also searches Meta's public Ad Library, so keywords find ads that are not in your own ad account. */
describe('Meta Ad Library collection (integration)', () => {
  let context: IntegrationContext;
  let accountId: string;

  beforeAll(async () => {
    context = await createIntegrationContext(['ad-library']);
    accountId = (await connectMeta(context.users[0].api, MOCK_TOKENS.valid)).find((account) => account.meta_account_id === 'act_1001')?.id as string;
  });
  afterAll(() => context.cleanup());
  const api = () => context.users[0].api;
  const search = async (keywords: string) => (await api().get<{ items: AdListItem[]; total: number }>(`/ads?keywords=${keywords}`)).body;

  it('finds public ads that are not in the connected ad account', async () => {
    const run = await collectAndWait(api(), { accountId, keywords: ['running'], days: 10 });
    expect(run.status).toBe('succeeded');
    expect(run.counters).toMatchObject({ ads_found: 1, ads_new: 1 });

    const { items, total } = await search('running');
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      meta_ad_id: 'adlib:lib1', platform: 'meta', name: 'Competitor Shoes', campaign_name: 'Competitor Shoes', headline: 'Run faster',
      primary_text: 'Buy running shoes now', platforms: ['facebook', 'instagram'], effective_status: 'ACTIVE',
    });
  });

  it('searches the advertiser name too, and re-collecting is idempotent', async () => {
    const run = await collectAndWait(api(), { accountId, keywords: ['competitor'], days: 10 });
    expect(run.counters).toMatchObject({ ads_found: 1, ads_new: 0, ads_updated: 1 });
    expect((await search('competitor')).total).toBe(1);
  });

  it('does not invent performance data for library ads', async () => {
    const { items } = await search('running');
    expect(items[0].total_spend).toBe(0); // no metrics were collected (stored totals default to 0)
    const analytics = (await api().get<{ range: { days_with_data: number }; metrics: Record<string, number | null> }>(`/ads/${items[0].id}/analytics`)).body;
    expect(analytics.range.days_with_data).toBe(0);
    for (const metric of ['spend', 'impressions', 'ctr', 'roas']) expect(analytics.metrics[metric]).toBeNull();
    const insightRequests = (await context.mock.requests()).filter((entry) => entry.path.endsWith('/insights'));
    expect(JSON.stringify(insightRequests)).not.toContain('adlib');
  });

  it('keeps the run and tells the user how to get access when Meta refuses the Ad Library', async () => {
    await context.mock.failNext({
      match: 'ads_archive', times: 10, status: 400,
      error: { code: 10, message: 'To access the API, you will need to follow the steps at facebook.com/ads/library/api.' },
    });
    const run = await collectAndWait(api(), { accountId, keywords: ['motivation'], days: 10 });
    expect(run.status).toBe('partial');
    expect(run.counters).toMatchObject({ ads_found: 0 });
    expect(run.errors.map((entry) => entry.message).join(' ')).toContain('facebook.com/ads/library/api');
  });

  it('still returns the ad account matches when the Ad Library fails', async () => {
    await context.mock.failNext({ match: 'ads_archive', times: 10, status: 400, error: { code: 10, message: 'No Ad Library access' } });
    const run = await collectAndWait(api(), { accountId, keywords: ['summer'], days: 10 });
    expect(run.status).toBe('partial');
    expect(run.counters).toMatchObject({ ads_found: 2 });
  });
});
