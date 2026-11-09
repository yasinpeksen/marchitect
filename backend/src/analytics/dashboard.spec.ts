import { buildActivitySeries, BreakdownRow, groupBreakdowns, normalizeDailyRow, rankTopAds, selectReachSnapshot, toNullableNumber } from './dashboard';

describe('toNullableNumber', () => {
  it('converts numeric strings', () => expect(toNullableNumber('3.5')).toBe(3.5));
  it('keeps null and undefined as null', () => {
    expect(toNullableNumber(null)).toBeNull();
    expect(toNullableNumber(undefined)).toBeNull();
  });
});

describe('normalizeDailyRow', () => {
  it('converts every base metric to number-or-null and keeps the date', () => {
    const row = normalizeDailyRow({ date: '2026-01-01', spend: '10.50', impressions: 100, purchases: null });
    expect(row).toMatchObject({ date: '2026-01-01', spend: 10.5, impressions: 100, purchases: null, revenue: null });
  });
});

describe('selectReachSnapshot', () => {
  const snapshots = [
    { date_start: '2026-01-01', date_stop: '2026-01-31', reach: 500 },
    { date_start: '2026-01-10', date_stop: '2026-01-20', reach: 100 },
  ];
  it('picks the newest snapshot covering all collected data', () => {
    expect(selectReachSnapshot(snapshots, '2026-01-05', '2026-01-25')?.reach).toBe(500);
  });
  it('requires the selected range to cover the collected data', () => {
    expect(selectReachSnapshot(snapshots, '2026-01-05', '2026-01-25', '2026-01-10')).toBeUndefined();
    expect(selectReachSnapshot(snapshots, '2026-01-05', '2026-01-25', undefined, '2026-01-20')).toBeUndefined();
  });
  it('returns undefined without data or when no snapshot covers the data', () => {
    expect(selectReachSnapshot(snapshots, null, null)).toBeUndefined();
    expect(selectReachSnapshot(snapshots, '2025-12-01', '2026-01-25')).toBeUndefined();
  });
  it('skips snapshots without reach', () => {
    expect(selectReachSnapshot([{ date_start: '2026-01-01', date_stop: '2026-01-31', reach: null }], '2026-01-05', '2026-01-25')).toBeUndefined();
  });
});

describe('groupBreakdowns', () => {
  const row = (overrides: Partial<BreakdownRow>): BreakdownRow => ({
    breakdown_type: 'country', dim_key: 'US', dimensions: { country: 'US' }, date_start: '2026-02-01', date_stop: '2026-02-28',
    spend: 10, impressions: 1000, link_clicks: 20, ...overrides,
  });

  it('groups by type and sorts segments by spend', () => {
    const groups = groupBreakdowns([row({ dim_key: 'CA', spend: 5 }), row({ dim_key: 'US', spend: 50 }), row({ breakdown_type: 'device', dim_key: 'phone' })]);
    expect(groups.country.rows.map((entry) => entry.dim_key)).toEqual(['US', 'CA']);
    expect(groups.device.rows).toHaveLength(1);
    expect(groups.country.rows[0].ctr).toBeCloseTo(2);
    expect(groups.country.rows[0].cpm).toBeCloseTo(50);
  });

  it('keeps only the newest collected range per type (rows arrive newest first)', () => {
    const groups = groupBreakdowns([row({ dim_key: 'NEW' }), row({ dim_key: 'OLD', date_start: '2026-01-01', date_stop: '2026-01-31' })]);
    expect(groups.country.rows.map((entry) => entry.dim_key)).toEqual(['NEW']);
    expect(groups.country.date_start).toBe('2026-02-01');
  });

  it('returns an empty object for no rows', () => expect(groupBreakdowns([])).toEqual({}));
});

describe('buildActivitySeries', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  it('zero-fills the window and counts runs, failures and ads found', () => {
    const series = buildActivitySeries(
      [
        { created_at: '2026-03-10T08:00:00Z', status: 'succeeded', counters: { ads_found: 4 } },
        { created_at: '2026-03-10T09:00:00Z', status: 'failed', counters: null },
        { created_at: '2026-03-09T09:00:00Z', status: 'partial' },
        { created_at: '2025-01-01T00:00:00Z', status: 'succeeded' },
      ],
      3,
      now,
    );
    expect(series).toEqual([
      { date: '2026-03-08', runs: 0, failed: 0, ads_found: 0 },
      { date: '2026-03-09', runs: 1, failed: 0, ads_found: 0 },
      { date: '2026-03-10', runs: 2, failed: 1, ads_found: 4 },
    ]);
  });
});

describe('rankTopAds', () => {
  const ad = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, name: id, format: 'image', total_spend: 100, total_impressions: 10_000, total_link_clicks: 100, total_purchases: 0, total_revenue: 0, ...overrides,
  });

  it('ranks by ROAS first, then CTR', () => {
    const ranked = rankTopAds([
      ad('low-ctr', { total_link_clicks: 50 }),
      ad('high-ctr', { total_link_clicks: 300 }),
      ad('roas', { total_revenue: 400, total_purchases: 4 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(['roas', 'high-ctr', 'low-ctr']);
    expect(ranked[0].roas).toBeCloseTo(4);
  });

  it('drops ads below the minimum sample size', () => {
    expect(rankTopAds([ad('tiny', { total_impressions: 999 })])).toEqual([]);
  });

  it('respects the limit', () => {
    expect(rankTopAds([ad('a'), ad('b'), ad('c')], 2)).toHaveLength(2);
  });
});
