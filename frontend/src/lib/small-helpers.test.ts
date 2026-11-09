import { afterEach, describe, expect, it, vi } from 'vitest';
import { describePermissions, readOAuthResult } from './connections';
import { hasRunDetails, runDurationSeconds, summarizeRunCounters } from './runs';
import { savedSearchHref } from './saved-searches';
import { browserTimezone, listTimezones } from './timezones';

describe('runDurationSeconds', () => {
  it('is the whole seconds between start and finish', () => {
    expect(runDurationSeconds({ started_at: '2026-03-01T10:00:00Z', finished_at: '2026-03-01T10:01:30.400Z' })).toBe(90);
  });
  it('is null until both timestamps exist', () => {
    expect(runDurationSeconds({ started_at: null, finished_at: null })).toBeNull();
    expect(runDurationSeconds({ started_at: '2026-03-01T10:00:00Z', finished_at: null })).toBeNull();
  });
});

describe('hasRunDetails', () => {
  it('is true for a run error or recorded errors', () => {
    expect(hasRunDetails({ error: 'boom', errors: [] })).toBe(true);
    expect(hasRunDetails({ error: null, errors: [{ message: 'x' }] })).toBe(true);
  });
  it('is false for a clean run', () => expect(hasRunDetails({ error: null, errors: [] })).toBe(false));
});

describe('summarizeRunCounters', () => {
  it('summarises found and new ads', () => expect(summarizeRunCounters({ ads_found: 12, ads_new: 3 })).toBe('12 found · 3 new'));
  it('defaults new to 0', () => expect(summarizeRunCounters({ ads_found: 5 })).toBe('5 found · 0 new'));
  it('is a dash without counters', () => expect(summarizeRunCounters({})).toBe('—'));
});

describe('savedSearchHref', () => {
  it('opens the search with keywords, match mode and account', () => {
    expect(savedSearchHref({ tags: ['a b', 'c'], match_mode: 'all', ad_account_id: 'acc' })).toBe('/search?q=a%20b%2Cc&match=all&account=acc');
  });
  it('omits the account when none is set', () => {
    expect(savedSearchHref({ tags: ['a'], match_mode: 'any', ad_account_id: null })).toBe('/search?q=a&match=any');
  });
});

describe('describePermissions', () => {
  it('lists scopes', () => expect(describePermissions({ scopes: ['ads_read', 'business_management'] })).toBe('ads_read, business_management'));
  it.each([null, []])('reports "not reported" for %p', (scopes) => expect(describePermissions({ scopes })).toBe('not reported'));
});

describe('readOAuthResult', () => {
  it('reads a success flag', () => expect(readOAuthResult(new URLSearchParams('connected=1'))).toEqual({ message: 'Meta account connected.' }));
  it('reads an error (which wins)', () => expect(readOAuthResult(new URLSearchParams('connected=1&error=denied'))).toEqual({ error: 'denied' }));
  it('is empty otherwise', () => expect(readOAuthResult(new URLSearchParams(''))).toEqual({}));
});

describe('timezones', () => {
  afterEach(() => vi.restoreAllMocks());
  it('lists IANA zones', () => expect(listTimezones()).toContain('Europe/Berlin'));
  it('falls back to UTC when the engine cannot list zones', () => {
    const original = (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf;
    (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = undefined;
    expect(listTimezones()).toEqual(['UTC']);
    (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = original;
  });
  it('reads the browser timezone', () => expect(browserTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
  it('falls back to UTC when the browser reports none', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ timeZone: '' }) } as never);
    expect(browserTimezone()).toBe('UTC');
  });
});
