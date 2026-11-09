import { buildQueryString } from './api';
import { daysAgoIso, todayIso } from './format';

export interface AdFilters {
  formats: string[];
  statuses: string[];
  platforms: string[];
  campaignIds: string[];
  dateFrom: string;
  dateTo: string;
  minSpend: string;
  minCtr: string;
  minRoas: string;
}

export const EMPTY_FILTERS: AdFilters = {
  formats: [], statuses: [], platforms: [], campaignIds: [], dateFrom: '', dateTo: '', minSpend: '', minCtr: '', minRoas: '',
};

export interface AdsQueryInput {
  keywords: string[];
  match: 'any' | 'all';
  filters: AdFilters;
  accountId: string;
  sort: string;
  direction: 'asc' | 'desc';
  page: number;
  pageSize?: number;
}

/** `/ads?...` URL for the instant search; blank filters are omitted. */
export function buildAdsQuery(input: AdsQueryInput): string {
  const { filters } = input;
  return `/ads${buildQueryString({
    keywords: input.keywords,
    match: input.match,
    formats: filters.formats,
    statuses: filters.statuses,
    platforms: filters.platforms,
    campaign_ids: filters.campaignIds,
    ad_account_id: input.accountId || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    min_spend: filters.minSpend || undefined,
    min_ctr: filters.minCtr || undefined,
    min_roas: filters.minRoas || undefined,
    sort: input.sort,
    dir: input.direction,
    page: input.page,
    page_size: input.pageSize ?? 24,
  })}`;
}

/** Insights window for a "last N days" collection ending today. */
export function collectionRangeFor(lookbackDays: number, now: Date = new Date()): { dateFrom: string; dateTo: string } {
  return { dateFrom: daysAgoIso(lookbackDays - 1, now), dateTo: todayIso(now) };
}

/** Adds the value when absent, removes it when present. */
export const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((existing) => existing !== value) : [...values, value];

/** Parses `?q=a,b` into keywords. */
export const parseKeywordParameter = (value: string | null): string[] => (value ?? '').split(',').filter(Boolean);
