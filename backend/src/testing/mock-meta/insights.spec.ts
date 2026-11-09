import { buildInsightRows, dailyNumbers, daysInRange, rangeTotals } from './insights';

describe('daysInRange', () => {
  it('lists every day inclusive', () => expect(daysInRange('2026-01-30', '2026-02-02')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']));
  it('is a single day for equal bounds', () => expect(daysInRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']));
  it('is empty when until precedes since', () => expect(daysInRange('2026-03-02', '2026-03-01')).toEqual([]));
});

describe('dailyNumbers', () => {
  it('makes ad_1 CTR decline over time but never below the floor', () => {
    expect(dailyNumbers('ad_1', 0).linkClicks).toBe(60);
    expect(dailyNumbers('ad_1', 10).linkClicks).toBe(40);
    expect(dailyNumbers('ad_1', 100).linkClicks).toBe(5);
  });
  it('keeps the other ads flat', () => {
    expect(dailyNumbers('ad_2', 0).linkClicks).toBe(dailyNumbers('ad_2', 20).linkClicks);
    expect(dailyNumbers('ad_2', 0).spend).toBe(15);
  });
  it('only gives ad_1 video views', () => {
    expect(dailyNumbers('ad_1', 0).videoViews).toBe(400);
    expect(dailyNumbers('ad_2', 0).videoViews).toBe(0);
  });
});

describe('rangeTotals', () => {
  it('sums the daily numbers over the range', () => {
    const totals = rangeTotals('ad_2', '2026-03-01', '2026-03-10');
    expect(totals).toMatchObject({ spend: 150, impressions: 11_000, linkClicks: 350, purchases: 20, revenue: 700 });
  });
});

describe('buildInsightRows', () => {
  const base = { adIds: ['ad_1', 'ad_2'], since: '2026-03-01', until: '2026-03-05' };

  it('returns one row per ad per day for time_increment=1, as strings like the real API', () => {
    const rows = buildInsightRows({ ...base, timeIncrement: 1 });
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ ad_id: 'ad_1', date_start: '2026-03-01', spend: '10.00', impressions: '1000', inline_link_clicks: '60', account_currency: 'USD' });
    expect(rows[0].video_thruplay_watched_actions).toBeDefined();
    expect(rows[5].video_thruplay_watched_actions).toBeUndefined();
  });

  it('returns one range row per ad with unique reach, frequency and rankings', () => {
    const rows = buildInsightRows(base);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date_start: '2026-03-01', date_stop: '2026-03-05', reach: '4000', quality_ranking: 'ABOVE_AVERAGE' });
    expect(Number(rows[0].frequency)).toBeCloseTo(1.25);
  });

  it('splits totals across breakdown segments that sum back to the total', () => {
    const rows = buildInsightRows({ adIds: ['ad_2'], since: '2026-03-01', until: '2026-03-02', breakdowns: 'age,gender' });
    expect(rows.map((row) => `${row.age}|${row.gender}`)).toEqual(['25-34|female', '35-44|male', '18-24|female']);
    expect(rows.reduce((sum, row) => sum + Number(row.spend), 0)).toBeCloseTo(30);
  });

  it.each(['country', 'publisher_platform,platform_position', 'impression_device'])('supports the %s breakdown', (breakdowns) => {
    expect(buildInsightRows({ adIds: ['ad_1'], since: '2026-03-01', until: '2026-03-01', breakdowns }).length).toBeGreaterThan(1);
  });

  it('serves creative asset breakdowns only for the dynamic ad', () => {
    expect(buildInsightRows({ adIds: ['ad_1', 'ad_2'], since: '2026-03-01', until: '2026-03-01', breakdowns: 'image_asset' })).toEqual([]);
    const rows = buildInsightRows({ adIds: ['ad_3'], since: '2026-03-01', until: '2026-03-01', breakdowns: 'image_asset' });
    expect(rows).toHaveLength(2);
    expect(rows[0].image_asset).toEqual({ hash: 'h3a', url: 'https://example.test/h3a.jpg' });
  });

  it('ignores unknown ads and unknown breakdowns', () => {
    expect(buildInsightRows({ adIds: ['nope'], since: '2026-03-01', until: '2026-03-01' })).toEqual([]);
    expect(buildInsightRows({ adIds: ['ad_1'], since: '2026-03-01', until: '2026-03-01', breakdowns: 'mystery' })).toEqual([]);
  });
});
