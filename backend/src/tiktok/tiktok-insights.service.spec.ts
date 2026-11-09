import { SupabaseService } from '../common/supabase.service';
import { FakeSupabase } from '../testing/fake-supabase';
import { TikTokApiClient, TikTokApiError } from './tiktok-api.client';
import { buildAdIdsFilter, TikTokInsightsService } from './tiktok-insights.service';

const context = { token: 'token' };
const ads = [{ id: 'ad-uuid-1', meta_ad_id: 'tiktok:1', is_dynamic: false }, { id: 'ad-uuid-2', meta_ad_id: 'tiktok:2', is_dynamic: false }];

const dailyRow = (adId: string, day: string, spend: string) => ({ dimensions: { ad_id: adId, stat_time_day: `${day} 00:00:00` }, metrics: { spend, impressions: '100', clicks: '5' } });

const buildService = () => {
  const fake = new FakeSupabase();
  const tiktok = { report: jest.fn().mockResolvedValue([]) };
  const service = new TikTokInsightsService(fake as unknown as SupabaseService, tiktok as unknown as TikTokApiClient);
  const collect = (overrides: Record<string, unknown> = {}) =>
    service.collect({ userId: 'u1', advertiserId: '700', context, currency: 'USD', ads, dateFrom: '2026-03-01', dateTo: '2026-03-10', ...overrides });
  return { fake, tiktok, collect };
};

describe('buildAdIdsFilter', () => {
  it('encodes the id list as a JSON string, as the report API expects', () => {
    expect(buildAdIdsFilter(['1', '2'])).toEqual([{ field_name: 'ad_ids', filter_type: 'IN', filter_value: '["1","2"]' }]);
  });
});

describe('TikTokInsightsService', () => {
  it('does nothing without ads', async () => {
    const { tiktok, collect } = buildService();
    expect(await collect({ ads: [] })).toEqual([]);
    expect(tiktok.report).not.toHaveBeenCalled();
  });

  it('stores daily metrics and a range snapshot, then refreshes totals', async () => {
    const { fake, tiktok, collect } = buildService();
    tiktok.report.mockImplementation((_context, parameters: { dimensions: string[] }) =>
      Promise.resolve(parameters.dimensions.includes('stat_time_day')
        ? [dailyRow('1', '2026-03-01', '2.5'), dailyRow('2', '2026-03-02', '-'), dailyRow('999', '2026-03-02', '1')]
        : [{ dimensions: { ad_id: '1' }, metrics: { spend: '2.5', reach: '90' } }, { dimensions: { ad_id: '999' }, metrics: {} }]));
    const progress = jest.fn();

    expect(await collect({ onProgress: progress })).toEqual([]);

    const [dailyRows] = fake.argumentsOf('ad_daily_metrics', 'upsert') as [Record<string, unknown>[]];
    expect(dailyRows).toHaveLength(2);
    expect(dailyRows[0]).toMatchObject({ user_id: 'u1', ad_id: 'ad-uuid-1', date: '2026-03-01', currency: 'USD', spend: 2.5, impressions: 100, link_clicks: 5, purchases: null });
    expect(dailyRows[1]).toMatchObject({ ad_id: 'ad-uuid-2', spend: null });
    const [snapshotRows] = fake.argumentsOf('ad_insights', 'upsert') as [Record<string, unknown>[]];
    expect(snapshotRows).toHaveLength(1);
    expect(snapshotRows[0]).toMatchObject({ ad_id: 'ad-uuid-1', date_start: '2026-03-01', date_stop: '2026-03-10', reach: 90, revenue: null });
    expect(fake.argumentsOf('rpc:refresh_ad_totals', 'args')).toEqual([{ p_ad_ids: ['ad-uuid-1', 'ad-uuid-2'] }]);
    expect(progress.mock.calls.map((call) => call[2])).toEqual(['daily insights', 'range insights']);

    const daily = tiktok.report.mock.calls[0][1];
    expect(daily).toMatchObject({ advertiser_id: '700', dimensions: ['ad_id', 'stat_time_day'], start_date: '2026-03-01', end_date: '2026-03-10' });
    expect(daily.filtering[0].filter_value).toBe('["1","2"]');
  });

  it('splits long ranges into 30-day daily windows', async () => {
    const { tiktok, collect } = buildService();
    await collect({ dateFrom: '2026-03-01', dateTo: '2026-04-15' });
    const dailyWindows = tiktok.report.mock.calls.filter((call) => call[1].dimensions.includes('stat_time_day')).map((call) => [call[1].start_date, call[1].end_date]);
    expect(dailyWindows).toEqual([['2026-03-01', '2026-03-30'], ['2026-03-31', '2026-04-15']]);
  });

  it('keeps going after a non-fatal report failure', async () => {
    const { fake, tiktok, collect } = buildService();
    tiktok.report.mockRejectedValueOnce(new TikTokApiError('Invalid metrics', 200, 40_002)).mockResolvedValue([]);
    expect(await collect()).toEqual(['daily insights: Invalid metrics']);
    expect(fake.callsTo('rpc:refresh_ad_totals')).toHaveLength(1);
  });

  it('stringifies non-Error failures', async () => {
    const { tiktok, collect } = buildService();
    tiktok.report.mockRejectedValueOnce('boom').mockResolvedValue([]);
    expect(await collect()).toEqual(['daily insights: boom']);
  });

  it('throws on auth and permission failures', async () => {
    const { tiktok, collect } = buildService();
    tiktok.report.mockRejectedValue(new TikTokApiError('Access token is invalid', 200, 40_105));
    await expect(collect()).rejects.toMatchObject({ isAuth: true });
    tiktok.report.mockRejectedValue(new TikTokApiError('No permission', 403));
    await expect(collect()).rejects.toMatchObject({ isPermission: true });
  });
});
