import { AppConfig } from '../common/app-config';
import { SupabaseService } from '../common/supabase.service';
import { MetaApiClient, MetaApiError } from '../meta/meta-api.client';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import { AdCollectorService, buildAdRow, buildContainFilter, buildInFilter, normalizeKeywordList, nullIfBlank, toNullableNumber, upsertAndMapIds } from './ad-collector.service';

describe('collector helpers', () => {
  it('nullIfBlank turns blank-ish values into null', () => {
    expect(nullIfBlank('')).toBeNull();
    expect(nullIfBlank(undefined)).toBeNull();
    expect(nullIfBlank(null)).toBeNull();
    expect(nullIfBlank('x')).toBe('x');
    expect(nullIfBlank(0)).toBe(0);
  });
  it('toNullableNumber converts budgets', () => {
    expect(toNullableNumber('1500')).toBe(1500);
    expect(toNullableNumber('')).toBeNull();
    expect(toNullableNumber(undefined)).toBeNull();
  });
  it('builds Meta filtering clauses', () => {
    expect(buildContainFilter('name', 'sale')).toEqual([{ field: 'name', operator: 'CONTAIN', value: 'sale' }]);
    expect(buildInFilter('campaign.id', ['1', '2'])).toEqual([{ field: 'campaign.id', operator: 'IN', value: ['1', '2'] }]);
  });
  it('normalizeKeywordList lowercases, trims and de-duplicates', () => {
    expect(normalizeKeywordList([' Sale ', 'sale', '', 'NEW'])).toEqual(['sale', 'new']);
  });
});

