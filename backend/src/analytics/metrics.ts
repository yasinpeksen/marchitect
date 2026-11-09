/**
 * Pure analytics engine. No I/O. A missing metric is `null` and is never invented or coerced to 0;
 * any ratio with a null/zero denominator or null numerator is `null`.
 */

export type NullableNumber = number | null;

export interface BaseMetrics {
  spend: NullableNumber;
  impressions: NullableNumber;
  reach: NullableNumber;
  clicks: NullableNumber;
  link_clicks: NullableNumber;
  outbound_clicks: NullableNumber;
  installs: NullableNumber;
  registrations: NullableNumber;
  trials: NullableNumber;
  purchases: NullableNumber;
  revenue: NullableNumber;
  video_3s_views: NullableNumber;
  video_thruplays: NullableNumber;
  video_p25: NullableNumber;
  video_p50: NullableNumber;
  video_p75: NullableNumber;
  video_p100: NullableNumber;
  avg_watch_seconds: NullableNumber;
}

export const BASE_KEYS: (keyof BaseMetrics)[] = [
  'spend', 'impressions', 'reach', 'clicks', 'link_clicks', 'outbound_clicks', 'installs',
  'registrations', 'trials', 'purchases', 'revenue', 'video_3s_views', 'video_thruplays',
  'video_p25', 'video_p50', 'video_p75', 'video_p100', 'avg_watch_seconds',
];

/** Additive over days. `reach` is NOT (unique people) and `avg_watch_seconds` is weighted. */
const ADDITIVE_KEYS = BASE_KEYS.filter((key) => key !== 'reach' && key !== 'avg_watch_seconds');

export interface DailyRow extends Partial<BaseMetrics> {
  date: string; // YYYY-MM-DD
}

/** numerator / denominator, or `null` when either side is missing or the denominator is zero. */
export const divide = (numerator: NullableNumber | undefined, denominator: NullableNumber | undefined): NullableNumber =>
  numerator === null || numerator === undefined || denominator === null || denominator === undefined || denominator === 0
    ? null
    : numerator / denominator;

const multiply = (value: NullableNumber, factor: number): NullableNumber => (value === null ? null : value * factor);

/** Sum of the present values; `null` when every value is missing. */
export const sumNullable = (values: (NullableNumber | undefined)[]): NullableNumber => {
  let anyPresent = false;
  let total = 0;
  for (const value of values) {
    if (value !== null && value !== undefined) {
      anyPresent = true;
      total += Number(value);
    }
  }
  return anyPresent ? total : null;
};

/**
 * Aggregate daily rows. `reach` stays null unless the caller supplies a true unique-reach
 * for exactly this range (summing daily reach would overcount people).
 */
export function aggregate(rows: DailyRow[], reach: NullableNumber = null): BaseMetrics {
  const result = Object.fromEntries(BASE_KEYS.map((key) => [key, null])) as unknown as BaseMetrics;
  for (const key of ADDITIVE_KEYS) result[key] = sumNullable(rows.map((row) => row[key]));

  // Weighted mean of average watch time, weighted by 3s views (fallback: impressions).
  let weightedSum = 0;
  let totalWeight = 0;
  for (const row of rows) {
    if (row.avg_watch_seconds === null || row.avg_watch_seconds === undefined) continue;
    const weight = row.video_3s_views ?? row.impressions ?? 0;
    weightedSum += row.avg_watch_seconds * weight;
    totalWeight += weight;
  }
  result.avg_watch_seconds = totalWeight > 0 ? weightedSum / totalWeight : null;
  result.reach = reach;
  return result;
}

export interface DerivedMetrics {
  cpm: NullableNumber;
  ctr: NullableNumber;
  cpc: NullableNumber;
  frequency: NullableNumber;
  outbound_ctr: NullableNumber;
  cpi: NullableNumber;
  ipm: NullableNumber;
  cost_per_registration: NullableNumber;
  cost_per_trial: NullableNumber;
  cpa: NullableNumber;
  roas: NullableNumber;
  hook_rate: NullableNumber;
  hold_rate: NullableNumber;
  completion_25: NullableNumber;
  completion_50: NullableNumber;
  completion_75: NullableNumber;
  completion_100: NullableNumber;
}

