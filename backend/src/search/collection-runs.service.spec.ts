import { NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FakeSupabase } from '../testing/fake-supabase';
import { CollectionRunsService } from './collection-runs.service';

const buildService = () => {
  const fake = new FakeSupabase();
  const notifications = { notify: jest.fn() };
  return { fake, notifications, service: new CollectionRunsService(fake as unknown as SupabaseService, notifications as unknown as NotificationsService) };
};

describe('CollectionRunsService', () => {
  it('creates a queued run', async () => {
    const { fake, service } = buildService();
    fake.respond('collection_runs', { data: { id: 'run-1' } });
    const run = await service.create({ userId: 'u1', adAccountId: 'acc', keywords: ['a'], dateFrom: '2026-01-01', dateTo: '2026-01-31', trigger: 'manual' });
    expect(run).toEqual({ id: 'run-1' });
    expect(fake.argumentsOf('collection_runs', 'insert')).toEqual([
      expect.objectContaining({ user_id: 'u1', ad_account_id: 'acc', keywords: ['a'], trigger: 'manual', saved_search_id: null, schedule_id: null, stage: 'queued' }),
    ]);
  });

  describe('platformOfAccount', () => {
    it('reads the platform of the account', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_accounts', { data: { platform: 'tiktok' } });
      expect(await service.platformOfAccount('u1', 'acc')).toBe('tiktok');
    });
    it('defaults to meta when the account is unknown, so the Meta path reports it', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_accounts', { data: null });
      expect(await service.platformOfAccount('u1', 'acc')).toBe('meta');
    });
  });

  describe('findActive', () => {
    it('returns an in-flight run with exactly the same keywords', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: [{ id: 'superset', keywords: ['a', 'b'] }, { id: 'same', keywords: ['a'] }] });
      expect((await service.findActive('u1', 'acc', ['a']))?.id).toBe('same');
      expect(fake.argumentsOf('collection_runs', 'in')).toEqual(['status', ['queued', 'running']]);
    });
    it('returns null when none match', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: [{ id: 'superset', keywords: ['a', 'b'] }] });
      expect(await service.findActive('u1', 'acc', ['a'])).toBeNull();
    });
  });

  it('updates a run and surfaces errors', async () => {
    const { fake, service } = buildService();
    await service.update('run-1', { progress: 50 });
    expect(fake.argumentsOf('collection_runs', 'update')).toEqual([{ progress: 50 }]);
    fake.respond('collection_runs', { error: { message: 'boom' } });
    await expect(service.update('run-1', {})).rejects.toThrow('update run: boom');
  });

  describe('get', () => {
    it('returns the run scoped to the user', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: { id: 'run-1' } });
      expect(await service.get('u1', 'run-1')).toEqual({ id: 'run-1' });
      expect(fake.callsTo('collection_runs')[0].operations).toContainEqual({ name: 'eq', args: ['user_id', 'u1'] });
    });
    it('throws NotFound for someone else’s or a missing run', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: null });
      await expect(service.get('u1', 'run-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('pages the runs and reports the total', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: [{ id: 'a' }], count: 41 });
      expect(await service.list('u1', 10, 20)).toEqual({ items: [{ id: 'a' }], total: 41 });
      expect(fake.argumentsOf('collection_runs', 'range')).toEqual([20, 29]);
    });
    it('filters by status', async () => {
      const { fake, service } = buildService();
      await service.list('u1', 10, 0, 'failed');
      expect(fake.argumentsOf('collection_runs', 'eq')).toEqual(['user_id', 'u1']);
      expect(fake.callsTo('collection_runs')[0].operations).toContainEqual({ name: 'eq', args: ['status', 'failed'] });
    });
  });

  it('saves search results in batches, idempotently', async () => {
    const { fake, service } = buildService();
    const matches = Array.from({ length: 1200 }, (_unused, index) => ({ adId: `ad-${index}`, keyword: 'k', isNew: index % 2 === 0 }));
    await service.saveSearchResults('u1', 'run-1', matches);
    expect(fake.callsTo('search_results')).toHaveLength(3);
    const [firstBatch, options] = fake.argumentsOf('search_results', 'upsert') as [Record<string, unknown>[], Record<string, string>];
    expect(firstBatch).toHaveLength(500);
    expect(firstBatch[0]).toEqual({ user_id: 'u1', run_id: 'run-1', ad_id: 'ad-0', keyword: 'k', is_new: true });
    expect(options).toEqual({ onConflict: 'run_id,ad_id,keyword' });
  });

  describe('markFailed', () => {
    it('marks the run failed and notifies the user for manual runs', async () => {
      const { fake, notifications, service } = buildService();
      fake.respond('collection_runs', { data: { id: 'run-1', schedule_id: null } });
      const run = await service.markFailed('u1', 'run-1', 'x'.repeat(2000));
      expect(run).toEqual({ id: 'run-1', schedule_id: null });
      const patch = fake.argumentsOf('collection_runs', 'update')?.[0] as Record<string, unknown>;
      expect(patch).toMatchObject({ status: 'failed', stage: 'failed' });
      expect((patch.error as string).length).toBe(1000);
      expect(notifications.notify).toHaveBeenCalledWith('u1', 'collection_failed', 'Ad collection failed', expect.any(String), { run_id: 'run-1' });
    });
    it('leaves notifications to the schedule for scheduled runs', async () => {
      const { fake, notifications, service } = buildService();
      fake.respond('collection_runs', { data: { id: 'run-1', schedule_id: 's1' } });
      await service.markFailed('u1', 'run-1', 'boom');
      expect(notifications.notify).not.toHaveBeenCalled();
    });
    it('copes with a run that vanished', async () => {
      const { fake, service } = buildService();
      fake.respond('collection_runs', { data: null });
      expect(await service.markFailed('u1', 'gone', 'boom')).toBeNull();
    });
  });
});
