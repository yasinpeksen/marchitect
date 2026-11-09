import { AppConfig } from '../common/app-config';
import { SupabaseService } from '../common/supabase.service';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import { TikTokApiClient, TikTokApiError } from './tiktok-api.client';
import { buildNameFilter, TikTokCollectorService } from './tiktok-collector.service';

const account = { id: 'acc-1', meta_account_id: 'tiktok:700' };
const context = { token: 'token' };

const adOne = { ad_id: '1', ad_name: 'Spring Video', campaign_id: 'c1', adgroup_id: 'g1', video_id: 'v1', ad_text: 'Fresh', operation_status: 'ENABLE' };
const adTwo = { ad_id: '2', ad_name: 'Spring Banner', campaign_id: 'c1', adgroup_id: 'g1', image_ids: ['i1'] };

const buildCollector = (configOverrides: Record<string, unknown> = {}) => {
  const fake = new FakeSupabase();
  const tiktok = {
    listAds: jest.fn().mockResolvedValue([]),
    listCampaigns: jest.fn().mockResolvedValue([]),
    listAdGroups: jest.fn().mockResolvedValue([]),
    videoInfo: jest.fn().mockResolvedValue([{ video_id: 'v1', video_cover_url: 'https://p16.tiktokcdn.com/cover.jpg' }]),
    imageInfo: jest.fn().mockResolvedValue([{ image_id: 'i1', image_url: 'https://p16.tiktokcdn.com/i1.jpg' }]),
  };
  const collector = new TikTokCollectorService(fake as unknown as SupabaseService, tiktok as unknown as TikTokApiClient, buildTestConfig(configOverrides) as unknown as AppConfig);
  return { collector, fake, tiktok };
};

const collect = (collector: TikTokCollectorService, keywords = ['spring']) => collector.collect({ userId: 'u1', account, advertiserId: '700', context, keywords });

const respondWithUpserts = (fake: FakeSupabase, existingAds: { meta_ad_id: string }[] = []) => {
  fake.respond('campaigns', { data: [{ id: 'camp-uuid', meta_campaign_id: 'tiktok:c1' }] });
  fake.respond('ad_sets', { data: [{ id: 'set-uuid', meta_adset_id: 'tiktok:g1' }] });
  fake.respond('ad_creatives', { data: [{ id: 'cr-1', meta_creative_id: 'tiktok:creative:1' }, { id: 'cr-2', meta_creative_id: 'tiktok:creative:2' }] });
  fake.respond('ads', { data: existingAds });
  fake.respond('ads', { data: [{ id: 'ad-uuid-1', meta_ad_id: 'tiktok:1' }, { id: 'ad-uuid-2', meta_ad_id: 'tiktok:2' }] });
};

describe('buildNameFilter', () => {
  it('builds a substring filter on the given field', () => {
    expect(buildNameFilter('ad_name', 'sale')).toEqual({ ad_name: 'sale' });
    expect(buildNameFilter('campaign_name', 'x')).toEqual({ campaign_name: 'x' });
  });
});

