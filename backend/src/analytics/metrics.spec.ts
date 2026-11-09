import { aggregate, DailyRow, derive, divide, fatigue, leastSquaresSlope, series, sumNullable } from './metrics';

const buildDays = (count: number, ctrForDay: (dayIndex: number) => number): DailyRow[] =>
  Array.from({ length: count }, (_unused, dayIndex) => ({
    date: `2026-01-${String(dayIndex + 1).padStart(2, '0')}`,
    impressions: 1000,
    link_clicks: Math.round(ctrForDay(dayIndex) * 10),
  }));

describe('divide', () => {
  it('divides numbers', () => expect(divide(10, 4)).toBe(2.5));
  it('keeps a zero numerator', () => expect(divide(0, 5)).toBe(0));
  it('returns null for a zero denominator', () => expect(divide(5, 0)).toBeNull());
  it.each([[null, 5], [5, null], [undefined, 5], [5, undefined]])('returns null when an operand is missing (%s, %s)', (numerator, denominator) => {
    expect(divide(numerator as number | null | undefined, denominator as number | null | undefined)).toBeNull();
  });
});

describe('sumNullable', () => {
  it('sums present values and ignores missing ones', () => expect(sumNullable([1, null, 2, undefined])).toBe(3));
  it('returns null when everything is missing (never 0)', () => expect(sumNullable([null, undefined])).toBeNull());
  it('treats an explicit zero as present', () => expect(sumNullable([0, null])).toBe(0));
});

describe('aggregate', () => {
  it('sums additive metrics across days', () => {
    const totals = aggregate([{ date: 'a', spend: 10, impressions: 100 }, { date: 'b', spend: 5, impressions: 50 }]);
    expect(totals.spend).toBe(15);
    expect(totals.impressions).toBe(150);
    expect(totals.purchases).toBeNull();
  });

  it('does not sum reach across days, but accepts a true unique reach', () => {
    const rows = [{ date: 'a', reach: 5 }, { date: 'b', reach: 5 }];
    expect(aggregate(rows).reach).toBeNull();
    expect(aggregate(rows, 8).reach).toBe(8);
  });

  it('weights average watch time by 3-second views', () => {
    const totals = aggregate([
      { date: 'a', avg_watch_seconds: 10, video_3s_views: 100 },
      { date: 'b', avg_watch_seconds: 4, video_3s_views: 300 },
    ]);
    expect(totals.avg_watch_seconds).toBeCloseTo(5.5);
  });

  it('falls back to impressions as the weight and returns null without any watch time', () => {
    expect(aggregate([{ date: 'a', avg_watch_seconds: 6, impressions: 10 }]).avg_watch_seconds).toBe(6);
    expect(aggregate([{ date: 'a', impressions: 10 }]).avg_watch_seconds).toBeNull();
  });
});

describe('derive', () => {
  const totals = aggregate(
    [{
      date: '2026-01-01', spend: 100, impressions: 20_000, link_clicks: 400, outbound_clicks: 200, installs: 50, registrations: 10, trials: 5,
      purchases: 5, revenue: 350, video_3s_views: 8000, video_thruplays: 2000, video_p25: 6000, video_p50: 4000, video_p75: 3000, video_p100: 1000,
    }],
    10_000,
  );
  const derived = derive(totals);

  it('applies the documented formulas', () => {
    expect(derived.cpm).toBeCloseTo(5);
    expect(derived.ctr).toBeCloseTo(2);
    expect(derived.cpc).toBeCloseTo(0.25);
    expect(derived.outbound_ctr).toBeCloseTo(1);
    expect(derived.cpi).toBeCloseTo(2);
    expect(derived.ipm).toBeCloseTo(2.5);
    expect(derived.cost_per_registration).toBeCloseTo(10);
    expect(derived.cost_per_trial).toBeCloseTo(20);
    expect(derived.cpa).toBeCloseTo(20);
    expect(derived.roas).toBeCloseTo(3.5);
    expect(derived.hook_rate).toBeCloseTo(40);
    expect(derived.hold_rate).toBeCloseTo(25);
    expect(derived.frequency).toBeCloseTo(2);
  });

  it('computes quartile completion against 3-second viewers', () => {
    expect(derived.completion_25).toBeCloseTo(75);
    expect(derived.completion_50).toBeCloseTo(50);
    expect(derived.completion_75).toBeCloseTo(37.5);
    expect(derived.completion_100).toBeCloseTo(12.5);
  });

  it('never invents missing metrics or divides by zero', () => {
    const empty = derive(aggregate([{ date: '2026-01-01', spend: 10, impressions: 0 }]));
    expect(empty.cpm).toBeNull();
    expect(empty.ctr).toBeNull();
    expect(empty.roas).toBeNull();
    expect(empty.hook_rate).toBeNull();
  });
});

describe('leastSquaresSlope', () => {
  it('returns the slope of a straight line', () => expect(leastSquaresSlope([1, 3, 5, 7])).toBeCloseTo(2));
  it('is zero for a flat line', () => expect(leastSquaresSlope([4, 4, 4])).toBeCloseTo(0));
  it('is negative for a decline', () => expect(leastSquaresSlope([9, 6, 3])).toBeLessThan(0));
  it('needs at least two points', () => {
    expect(leastSquaresSlope([])).toBeNull();
    expect(leastSquaresSlope([1])).toBeNull();
  });
});

describe('fatigue', () => {
  it('needs 14 days with delivery', () => expect(fatigue(buildDays(10, () => 2)).status).toBe('insufficient_data'));

  it('flags a strong CTR decline', () => {
    const report = fatigue(buildDays(20, (dayIndex) => 3 - dayIndex * 0.1));
    expect(report.status).toBe('high');
    expect(report.ctr_drop_pct).toBeGreaterThan(30);
    expect(report.ctr_ratio).toBeLessThan(1);
    expect(report.ctr_trend_per_day).toBeLessThan(0);
  });

  it('flags a moderate decline', () => {
    const report = fatigue(buildDays(20, (dayIndex) => 3 - dayIndex * 0.06));
    expect(report.status).toBe('moderate');
  });

  it('is stable for flat CTR', () => expect(fatigue(buildDays(20, () => 2)).status).toBe('none'));

  it('ignores days without impressions', () => {
    const rows = [...buildDays(14, () => 2), { date: '2026-02-01', impressions: 0, link_clicks: 0 }];
    expect(fatigue(rows).days_with_data).toBe(14);
  });
});

describe('series', () => {
  it('sorts by date and adds derived metrics per day', () => {
    const points = series([{ date: '2026-01-02', spend: 5, impressions: 100 }, ...buildDays(1, () => 2)]);
    expect(points.map((point) => point.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(points[0].ctr).toBeCloseTo(2);
    expect(points[1].cpm).toBeCloseTo(50);
  });
});
