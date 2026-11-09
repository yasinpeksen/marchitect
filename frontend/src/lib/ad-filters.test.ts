import { describe, expect, it } from 'vitest';
import { buildAdsQuery, collectionRangeFor, EMPTY_FILTERS, parseKeywordParameter, toggleValue } from './ad-filters';

const base = { keywords: [], match: 'any' as const, filters: EMPTY_FILTERS, accountId: '', sort: 'recent', direction: 'desc' as const, page: 1 };

describe('buildAdsQuery', () => {
  it('always sends match, sort, direction and paging, and omits blank filters', () => {
    expect(buildAdsQuery(base)).toBe('/ads?match=any&sort=recent&dir=desc&page=1&page_size=24');
  });
  it('includes keywords, filters and the account', () => {
    const query = buildAdsQuery({
      ...base, keywords: ['summer', 'sale'], accountId: 'acc-1', page: 3,
      filters: { ...EMPTY_FILTERS, formats: ['video'], statuses: ['ACTIVE'], platforms: ['instagram'], campaignIds: ['c1'], dateFrom: '2026-01-01', dateTo: '2026-02-01', minSpend: '10', minCtr: '1.5', minRoas: '2' },
    });
    const parameters = new URLSearchParams(query.split('?')[1]);
    expect(parameters.get('keywords')).toBe('summer,sale');
    expect(parameters.get('formats')).toBe('video');
    expect(parameters.get('statuses')).toBe('ACTIVE');
    expect(parameters.get('platforms')).toBe('instagram');
    expect(parameters.get('campaign_ids')).toBe('c1');
    expect(parameters.get('ad_account_id')).toBe('acc-1');
    expect(parameters.get('date_from')).toBe('2026-01-01');
    expect(parameters.get('min_spend')).toBe('10');
    expect(parameters.get('min_ctr')).toBe('1.5');
    expect(parameters.get('min_roas')).toBe('2');
    expect(parameters.get('page')).toBe('3');
  });
  it('honours a custom page size', () => expect(buildAdsQuery({ ...base, pageSize: 50 })).toContain('page_size=50'));
});

describe('collectionRangeFor', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  it('covers the last N days ending today', () => expect(collectionRangeFor(30, now)).toEqual({ dateFrom: '2026-02-09', dateTo: '2026-03-10' }));
  it('is a single day for 1', () => expect(collectionRangeFor(1, now)).toEqual({ dateFrom: '2026-03-10', dateTo: '2026-03-10' }));
});

describe('toggleValue', () => {
  it('adds a missing value', () => expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']));
  it('removes an existing value', () => expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']));
});

describe('parseKeywordParameter', () => {
  it('splits a comma list', () => expect(parseKeywordParameter('a,b,,c')).toEqual(['a', 'b', 'c']));
  it('handles null', () => expect(parseKeywordParameter(null)).toEqual([]));
});
