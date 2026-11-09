import { aggregate, BASE_KEYS, BaseMetrics, DailyRow, derive, DerivedMetrics, NullableNumber } from './metrics';

type RawRow = Record<string, unknown>;

export const toNullableNumber = (value: unknown): NullableNumber =>
  value === null || value === undefined ? null : Number(value);

/** Converts a stored daily-metrics row (numeric columns may be strings) to a DailyRow. */
export function normalizeDailyRow(rawRow: RawRow): DailyRow {
  const metrics = Object.fromEntries(BASE_KEYS.map((key) => [key, toNullableNumber(rawRow[key])]));
  return { date: String(rawRow.date), ...metrics };
}

export interface SnapshotRow {
  date_start: string;
  date_stop: string;
  reach: unknown;
}

/**
 * Unique reach is not additive: only trust a snapshot whose range covers all collected data while
 * the selected range also covers it.
 */
export function selectReachSnapshot(
  snapshots: SnapshotRow[],
  firstDataDate: string | null,
  lastDataDate: string | null,
  selectedFrom?: string,
  selectedTo?: string,
): SnapshotRow | undefined {
  if (firstDataDate === null || lastDataDate === null) return undefined;
  if ((selectedFrom && selectedFrom > firstDataDate) || (selectedTo && selectedTo < lastDataDate)) return undefined;
  return snapshots.find(
    (snapshot) => snapshot.date_start <= firstDataDate && snapshot.date_stop >= lastDataDate && snapshot.reach !== null,
  );
}

export interface BreakdownRow extends RawRow {
  breakdown_type: string;
  dim_key: string;
  dimensions: unknown;
  date_start: string;
  date_stop: string;
}

export interface BreakdownGroup {
  date_start: string;
  date_stop: string;
  rows: (BaseMetrics & DerivedMetrics & { dim_key: string; dimensions: unknown })[];
}

/** Latest-collected breakdown set per type (rows arrive newest first), with derived metrics, sorted by spend. */
export function groupBreakdowns(rows: BreakdownRow[]): Record<string, BreakdownGroup> {
  const groups: Record<string, BreakdownGroup> = {};
  for (const row of rows) {
    const group = groups[row.breakdown_type] ?? (groups[row.breakdown_type] = { date_start: row.date_start, date_stop: row.date_stop, rows: [] });
    if (row.date_start !== group.date_start || row.date_stop !== group.date_stop) continue;
    const base = aggregate([normalizeDailyRow({ ...row, date: row.date_start })], toNullableNumber(row.reach));
    group.rows.push({ dim_key: row.dim_key, dimensions: row.dimensions, ...base, ...derive(base) });
  }
  for (const group of Object.values(groups)) group.rows.sort((left, right) => (right.spend ?? 0) - (left.spend ?? 0));
  return groups;
}

export interface ActivityDay {
  date: string;
  runs: number;
  failed: number;
  ads_found: number;
}

/** Zero-filled per-day run counts for the last `days` days ending at `now`. */
export function buildActivitySeries(
  runs: { created_at: string; status: string; counters?: { ads_found?: number } | null }[],
  days: number,
  now: Date = new Date(),
): ActivityDay[] {
  const byDate = new Map<string, ActivityDay>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    byDate.set(date, { date, runs: 0, failed: 0, ads_found: 0 });
  }
  for (const run of runs) {
    const day = byDate.get(run.created_at.slice(0, 10));
    if (!day) continue;
    day.runs++;
    if (run.status === 'failed') day.failed++;
    day.ads_found += Number(run.counters?.ads_found ?? 0);
  }
  return [...byDate.values()];
}

export interface AdTotalsRow {
  id: string;
  name: string | null;
  format: string | null;
  total_spend: unknown;
  total_impressions: unknown;
  total_link_clicks: unknown;
  total_purchases: unknown;
  total_revenue: unknown;
}

const MINIMUM_IMPRESSIONS_TO_RANK = 1000;

/** Best ROAS first (where revenue exists), then best CTR; tiny-sample ads are excluded. */
export function rankTopAds(rows: AdTotalsRow[], limit = 5) {
  return rows
    .map((row) => {
      const base = aggregate([
        {
          date: 'lifetime',
          spend: Number(row.total_spend),
          impressions: Number(row.total_impressions),
          link_clicks: Number(row.total_link_clicks),
          purchases: Number(row.total_purchases),
          revenue: Number(row.total_revenue),
        },
      ]);
      return { id: row.id, name: row.name, format: row.format, spend: base.spend, impressions: base.impressions, ...derive(base) };
    })
    .filter((ad) => (ad.impressions ?? 0) >= MINIMUM_IMPRESSIONS_TO_RANK)
    .sort((left, right) => (right.roas ?? -1) - (left.roas ?? -1) || (right.ctr ?? -1) - (left.ctr ?? -1))
    .slice(0, limit);
}
