import { AppConfig } from '../common/app-config';
import { SupabaseService } from '../common/supabase.service';
import { MetaApiClient, MetaApiError } from '../meta/meta-api.client';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import {
  BREAKDOWNS, buildBreakdownDimension, daysBetweenInclusive, groupAdsByPlatformSet, InsightsService, pickMetrics,
} from './insights.service';

describe('insights helpers', () => {
  it('pickMetrics returns only the requested keys', () => {
    expect(pickMetrics({ spend: 1, impressions: 2 } as never, ['spend'])).toEqual({ spend: 1 });
  });

  it('daysBetweenInclusive counts both ends', () => {
    expect(daysBetweenInclusive('2026-01-01', '2026-01-01')).toBe(1);
    expect(daysBetweenInclusive('2026-01-01', '2026-01-31')).toBe(31);
  });

  describe('buildBreakdownDimension', () => {
    it('joins simple dimensions into a stable key', () => {
      expect(buildBreakdownDimension({ age: '25-34', gender: 'female' }, ['age', 'gender'])).toEqual({
        dimKey: '25-34|female', dimensions: { age: '25-34', gender: 'female' },
      });
    });
    it('uses asset ids, hashes or urls for creative asset breakdowns', () => {
      expect(buildBreakdownDimension({ image_asset: { hash: 'h1', url: 'u' } }, ['image_asset']).dimKey).toBe('h1');
      expect(buildBreakdownDimension({ body_asset: { id: '9', text: 't' } }, ['body_asset']).dimKey).toBe('9');
      expect(buildBreakdownDimension({ link_url_asset: { url: 'https://x' } }, ['link_url_asset']).dimKey).toBe('https://x');
      expect(buildBreakdownDimension({ title_asset: { other: 1 } }, ['title_asset']).dimKey).toBe('{"other":1}');
    });
    it('marks missing dimension values as unknown', () => {
      expect(buildBreakdownDimension({}, ['country']).dimKey).toBe('unknown');
    });
  });

  it('groupAdsByPlatformSet groups ads sharing the same platforms regardless of order', () => {
    const groups = groupAdsByPlatformSet(new Map([
      ['a', new Set(['instagram', 'facebook'])], ['b', new Set(['facebook', 'instagram'])], ['c', new Set(['messenger'])],
    ]));
    expect(Object.fromEntries(groups)).toEqual({ 'facebook,instagram': ['a', 'b'], messenger: ['c'] });
  });

  it('defines placement, device, geography and the seven creative asset breakdowns', () => {
    expect(BREAKDOWNS.map((breakdown) => breakdown.type)).toEqual(expect.arrayContaining(['age_gender', 'country', 'placement', 'device', 'image_asset', 'video_asset', 'call_to_action_asset']));
    expect(BREAKDOWNS.filter((breakdown) => breakdown.dynamicOnly)).toHaveLength(7);
  });
});

const ads = [
  { id: 'ad-uuid-1', meta_ad_id: 'm1', is_dynamic: false },
  { id: 'ad-uuid-2', meta_ad_id: 'm2', is_dynamic: true },
];

const buildService = (configOverrides: Record<string, unknown> = {}) => {
  const fake = new FakeSupabase();
  const meta = { insights: jest.fn().mockResolvedValue([]), insightsAsync: jest.fn().mockResolvedValue([]) };
  const service = new InsightsService(fake as unknown as SupabaseService, meta as unknown as MetaApiClient, buildTestConfig(configOverrides) as unknown as AppConfig);
  const input = { userId: 'u1', metaAccountId: 'act_1', context: { token: 'EAAx' }, ads, dateFrom: '2026-03-01', dateTo: '2026-03-10' };
  return { fake, meta, service, input };
};

