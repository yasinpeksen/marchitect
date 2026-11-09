import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { SupabaseService } from '../common/supabase.service';
import { QueueService } from '../jobs/queues';
import { MediaService } from '../media/media.service';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import { CollectionRunsService } from './collection-runs.service';
import { SearchService } from './search.service';

const buildService = () => {
  const fake = new FakeSupabase();
  const runs = { findActive: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'run-1' }) };
  const queues = { enqueueCollection: jest.fn() };
  const media = { mediaForAds: jest.fn().mockResolvedValue(new Map()) };
  const audit = { record: jest.fn() };
  const service = new SearchService(
    fake as unknown as SupabaseService, runs as unknown as CollectionRunsService, queues as unknown as QueueService,
    media as unknown as MediaService, buildTestConfig() as unknown as AppConfig, audit as unknown as AuditService,
  );
  return { fake, runs, queues, media, audit, service };
};

describe('SearchService', () => {
  describe('instant', () => {
    it('queries the indexed SQL function with normalised keywords, filters and paging', async () => {
      const { fake, media, service } = buildService();
      fake.respond('rpc:search_ads', { data: [{ ad: { id: 'a1', name: 'Ad' }, total_count: 51 }] });
      media.mediaForAds.mockResolvedValue(new Map([['a1', [{ kind: 'thumbnail', status: 'stored', error: null, url: 'https://signed' }]]]));
      const result = await service.instant('u1', { keywords: ['  Summer  '], match: 'all', formats: ['video'], sort: 'ctr', dir: 'asc', page: 3, page_size: 10 });
      expect(fake.argumentsOf('rpc:search_ads', 'args')).toEqual([{
        p_user_id: 'u1', p_keywords: ['summer'], p_match: 'all', p_filters: { formats: ['video'] }, p_sort: 'ctr', p_dir: 'asc', p_limit: 10, p_offset: 20,
      }]);
      expect(result).toMatchObject({ total: 51, page: 3, page_size: 10 });
      expect(result.items[0]).toMatchObject({ id: 'a1', media: [{ kind: 'thumbnail', url: 'https://signed' }] });
    });

    it('uses defaults and reports zero results', async () => {
      const { fake, service } = buildService();
      fake.respond('rpc:search_ads', { data: [] });
      const result = await service.instant('u1', {});
      expect(result).toEqual({ items: [], total: 0, page: 1, page_size: 24 });
      expect(fake.argumentsOf('rpc:search_ads', 'args')?.[0]).toMatchObject({ p_match: 'any', p_sort: 'recent', p_dir: 'desc', p_offset: 0 });
    });

    it('surfaces database errors', async () => {
      const { fake, service } = buildService();
      fake.respond('rpc:search_ads', { error: { message: 'rpc failed' } });
      await expect(service.instant('u1', {})).rejects.toThrow('search ads: rpc failed');
    });
  });

  describe('startCollection', () => {
    const body = { keywords: ['Summer', 'summer', 'sale'], ad_account_id: 'acc-1' };
    const withAccount = (selected = true) => {
      const context = buildService();
      context.fake.respond('ad_accounts', { data: { id: 'acc-1', selected } });
      context.fake.respond('rpc:search_ads', { data: [{ ad: { id: 'x' }, total_count: 4 }] });
      return context;
    };

    it('validates, creates a run, enqueues it and records usage', async () => {
      const { fake, runs, queues, audit, service } = withAccount();
      const result = await service.startCollection('u1', body);
      expect(result).toEqual({ run: { id: 'run-1' }, existing_matches: 4, reused: false });
      expect(runs.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', adAccountId: 'acc-1', keywords: ['summer', 'sale'], trigger: 'manual' }));
      expect(queues.enqueueCollection).toHaveBeenCalledWith({ runId: 'run-1', userId: 'u1' });
      expect(audit.record).toHaveBeenCalledWith('u1', 'collection.start', 'collection_run', 'run-1', { keywords: ['summer', 'sale'] });
      const tags = fake.argumentsOf('search_tags', 'upsert') as [Record<string, unknown>[]];
      expect(tags[0].map((tag) => tag.tag)).toEqual(['summer', 'sale']);
    });

    it('reuses an identical in-flight run instead of starting another', async () => {
      const { runs, queues, service } = withAccount();
      runs.findActive.mockResolvedValue({ id: 'active-1' });
      expect(await service.startCollection('u1', body)).toMatchObject({ run: { id: 'active-1' }, reused: true });
      expect(queues.enqueueCollection).not.toHaveBeenCalled();
    });

    it('stamps the saved search with the run time', async () => {
      const { fake, service } = withAccount();
      await service.startCollection('u1', { ...body, saved_search_id: 'saved-1' });
      expect(fake.argumentsOf('saved_searches', 'update')?.[0]).toEqual({ last_run_at: expect.any(String) });
    });

    it('increments the usage count of existing tags', async () => {
      const { fake, service } = withAccount();
      fake.respond('search_tags', { data: [{ tag: 'summer', usage_count: 4 }] });
      await service.startCollection('u1', body);
      const records = (fake.argumentsOf('search_tags', 'upsert') as [Record<string, unknown>[]])[0];
      expect(records.find((record) => record.tag === 'summer')?.usage_count).toBe(5);
      expect(records.find((record) => record.tag === 'sale')?.usage_count).toBe(1);
    });

    it.each([[[''], 'Enter at least one keyword'], [['a'], 'at least 2 characters']])('rejects bad keywords %p', async (keywords, message) => {
      const { service } = buildService();
      await expect(service.startCollection('u1', { keywords, ad_account_id: 'acc-1' })).rejects.toThrow(message);
    });

    it('rejects an unknown or disabled ad account', async () => {
      const unknown = buildService();
      unknown.fake.respond('ad_accounts', { data: null });
      await expect(unknown.service.startCollection('u1', body)).rejects.toThrow(NotFoundException);
      await expect(withAccount(false).service.startCollection('u1', body)).rejects.toThrow(BadRequestException);
    });

    it('rejects an inverted date range', async () => {
      await expect(withAccount().service.startCollection('u1', { ...body, date_from: '2026-02-01', date_to: '2026-01-01' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('tags and history', () => {
    it('suggests tags by usage, optionally by prefix without LIKE wildcards', async () => {
      const { fake, service } = buildService();
      fake.respond('search_tags', { data: [{ tag: 'summer', usage_count: 2 }] });
      expect(await service.tagSuggestions('u1', ' su%m_ ')).toEqual([{ tag: 'summer', usage_count: 2 }]);
      expect(fake.argumentsOf('search_tags', 'ilike')).toEqual(['tag', 'sum%']);
      await service.tagSuggestions('u1');
      expect(fake.callsTo('search_tags')[1].operations.some((operation) => operation.name === 'ilike')).toBe(false);
    });

    it('returns distinct previous searches', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: [{ keywords: ['a'] }, { keywords: ['a'] }, { keywords: ['b'] }] });
      expect(await service.history('u1')).toEqual([{ keywords: ['a'] }, { keywords: ['b'] }]);
    });
  });

  describe('saved searches', () => {
    it('lists and creates normalised saved searches', async () => {
      const { fake, service } = buildService();
      fake.respond('saved_searches', { data: [{ id: 's1' }] });
      expect(await service.listSaved('u1')).toEqual([{ id: 's1' }]);
      await service.createSaved('u1', { name: '  Name ', tags: ['A', 'a', 'B'], ad_account_id: 'acc' });
      expect(fake.argumentsOf('saved_searches', 'insert')).toEqual([{ user_id: 'u1', name: 'Name', tags: ['a', 'b'], match_mode: 'any', filters: {}, ad_account_id: 'acc' }]);
    });

    it('updates, trimming the name and normalising tags', async () => {
      const { fake, service } = buildService();
      fake.respond('saved_searches', { data: [{ id: 's1' }] });
      expect(await service.updateSaved('u1', 's1', { name: ' New ', tags: ['X', 'x'] })).toEqual({ id: 's1' });
      expect(fake.argumentsOf('saved_searches', 'update')).toEqual([{ name: 'New', tags: ['x'] }]);
    });

    it.each(['updateSaved', 'deleteSaved'] as const)('%s throws NotFound for missing rows', async (method) => {
      const { service } = buildService();
      await expect(method === 'updateSaved' ? service.updateSaved('u1', 'x', {}) : service.deleteSaved('u1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('deletes a saved search', async () => {
      const { fake, service } = buildService();
      fake.respond('saved_searches', { data: [{ id: 's1' }] });
      await expect(service.deleteSaved('u1', 's1')).resolves.toBeUndefined();
    });

    it('runs a saved search through the collection flow', async () => {
      const { fake, queues, service } = buildService();
      fake.respond('saved_searches', { data: { id: 's1', tags: ['summer'], match_mode: 'any', ad_account_id: 'acc-1' } });
      fake.respond('ad_accounts', { data: { id: 'acc-1', selected: true } });
      fake.respond('rpc:search_ads', { data: [] });
      expect(await service.runSaved('u1', 's1')).toMatchObject({ reused: false });
      expect(queues.enqueueCollection).toHaveBeenCalled();
    });

    it('refuses to run a missing saved search or one without an account', async () => {
      const missing = buildService();
      missing.fake.respond('saved_searches', { data: null });
      await expect(missing.service.runSaved('u1', 's1')).rejects.toThrow(NotFoundException);
      const noAccount = buildService();
      noAccount.fake.respond('saved_searches', { data: { id: 's1', tags: ['a'], ad_account_id: null } });
      await expect(noAccount.service.runSaved('u1', 's1')).rejects.toThrow('no ad account');
    });
  });
});
