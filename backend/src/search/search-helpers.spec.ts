import { BadRequestException } from '@nestjs/common';
import { buildSearchFilters, dedupeByKeywordSet, MAXIMUM_RANGE_DAYS, resolveCollectionRange } from './search-helpers';

describe('buildSearchFilters', () => {
  it('keeps only provided filter fields', () => {
    expect(buildSearchFilters({ keywords: ['a'], sort: 'spend', formats: ['video'], min_spend: 0, ad_account_id: 'acc' })).toEqual({
      formats: ['video'], min_spend: 0, ad_account_id: 'acc',
    });
  });
  it('returns an empty object when nothing is filtered', () => expect(buildSearchFilters({ keywords: ['a'] })).toEqual({}));
});

describe('resolveCollectionRange', () => {
  const today = new Date('2026-03-31T10:00:00Z');
  it('defaults to the lookback window ending today', () => {
    expect(resolveCollectionRange(undefined, undefined, 30, today)).toEqual({ dateFrom: '2026-03-02', dateTo: '2026-03-31' });
  });
  it('uses explicit dates', () => {
    expect(resolveCollectionRange('2026-01-01', '2026-01-31', 30, today)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  });
  it('rejects an inverted range', () => {
    expect(() => resolveCollectionRange('2026-02-01', '2026-01-01', 30, today)).toThrow(BadRequestException);
  });
  it('rejects a range longer than the insights retention', () => {
    const tooFar = new Date(Date.parse('2026-03-31') - (MAXIMUM_RANGE_DAYS + 5) * 86_400_000).toISOString().slice(0, 10);
    expect(() => resolveCollectionRange(tooFar, '2026-03-31', 30, today)).toThrow('37 months');
  });
});

describe('dedupeByKeywordSet', () => {
  it('keeps the first (newest) row of each distinct keyword set, ignoring order', () => {
    const rows = [
      { keywords: ['a', 'b'], id: 1 }, { keywords: ['b', 'a'], id: 2 }, { keywords: ['c'], id: 3 }, { keywords: ['a'], id: 4 },
    ];
    expect(dedupeByKeywordSet(rows).map((row) => row.id)).toEqual([1, 3, 4]);
  });
  it('applies the limit', () => {
    expect(dedupeByKeywordSet([{ keywords: ['a'] }, { keywords: ['b'] }, { keywords: ['c'] }], 2)).toHaveLength(2);
  });
});