describe('TikTokCollectorService', () => {
  it('returns nothing when no ad matches', async () => {
    const { collector } = buildCollector();
    expect(await collect(collector)).toEqual({ ads: [], errors: [], truncated: false });
  });

  it('finds ads by ad name and through campaign / ad group names, then persists the hierarchy', async () => {
    const { collector, fake, tiktok } = buildCollector();
    tiktok.listAds.mockImplementation((_context, _advertiser, filtering: Record<string, unknown>) => {
      if (filtering.ad_name) return Promise.resolve([adOne]);
      if (filtering.campaign_ids) return Promise.resolve([adTwo]);
      return Promise.resolve([adOne]);
    });
    tiktok.listCampaigns.mockResolvedValue([{ campaign_id: 'c1', campaign_name: 'Spring Campaign' }]);
    tiktok.listAdGroups.mockResolvedValue([{ adgroup_id: 'g1', adgroup_name: 'Spring Group', campaign_id: 'c1' }]);
    respondWithUpserts(fake, [{ meta_ad_id: 'tiktok:2' }]);

    const result = await collect(collector, [' Spring ', 'spring']);

    expect(result.errors).toEqual([]);
    expect(result.ads).toEqual([
      { id: 'ad-uuid-1', meta_ad_id: 'tiktok:1', creative_id: 'cr-1', is_new: true, is_dynamic: false, keywords: ['spring'] },
      { id: 'ad-uuid-2', meta_ad_id: 'tiktok:2', creative_id: 'cr-2', is_new: false, is_dynamic: false, keywords: ['spring'] },
    ]);
    expect(tiktok.listAds).toHaveBeenCalledWith(context, '700', { ad_name: 'spring' }, 100);
    expect(tiktok.listAds).toHaveBeenCalledWith(context, '700', { campaign_ids: ['c1'] }, 100);
    expect(tiktok.listAds).toHaveBeenCalledWith(context, '700', { adgroup_ids: ['g1'] }, 100);

    const [adRows] = fake.argumentsOf('ads', 'upsert') as [Record<string, unknown>[]];
    expect(adRows[0]).toMatchObject({
      platform: 'tiktok', meta_ad_id: 'tiktok:1', campaign_id: 'camp-uuid', ad_set_id: 'set-uuid', creative_id: 'cr-1', campaign_name: 'Spring Campaign',
      ad_set_name: 'Spring Group', status: 'ACTIVE', format: 'video', headline: null, primary_text: 'Fresh',
    });
    const [creativeRows] = fake.argumentsOf('ad_creatives', 'upsert') as [Record<string, unknown>[]];
    expect(creativeRows[0]).toMatchObject({ meta_creative_id: 'tiktok:creative:1', thumbnail_url: 'https://p16.tiktokcdn.com/cover.jpg', user_id: 'u1', ad_account_id: 'acc-1' });
    expect(creativeRows[1]).toMatchObject({ format: 'image', image_url: 'https://p16.tiktokcdn.com/i1.jpg' });
    const [adSetRows] = fake.argumentsOf('ad_sets', 'upsert') as [Record<string, unknown>[]];
    expect(adSetRows[0]).toMatchObject({ meta_adset_id: 'tiktok:g1', campaign_id: 'camp-uuid' });
  });

  it('records a per-keyword error and carries on', async () => {
    const { collector, tiktok } = buildCollector();
    tiktok.listAds.mockRejectedValue(new TikTokApiError('Invalid filter', 200, 40_002));
    const result = await collect(collector, ['bad']);
    expect(result.errors).toEqual(['Keyword "bad": Invalid filter']);
    expect(result.ads).toEqual([]);
  });

  it('stringifies non-Error failures', async () => {
    const { collector, tiktok } = buildCollector();
    tiktok.listAds.mockRejectedValue('boom');
    expect((await collect(collector)).errors).toEqual(['Keyword "spring": boom']);
  });

  it('aborts the run on auth and permission failures', async () => {
    const { collector, tiktok } = buildCollector();
    tiktok.listAds.mockRejectedValue(new TikTokApiError('Access token is invalid', 200, 40_105));
    await expect(collect(collector)).rejects.toMatchObject({ isAuth: true });
    tiktok.listAds.mockRejectedValue(new TikTokApiError('No permission', 403));
    await expect(collect(collector)).rejects.toMatchObject({ isPermission: true });
  });

  it('caps the result at MAX_ADS_PER_RUN and says so', async () => {
    const { collector, fake, tiktok } = buildCollector({ maxAdsPerRun: 1 });
    tiktok.listAds.mockResolvedValue([adOne, adTwo]);
    respondWithUpserts(fake);
    const result = await collect(collector);
    expect(result.truncated).toBe(true);
    expect(result.errors).toEqual(['Result capped at 1 ads (MAX_ADS_PER_RUN).']);
    expect(result.ads).toHaveLength(1);
  });

  it('keeps ads when artwork lookup fails, reporting a non-fatal error', async () => {
    const { collector, fake, tiktok } = buildCollector();
    tiktok.listAds.mockResolvedValue([adOne]);
    tiktok.videoInfo.mockRejectedValue(new TikTokApiError('Service busy', 200, 50_000, true));
    respondWithUpserts(fake);
    const result = await collect(collector);
    expect(result.errors).toEqual(['Creative artwork: Service busy']);
    expect(result.ads).toHaveLength(1);
    const [creativeRows] = fake.argumentsOf('ad_creatives', 'upsert') as [Record<string, unknown>[]];
    expect(creativeRows[0]).toMatchObject({ thumbnail_url: null });
  });

  it('aborts when artwork lookup is forbidden and tolerates non-Error failures', async () => {
    const { collector, tiktok } = buildCollector();
    tiktok.listAds.mockResolvedValue([adOne]);
    tiktok.videoInfo.mockRejectedValue(new TikTokApiError('No permission', 403));
    await expect(collect(collector)).rejects.toMatchObject({ isPermission: true });
    tiktok.videoInfo.mockRejectedValue('weird');
    const result = await collect(collector);
    expect(result.errors).toEqual(['Creative artwork: weird']);
  });
});
