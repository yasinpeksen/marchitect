import { BadRequestException } from '@nestjs/common';
import { AdQueryDto } from './search.dto';

/** Meta keeps roughly 37 months of insights. */
export const MAXIMUM_RANGE_DAYS = 37 * 30;

const FILTER_KEYS = [
  'date_from', 'date_to', 'ad_account_id', 'campaign_ids', 'formats', 'platforms', 'statuses',
  'min_spend', 'min_impressions', 'min_ctr', 'min_roas',
] as const;

/** Only the filter fields that were actually provided, in the shape the `search_ads` SQL function expects. */
export function buildSearchFilters(query: AdQueryDto): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) if (query[key] !== undefined) filters[key] = query[key];
  return filters;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Validates and defaults the insights date range of a collection (default: last `lookbackDays` days). */
export function resolveCollectionRange(
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  lookbackDays: number,
  today: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const dateTo = requestedTo ?? isoDay(today);
  const dateFrom = requestedFrom ?? isoDay(new Date(Date.parse(dateTo) - (lookbackDays - 1) * 86_400_000));
  if (dateFrom > dateTo) throw new BadRequestException('date_from must be on or before date_to');
  if ((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 > MAXIMUM_RANGE_DAYS) {
    throw new BadRequestException('Date range exceeds the 37 months Meta retains for insights');
  }
  return { dateFrom, dateTo };
}

/** Newest-first rows reduced to one entry per distinct keyword set. */
export function dedupeByKeywordSet<Row extends { keywords: string[] }>(rows: Row[], limit = 15): Row[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const signature = [...row.keywords].sort().join('|');
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, limit);
}
