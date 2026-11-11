import { AppConfig } from '../common/app-config';
import { SupabaseService } from '../common/supabase.service';
import { MetaApiClient, MetaApiError } from '../meta/meta-api.client';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import {
  AD_LIBRARY_ACCESS_URL, AdLibraryCollectorService, buildLibraryAdRow, describeLibraryFailure, isLibraryAdId, mergeCollectResults, rememberLibraryEntries,
} from './ad-library-collector.service';

const context = { token: 'EAAtoken' };
const account = { id: 'acc-1' };

describe('library id helpers', () => {
  it('recognises prefixed ids only', () => {
    expect(isLibraryAdId('adlib:123')).toBe(true);
    expect(isLibraryAdId('123')).toBe(false);
  });
});

describe('describeLibraryFailure', () => {
  it('explains how to get access when Meta refuses (error 10)', () => {
    const message = describeLibraryFailure(new MetaApiError('To access the API, you will need to follow the steps', 400, 10));
    expect(message).toContain('access not granted');
    expect(message).toContain(AD_LIBRARY_ACCESS_URL);
  });
  it('treats other permission errors the same way', () => {
    expect(describeLibraryFailure(new MetaApiError('(#200) denied', 403, 200))).toContain(AD_LIBRARY_ACCESS_URL);
  });
  it('passes other failures through', () => {
    expect(describeLibraryFailure(new MetaApiError('Service busy', 500, 2))).toBe('Meta Ad Library: Service busy');
    expect(describeLibraryFailure('boom')).toBe('Meta Ad Library: boom');
  });
});

describe('mergeCollectResults', () => {
  it('concatenates ads and errors and ORs truncated', () => {
    const ad = (id: string) => ({ id, meta_ad_id: id, creative_id: null, is_new: true, is_dynamic: false, keywords: ['a'] });
    expect(mergeCollectResults({ ads: [ad('1')], errors: ['x'], truncated: false }, { ads: [ad('2')], errors: ['y'], truncated: true })).toEqual({
      ads: [ad('1'), ad('2')], errors: ['x', 'y'], truncated: true,
    });
  });
});

describe('rememberLibraryEntries', () => {
  it('tags repeated entries with every keyword and respects the cap', () => {
    const found = new Map<string, { entry: { id: string }; keywords: Set<string> }>();
    expect(rememberLibraryEntries(found, [{ id: '1' }, { id: '2' }], 'a', 2)).toBe(false);
    expect(rememberLibraryEntries(found, [{ id: '1' }, { id: '3' }], 'b', 2)).toBe(true);
    expect([...found].map(([id, value]) => [id, [...value.keywords]])).toEqual([['1', ['a', 'b']], ['2', ['a']]]);
  });
});

describe('buildLibraryAdRow', () => {
  const base = { userId: 'u1', accountId: 'acc-1', collectedAt: '2026-03-01T00:00:00Z' };

  it('maps an active library ad and makes the advertiser searchable', () => {
    const entry = {
      id: '99', page_name: 'Competitor Shoes', ad_creation_time: '2026-02-10', ad_creative_bodies: ['Buy running shoes now'], ad_creative_link_titles: ['Run faster'],
      publisher_platforms: ['FACEBOOK', 'INSTAGRAM'],
    };
    expect(buildLibraryAdRow(entry, base)).toMatchObject({
      user_id: 'u1', ad_account_id: 'acc-1', platform: 'meta', meta_ad_id: 'adlib:99', name: 'Competitor Shoes', campaign_name: 'Competitor Shoes', headline: 'Run faster',
      primary_text: 'Buy running shoes now', platforms: ['facebook', 'instagram'], status: 'ACTIVE', effective_status: 'ACTIVE', ad_created_time: '2026-02-10', raw: entry,
    });
  });
  it('marks stopped ads inactive and tolerates missing fields', () => {
    expect(buildLibraryAdRow({ id: '5', ad_delivery_stop_time: '2026-02-20', ad_delivery_start_time: '2026-02-01' }, base)).toMatchObject({
      name: 'Library ad 5', status: 'INACTIVE', platforms: [], campaign_name: null, headline: null, primary_text: null, ad_created_time: '2026-02-01',
    });
  });
});

const buildCollector = () => {
  const fake = new FakeSupabase();
  const meta = { listAdLibrary: jest.fn().mockResolvedValue([]) };
  const collector = new AdLibraryCollectorService(fake as unknown as SupabaseService, meta as unknown as MetaApiClient, buildTestConfig({ adLibraryCountries: ['DE', 'GB'], maxAdsPerRun: 2 }) as unknown as AppConfig);
  return { fake, meta, collector };
};

describe('AdLibraryCollectorService', () => {
  it('searches the library per keyword across the configured countries and stores the matches', async () => {
    const { fake, meta, collector } = buildCollector();
    meta.listAdLibrary.mockImplementation((_context, parameters: { search_terms: string }) =>
      Promise.resolve(parameters.search_terms === 'running' ? [{ id: '1', page_name: 'Shoes' }, { id: '2', page_name: 'More shoes' }] : [{ id: '1', page_name: 'Shoes' }]));
    fake.respond('ads', { data: [{ meta_ad_id: 'adlib:2' }] });
    fake.respond('ads', { data: [{ id: 'uuid-1', meta_ad_id: 'adlib:1' }, { id: 'uuid-2', meta_ad_id: 'adlib:2' }] });

    const result = await collector.collect({ userId: 'u1', account, context, keywords: ['Running', 'shoes'] });

    expect(result.errors).toEqual([]);
    expect(result.ads).toEqual([
      { id: 'uuid-1', meta_ad_id: 'adlib:1', creative_id: null, is_new: true, is_dynamic: false, keywords: ['running', 'shoes'] },
      { id: 'uuid-2', meta_ad_id: 'adlib:2', creative_id: null, is_new: false, is_dynamic: false, keywords: ['running'] },
    ]);
    expect(meta.listAdLibrary).toHaveBeenCalledWith(context, expect.objectContaining({ search_terms: 'running', ad_reached_countries: ['DE', 'GB'], ad_active_status: 'ALL' }), 2);
    const [rows] = fake.argumentsOf('ads', 'upsert') as [Record<string, unknown>[]];
    expect(rows.map((row) => row.meta_ad_id)).toEqual(['adlib:1', 'adlib:2']);
  });

  it('returns nothing without touching the database when the library has no match', async () => {
    const { fake, collector } = buildCollector();
    expect(await collector.collect({ userId: 'u1', account, context, keywords: ['zzz'] })).toEqual({ ads: [], errors: [], truncated: false });
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps the run alive and explains when Meta has not granted Ad Library access', async () => {
    const { meta, collector } = buildCollector();
    meta.listAdLibrary.mockRejectedValue(new MetaApiError('To access the API, you will need to follow the steps', 400, 10));
    const result = await collector.collect({ userId: 'u1', account, context, keywords: ['motivation'] });
    expect(result.ads).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(AD_LIBRARY_ACCESS_URL);
  });

  it('caps the stored ads at MAX_ADS_PER_RUN', async () => {
    const { fake, meta, collector } = buildCollector();
    meta.listAdLibrary.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
    fake.respond('ads', { data: [] });
    fake.respond('ads', { data: [{ id: 'u1', meta_ad_id: 'adlib:1' }, { id: 'u2', meta_ad_id: 'adlib:2' }] });
    const result = await collector.collect({ userId: 'u1', account, context, keywords: ['x1'] });
    expect(result.truncated).toBe(true);
    expect(result.ads).toHaveLength(2);
  });
});