describe('upsertAndMapIds', () => {
  it('upserts in batches keyed on user and external id, and maps external id -> uuid', async () => {
    const fake = new FakeSupabase();
    fake.respond('ads', { data: [{ id: 'uuid-1', meta_ad_id: 'a1' }] }).respond('ads', { data: [{ id: 'uuid-2', meta_ad_id: 'a2' }] });
    const rows = Array.from({ length: 301 }, (_unused, index) => ({ meta_ad_id: `a${index}` }));
    const mapping = await upsertAndMapIds(fake as unknown as SupabaseService, 'ads', 'meta_ad_id', rows);
    expect(fake.callsTo('ads')).toHaveLength(2);
    expect(fake.argumentsOf('ads', 'upsert')?.[1]).toEqual({ onConflict: 'user_id,meta_ad_id' });
    expect([...mapping]).toEqual([['a1', 'uuid-1'], ['a2', 'uuid-2']]);
  });
  it('does nothing for no rows', async () => {
    const fake = new FakeSupabase();
    expect((await upsertAndMapIds(fake as unknown as SupabaseService, 'ads', 'meta_ad_id', [])).size).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('buildAdRow', () => {
  const ad = { id: 'ad_1', name: 'Ad', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-01-01T00:00:00+0000', updated_time: '' };
  const base = { userId: 'u1', accountId: 'acc', campaignId: 'c-uuid', adSetId: 's-uuid', creativeId: 'cr-uuid', collectedAt: '2026-02-01T00:00:00Z' };

  it('denormalises names and copy for search', () => {
    const row = buildAdRow(ad, {
      ...base,
      mappedCreative: { title: 'Headline', body: 'Body', call_to_action_type: 'SHOP_NOW', format: 'video' } as never,
      campaign: { id: 'c1', name: 'Campaign' },
      adSet: { id: 's1', name: 'Set', targeting: { publisher_platforms: ['facebook'] } },
    });
    expect(row).toMatchObject({
      user_id: 'u1', ad_account_id: 'acc', campaign_id: 'c-uuid', ad_set_id: 's-uuid', creative_id: 'cr-uuid', meta_ad_id: 'ad_1', format: 'video',
      campaign_name: 'Campaign', ad_set_name: 'Set', headline: 'Headline', primary_text: 'Body', cta: 'SHOP_NOW', platforms: ['facebook'],
      ad_created_time: '2026-01-01T00:00:00+0000', ad_updated_time: null, last_collected_at: '2026-02-01T00:00:00Z', raw: ad,
    });
  });

  it('uses nulls when related objects are unknown', () => {
    expect(buildAdRow(ad, { ...base, campaignId: null, adSetId: null, creativeId: null })).toMatchObject({
      campaign_id: null, format: null, platforms: null, campaign_name: null, headline: null,
    });
  });
});

const metaAd = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: `Ad ${id}`, status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: 'c1', adset_id: 's1',
  creative: { id: `cr-${id}`, title: 'T', body: 'B', image_hash: `hash-${id}` }, ...overrides,
});

const buildCollector = (configOverrides: Record<string, unknown> = {}) => {
  const fake = new FakeSupabase();
  const meta = {
    listAds: jest.fn().mockResolvedValue([]),
    getAll: jest.fn().mockResolvedValue([]),
    getMany: jest.fn().mockImplementation((_context: unknown, ids: string[]) =>
      Promise.resolve(Object.fromEntries(ids.map((id) => [id, { id, name: `Name ${id}`, campaign_id: 'c1', targeting: { publisher_platforms: ['instagram'] } }])))),
  };
  const service = new AdCollectorService(fake as unknown as SupabaseService, meta as unknown as MetaApiClient, buildTestConfig(configOverrides) as unknown as AppConfig);
  const input = { userId: 'u1', account: { id: 'acc-1', meta_account_id: 'act_1' }, context: { token: 'EAAx' }, keywords: ['Summer'] };
  return { fake, meta, service, input };
};

const arrangeUpserts = (fake: FakeSupabase) => {
  fake.respond('campaigns', { data: [{ id: 'campaign-uuid', meta_campaign_id: 'c1' }] });
  fake.respond('ad_sets', { data: [{ id: 'adset-uuid', meta_adset_id: 's1' }] });
  fake.respond('ad_creatives', { data: [{ id: 'creative-uuid-1', meta_creative_id: 'cr-ad_1' }, { id: 'creative-uuid-2', meta_creative_id: 'cr-ad_2' }] });
};

describe('AdCollectorService.collect', () => {
  it('finds ads by ad name, campaign name and ad set name and persists the hierarchy', async () => {
    const { fake, meta, service, input } = buildCollector();
    meta.listAds
      .mockResolvedValueOnce([metaAd('ad_1')]) // name match
      .mockResolvedValueOnce([metaAd('ad_2')]) // via campaign
      .mockResolvedValueOnce([metaAd('ad_2')]); // via ad set (duplicate)
    meta.getAll.mockResolvedValueOnce([{ id: 'c1' }]).mockResolvedValueOnce([{ id: 's1' }]);
    arrangeUpserts(fake);
    fake.respond('ads', { data: [{ meta_ad_id: 'ad_1' }] }); // existing check
    fake.respond('ads', { data: [{ id: 'ad-uuid-1', meta_ad_id: 'ad_1' }, { id: 'ad-uuid-2', meta_ad_id: 'ad_2' }] }); // upsert

    const result = await service.collect(input);

    expect(meta.listAds.mock.calls.map((call) => call[2].filtering[0])).toEqual([
      { field: 'name', operator: 'CONTAIN', value: 'summer' },
      { field: 'campaign.id', operator: 'IN', value: ['c1'] },
      { field: 'adset.id', operator: 'IN', value: ['s1'] },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.ads).toEqual([
      { id: 'ad-uuid-1', meta_ad_id: 'ad_1', creative_id: 'creative-uuid-1', is_new: false, is_dynamic: false, keywords: ['summer'] },
      { id: 'ad-uuid-2', meta_ad_id: 'ad_2', creative_id: 'creative-uuid-2', is_new: true, is_dynamic: false, keywords: ['summer'] },
    ]);
    const adRows = fake.callsTo('ads').flatMap((call) => call.operations).find((operation) => operation.name === 'upsert')?.args[0] as Record<string, unknown>[];
    expect(adRows[0]).toMatchObject({ campaign_id: 'campaign-uuid', ad_set_id: 'adset-uuid', headline: 'T', campaign_name: 'Name c1', platforms: ['instagram'] });
    expect(fake.argumentsOf('ad_creatives', 'upsert')?.[1]).toEqual({ onConflict: 'user_id,meta_creative_id' });
  });

  it('returns early without writing when nothing matches', async () => {
    const { fake, service, input } = buildCollector();
    expect(await service.collect(input)).toEqual({ ads: [], errors: [], truncated: false });
    expect(fake.calls).toHaveLength(0);
  });

  it('records the keywords that matched each ad', async () => {
    const { fake, meta, service, input } = buildCollector();
    meta.listAds.mockResolvedValue([metaAd('ad_1')]);
    arrangeUpserts(fake);
    fake.respond('ads', { data: [] });
    fake.respond('ads', { data: [{ id: 'ad-uuid-1', meta_ad_id: 'ad_1' }] });
    const result = await service.collect({ ...input, keywords: ['summer', 'sale'] });
    expect(result.ads[0].keywords.sort()).toEqual(['sale', 'summer']);
  });

  it('flags dynamic creatives', async () => {
    const { fake, meta, service, input } = buildCollector();
    meta.listAds.mockResolvedValueOnce([metaAd('ad_1', { creative: { id: 'cr-ad_1', asset_feed_spec: { titles: [{ text: 'T' }] } } })]);
    arrangeUpserts(fake);
    fake.respond('ads', { data: [] });
    fake.respond('ads', { data: [{ id: 'ad-uuid-1', meta_ad_id: 'ad_1' }] });
    expect((await service.collect(input)).ads[0].is_dynamic).toBe(true);
  });

  it('caps the result at MAX_ADS_PER_RUN and reports it', async () => {
    const { fake, meta, service, input } = buildCollector({ maxAdsPerRun: 1 });
    meta.listAds.mockResolvedValueOnce([metaAd('ad_1'), metaAd('ad_2')]);
    arrangeUpserts(fake);
    fake.respond('ads', { data: [] });
    fake.respond('ads', { data: [{ id: 'ad-uuid-1', meta_ad_id: 'ad_1' }] });
    const result = await service.collect(input);
    expect(result.truncated).toBe(true);
    expect(result.ads).toHaveLength(1);
    expect(result.errors[0]).toContain('capped at 1 ads');
  });

  it('keeps going when one keyword fails and reports the error', async () => {
    const { fake, meta, service, input } = buildCollector();
    meta.listAds.mockRejectedValueOnce(new MetaApiError('rate limited', 400, 17)).mockResolvedValue([metaAd('ad_1')]);
    arrangeUpserts(fake);
    fake.respond('ads', { data: [] });
    fake.respond('ads', { data: [{ id: 'ad-uuid-1', meta_ad_id: 'ad_1' }] });
    const result = await service.collect({ ...input, keywords: ['first', 'second'] });
    expect(result.errors).toEqual(['Keyword "first": rate limited']);
    expect(result.ads).toHaveLength(1);
  });

  it.each([[new MetaApiError('expired', 401, 190)], [new MetaApiError('no permission', 403, 200)]])('aborts the whole run on %p', async (error) => {
    const { meta, service, input } = buildCollector();
    meta.listAds.mockRejectedValue(error);
    await expect(service.collect(input)).rejects.toBe(error);
  });

  it('surfaces database write errors', async () => {
    const { fake, meta, service, input } = buildCollector();
    meta.listAds.mockResolvedValueOnce([metaAd('ad_1')]);
    fake.respond('campaigns', { error: { message: 'write failed' } });
    await expect(service.collect(input)).rejects.toThrow('upsert campaigns: write failed');
  });
});