describe('InsightsService', () => {
  it('chooses async reports for long ranges or many ads', () => {
    const { service } = buildService();
    expect(service.shouldUseAsyncReports('2026-01-01', '2026-01-30', 5)).toBe(false);
    expect(service.shouldUseAsyncReports('2026-01-01', '2026-02-01', 5)).toBe(true);
    expect(service.shouldUseAsyncReports('2026-01-01', '2026-01-10', 100)).toBe(true);
  });

  it('loads ads with their dynamic-creative flag', async () => {
    const { fake, service } = buildService();
    fake.respond('ads', { data: [{ id: 'a', meta_ad_id: 'm', ad_creatives: { asset_feed_spec: { titles: [] } } }, { id: 'b', meta_ad_id: 'n', ad_creatives: null }] });
    expect(await service.loadInsightAds('u1', ['a', 'b'])).toEqual([{ id: 'a', meta_ad_id: 'm', is_dynamic: true }, { id: 'b', meta_ad_id: 'n', is_dynamic: false }]);
  });

  describe('collect', () => {
    it('returns immediately without ads', async () => {
      const { fake, service, input } = buildService();
      expect(await service.collect({ ...input, ads: [] })).toEqual([]);
      expect(fake.calls).toHaveLength(0);
    });

    it('stores daily metrics, the range snapshot and breakdowns, then refreshes totals', async () => {
      const { fake, meta, service, input } = buildService();
      const progress = jest.fn();
      meta.insights.mockImplementation((_context: unknown, _account: string, parameters: Record<string, unknown>) => {
        if (parameters.time_increment === 1) {
          return Promise.resolve([{ ad_id: 'm1', date_start: '2026-03-01', spend: '5', impressions: '100', account_currency: 'USD', actions: [{ action_type: 'omni_purchase', value: '2' }] }]);
        }
        if (parameters.breakdowns === 'country') return Promise.resolve([{ ad_id: 'm1', country: 'US', spend: '5', impressions: '100' }]);
        if (parameters.breakdowns === 'publisher_platform,platform_position') {
          return Promise.resolve([{ ad_id: 'm1', publisher_platform: 'instagram', platform_position: 'story' }, { ad_id: 'm1', publisher_platform: 'facebook', platform_position: 'feed' }]);
        }
        if (parameters.breakdowns) return Promise.resolve([]);
        return Promise.resolve([{ ad_id: 'm1', date_start: '2026-03-01', date_stop: '2026-03-10', reach: '90', frequency: '1.1', quality_ranking: 'AVERAGE', spend: '5', impressions: '100' }, { ad_id: 'unknown', spend: '1' }]);
      });
      const errors = await service.collect({ ...input, onProgress: progress });
      expect(errors).toEqual([]);

      const daily = (fake.argumentsOf('ad_daily_metrics', 'upsert') as [Record<string, unknown>[], Record<string, string>]);
      expect(daily[0][0]).toMatchObject({ user_id: 'u1', ad_id: 'ad-uuid-1', date: '2026-03-01', currency: 'USD', spend: 5, purchases: 2, link_clicks: null });
      expect(daily[1]).toEqual({ onConflict: 'ad_id,date' });

      const snapshot = (fake.argumentsOf('ad_insights', 'upsert') as [Record<string, unknown>[]])[0];
      expect(snapshot).toHaveLength(1); // the unknown ad is ignored
      expect(snapshot[0]).toMatchObject({ ad_id: 'ad-uuid-1', reach: 90, frequency: 1.1, quality_ranking: 'AVERAGE', date_start: '2026-03-01', date_stop: '2026-03-10' });

      const breakdownRows = fake.callsTo('ad_breakdowns').flatMap((call) => call.operations).filter((operation) => operation.name === 'upsert').flatMap((operation) => operation.args[0] as Record<string, unknown>[]);
      expect(breakdownRows.find((row) => row.breakdown_type === 'country')).toMatchObject({ dim_key: 'US', dimensions: { country: 'US' }, date_start: '2026-03-01', spend: 5 });
      expect(breakdownRows.filter((row) => row.breakdown_type === 'placement')).toHaveLength(2);

      expect(fake.callsTo('ads').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0]).toEqual({ platforms: ['facebook', 'instagram'] });
      expect(fake.argumentsOf('rpc:refresh_ad_totals', 'args')).toEqual([{ p_ad_ids: ['ad-uuid-1', 'ad-uuid-2'] }]);
      expect(progress).toHaveBeenCalledTimes(2 + BREAKDOWNS.length);
      expect(progress).toHaveBeenLastCalledWith(2 + BREAKDOWNS.length, 2 + BREAKDOWNS.length, expect.any(String));
    });

    it('only requests dynamic-creative asset breakdowns for dynamic ads', async () => {
      const { meta, service, input } = buildService();
      await service.collect(input);
      const assetCalls = meta.insights.mock.calls.filter((call) => String(call[2].breakdowns).endsWith('_asset'));
      expect(assetCalls).toHaveLength(7);
      for (const call of assetCalls) {
        expect(call[2].filtering[0].value).toEqual(['m2']);
      }
      const skipped = await buildService().service.collect({ ...input, ads: [ads[0]] });
      expect(skipped).toEqual([]);
    });

    it('uses async reports and larger batches for long ranges', async () => {
      const { meta, service, input } = buildService();
      await service.collect({ ...input, dateFrom: '2026-01-01', dateTo: '2026-03-10' });
      expect(meta.insightsAsync).toHaveBeenCalled();
      expect(meta.insights).not.toHaveBeenCalled();
      expect(meta.insightsAsync.mock.calls[0][3]).toBe(1000);
    });

    it('batches ad ids per request (50 for sync reports)', async () => {
      const { meta, service, input } = buildService({ asyncInsightsMinAds: 1000 });
      const manyAds = Array.from({ length: 120 }, (_unused, index) => ({ id: `u${index}`, meta_ad_id: `m${index}`, is_dynamic: false }));
      await service.collect({ ...input, ads: manyAds, dateFrom: '2026-03-01', dateTo: '2026-03-02' });
      const dailyBatchSizes = meta.insights.mock.calls.filter((call) => call[2].time_increment === 1).map((call) => call[2].filtering[0].value.length);
      expect(dailyBatchSizes).toEqual([50, 50, 20]);
    });

    it('collects non-fatal failures as errors and carries on', async () => {
      const { fake, meta, service, input } = buildService();
      meta.insights.mockImplementation((_context: unknown, _account: string, parameters: Record<string, unknown>) =>
        parameters.breakdowns === 'impression_device' ? Promise.reject(new Error('device breakdown unsupported')) : Promise.resolve([]));
      const errors = await service.collect(input);
      expect(errors).toEqual(['breakdown device: device breakdown unsupported']);
      expect(fake.callsTo('rpc:refresh_ad_totals')).toHaveLength(1);
    });

    it.each([[new MetaApiError('expired', 401, 190)], [new MetaApiError('denied', 403, 200)]])('aborts on fatal Meta error %p', async (error) => {
      const { meta, service, input } = buildService();
      meta.insights.mockRejectedValue(error);
      await expect(service.collect(input)).rejects.toBe(error);
    });
  });
});