export function derive(metrics: BaseMetrics): DerivedMetrics {
  return {
    cpm: multiply(divide(metrics.spend, metrics.impressions), 1000), // spend / impressions * 1000
    ctr: multiply(divide(metrics.link_clicks, metrics.impressions), 100), // link clicks / impressions * 100
    cpc: divide(metrics.spend, metrics.link_clicks),
    frequency: divide(metrics.impressions, metrics.reach),
    outbound_ctr: multiply(divide(metrics.outbound_clicks, metrics.impressions), 100),
    cpi: divide(metrics.spend, metrics.installs),
    ipm: multiply(divide(metrics.installs, metrics.impressions), 1000),
    cost_per_registration: divide(metrics.spend, metrics.registrations),
    cost_per_trial: divide(metrics.spend, metrics.trials),
    cpa: divide(metrics.spend, metrics.purchases),
    roas: divide(metrics.revenue, metrics.spend),
    hook_rate: multiply(divide(metrics.video_3s_views, metrics.impressions), 100), // 3s views / impressions * 100
    hold_rate: multiply(divide(metrics.video_thruplays, metrics.video_3s_views), 100), // thruplay / 3s views * 100
    // Completion = share of 3-second viewers (people who started watching) reaching each quartile.
    completion_25: multiply(divide(metrics.video_p25, metrics.video_3s_views), 100),
    completion_50: multiply(divide(metrics.video_p50, metrics.video_3s_views), 100),
    completion_75: multiply(divide(metrics.video_p75, metrics.video_3s_views), 100),
    completion_100: multiply(divide(metrics.video_p100, metrics.video_3s_views), 100),
  };
}

export type FatigueLevel = 'insufficient_data' | 'none' | 'moderate' | 'high';

export interface Fatigue {
  status: FatigueLevel;
  days_with_data: number;
  first_7d_ctr: NullableNumber;
  last_7d_ctr: NullableNumber;
  /** (first - last) / first * 100. Positive = CTR declined. */
  ctr_drop_pct: NullableNumber;
  /** last / first. */
  ctr_ratio: NullableNumber;
  /** Least-squares slope of daily CTR (percentage points per day). */
  ctr_trend_per_day: NullableNumber;
}

const MINIMUM_FATIGUE_DAYS = 14;

/** Slope of the least-squares line through `values` (x = position). `null` for fewer than 2 points. */
export function leastSquaresSlope(values: number[]): NullableNumber {
  const count = values.length;
  if (count < 2) return null;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((total, value) => total + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (const [position, value] of values.entries()) {
    numerator += (position - meanX) * (value - meanY);
    denominator += (position - meanX) ** 2;
  }
  return denominator === 0 ? null : numerator / denominator;
}

export function fatigue(rows: DailyRow[]): Fatigue {
  const daysWithDelivery = rows
    .filter((row) => (row.impressions ?? 0) > 0 && row.link_clicks !== null && row.link_clicks !== undefined)
    .sort((left, right) => left.date.localeCompare(right.date));
  const insufficient: Fatigue = {
    status: 'insufficient_data',
    days_with_data: daysWithDelivery.length,
    first_7d_ctr: null,
    last_7d_ctr: null,
    ctr_drop_pct: null,
    ctr_ratio: null,
    ctr_trend_per_day: null,
  };
  if (daysWithDelivery.length < MINIMUM_FATIGUE_DAYS) return insufficient;

  const ctrOf = (dayRows: DailyRow[]) => derive(aggregate(dayRows)).ctr;
  const firstWeekCtr = ctrOf(daysWithDelivery.slice(0, 7));
  const lastWeekCtr = ctrOf(daysWithDelivery.slice(-7));
  const dropPercent = firstWeekCtr === null || lastWeekCtr === null || firstWeekCtr === 0
    ? null
    : ((firstWeekCtr - lastWeekCtr) / firstWeekCtr) * 100;
  const dailyCtrValues = daysWithDelivery.map((day) => ((day.link_clicks as number) / (day.impressions as number)) * 100);

  let status: FatigueLevel = 'insufficient_data';
  if (dropPercent !== null) status = dropPercent >= 30 ? 'high' : (dropPercent >= 15 ? 'moderate' : 'none');
  return {
    status,
    days_with_data: daysWithDelivery.length,
    first_7d_ctr: firstWeekCtr,
    last_7d_ctr: lastWeekCtr,
    ctr_drop_pct: dropPercent,
    ctr_ratio: divide(lastWeekCtr, firstWeekCtr),
    ctr_trend_per_day: leastSquaresSlope(dailyCtrValues),
  };
}

/** Per-day series with derived metrics, for charts. */
export function series(rows: DailyRow[]) {
  return [...rows]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => {
      const base = aggregate([row], row.reach ?? null);
      return { date: row.date, ...base, ...derive(base) };
    });
}
