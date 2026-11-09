import { NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { FakeSupabase } from '../testing/fake-supabase';
import { AnalyticsService } from './analytics.service';

const buildService = () => {
  const fake = new FakeSupabase();
  return { fake, service: new AnalyticsService(fake as unknown as SupabaseService) };
};

const dailyRow = (date: string, overrides: Record<string, unknown> = {}) => ({
  ad_id: 'ad-1', date, currency: 'USD', spend: '10', impressions: '1000', link_clicks: '20', purchases: '1', revenue: '30', ...overrides,
});

describe('AnalyticsService', () => {
  describe('adDashboard', () => {
    it('throws when the ad does not belong to the user', async () => {
      const { fake, service } = buildService();
      fake.respond('ads', { data: null });
      await expect(service.adDashboard('u1', 'ad-1')).rejects.toThrow(NotFoundException);
    });

    it('aggregates the daily rows in range and derives metrics', async () => {
      const { fake, service } = buildService();
      fake.respond('ads', { data: { id: 'ad-1', name: 'Ad', format: 'video', effective_status: 'ACTIVE' } });
      fake.respond('ad_daily_metrics', { data: [dailyRow('2026-01-01'), dailyRow('2026-01-02'), dailyRow('2026-01-03')] });
      fake.respond('ad_insights', { data: [{ date_start: '2026-01-01', date_stop: '2026-01-03', reach: '2500', quality_ranking: 'ABOVE_AVERAGE', collected_at: 't', currency: 'USD' }] });
      fake.respond('ad_breakdowns', { data: [] });
      const dashboard = await service.adDashboard('u1', 'ad-1', '2026-01-02', '2026-01-03');
      expect(dashboard.range).toMatchObject({ from: '2026-01-02', to: '2026-01-03', available_from: '2026-01-01', available_to: '2026-01-03', days_with_data: 2 });
      expect(dashboard.metrics.spend).toBe(20);
      expect(dashboard.metrics.ctr).toBeCloseTo(2);
      expect(dashboard.metrics.reach).toBeNull(); // selection does not cover all collected data
      expect(dashboard.reach_note).toContain('cannot be summed');
      expect(dashboard.rankings).toMatchObject({ quality: 'ABOVE_AVERAGE' });
      expect(dashboard.daily).toHaveLength(2);
      expect(dashboard.currency).toBe('USD');
    });

    it('uses the unique reach of a covering snapshot when the whole range is selected', async () => {
      const { fake, service } = buildService();
      fake.respond('ads', { data: { id: 'ad-1' } });
      fake.respond('ad_daily_metrics', { data: [dailyRow('2026-01-01'), dailyRow('2026-01-02')] });
      fake.respond('ad_insights', { data: [{ date_start: '2026-01-01', date_stop: '2026-01-02', reach: '1500', collected_at: 't' }] });
      const dashboard = await service.adDashboard('u1', 'ad-1');
      expect(dashboard.metrics.reach).toBe(1500);
      expect(dashboard.metrics.frequency).toBeCloseTo(2000 / 1500);
      expect(dashboard.reach_note).toBeNull();
    });

    it('handles an ad with no collected data', async () => {
      const { fake, service } = buildService();
      fake.respond('ads', { data: { id: 'ad-1' } });
      const dashboard = await service.adDashboard('u1', 'ad-1');
      expect(dashboard.range.days_with_data).toBe(0);
      expect(dashboard.metrics.spend).toBeNull();
      expect(dashboard.rankings).toBeNull();
      expect(dashboard.currency).toBeNull();
    });

    it('pages through PostgREST results beyond the row cap', async () => {
      const { fake, service } = buildService();
      fake.respond('ads', { data: { id: 'ad-1' } });
      const firstPage = Array.from({ length: 1000 }, (_unused, index) => dailyRow(`2025-01-${String((index % 28) + 1).padStart(2, '0')}`, { date: `d${index}` }));
      fake.respond('ad_daily_metrics', { data: firstPage });
      fake.respond('ad_daily_metrics', { data: [dailyRow('z-last')] });
      const dashboard = await service.adDashboard('u1', 'ad-1');
      const rangeCalls = fake.callsTo('ad_daily_metrics').flatMap((call) => call.operations.filter((operation) => operation.name === 'range'));
      expect(rangeCalls.map((operation) => operation.args)).toEqual([[0, 999], [1000, 1999]]);
      expect(dashboard.range.days_with_data).toBe(1001);
    });
  });

  describe('recalculate', () => {
    it('does nothing for an empty list', async () => {
      const { fake, service } = buildService();
      expect(await service.recalculate('u1', [])).toBe(0);
      expect(fake.calls).toHaveLength(0);
    });

    it('refreshes totals and caches lifetime analytics per ad', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_daily_metrics', { data: [dailyRow('2026-01-01'), dailyRow('2026-01-02'), dailyRow('2026-01-01', { ad_id: 'ad-2' })] });
      expect(await service.recalculate('u1', ['ad-1', 'ad-2'])).toBe(2);
      expect(fake.argumentsOf('rpc:refresh_ad_totals', 'args')).toEqual([{ p_ad_ids: ['ad-1', 'ad-2'] }]);
      const [records, options] = fake.argumentsOf('analytics', 'upsert') as [Record<string, unknown>[], Record<string, string>];
      expect(options).toEqual({ onConflict: 'ad_id,range_key' });
      expect(records.map((record) => record.ad_id)).toEqual(['ad-1', 'ad-2']);
      expect(records[0]).toMatchObject({ range_key: 'lifetime', date_from: '2026-01-01', date_to: '2026-01-02' });
      expect((records[0].metrics as Record<string, unknown>).spend).toBe(20);
    });

    it('caps a recalculation at 200 ads', async () => {
      const { fake, service } = buildService();
      await service.recalculate('u1', Array.from({ length: 250 }, (_unused, index) => `ad-${index}`));
      expect((fake.argumentsOf('rpc:refresh_ad_totals', 'args') as [{ p_ad_ids: string[] }])[0].p_ad_ids).toHaveLength(200);
    });
  });

  describe('countOwned', () => {
    it('counts the user rows with an optional equality filter', async () => {
      const { fake, service } = buildService();
      fake.respond('schedules', { count: 3 });
      expect(await service.countOwned('u1', 'schedules', { column: 'enabled', equals: true })).toMatchObject({ count: 3 });
      expect(fake.callsTo('schedules')[0].operations.map((operation) => [operation.name, operation.args])).toEqual([
        ['select', ['id', { count: 'exact', head: true }]], ['eq', ['user_id', 'u1']], ['eq', ['enabled', true]],
      ]);
    });
    it('supports membership filters', async () => {
      const { fake, service } = buildService();
      await service.countOwned('u1', 'collection_runs', { column: 'status', isIn: ['queued', 'running'] });
      expect(fake.argumentsOf('collection_runs', 'in')).toEqual(['status', ['queued', 'running']]);
    });
  });

  describe('overview', () => {
    it('assembles the dashboard from counts, runs, top ads and daily totals', async () => {
      const { fake, service } = buildService();
      fake.respond('ads', { count: 12, data: [{ id: 'a' }] });
      fake.respond('saved_searches', { count: 2 });
      fake.respond('schedules', { count: 1 });
      fake.respond('collection_runs', { count: 0, data: [] });
      fake.respond('rpc:daily_totals', { data: [{ date: '2026-03-01', spend: '10', impressions: '1000', link_clicks: '20', purchases: null, revenue: null }] });
      const overview = await service.overview('u1');
      expect(overview.totals).toMatchObject({ ads: 12, saved_searches: 2, scheduled_searches: 1 });
      expect(overview.activity).toHaveLength(14);
      expect(overview.performance[0]).toMatchObject({ date: '2026-03-01', spend: 10, ctr: 2 });
      expect(overview.recent_ads).toEqual([{ id: 'a' }]);
    });
  });
});
