import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { QueueService } from '../jobs/queues';
import { NotificationsService } from '../notifications/notifications.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { FakeSupabase } from '../testing/fake-supabase';
import { SchedulerService } from './scheduler.service';

const FIXED_NOW = new Date('2026-03-10T12:00:00Z');

const scheduleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 's1', user_id: 'u1', name: 'Daily', keywords: ['summer'], ad_account_id: 'acc-1', interval_unit: 'day', interval_value: 1, timezone: 'UTC',
  lookback_days: 30, start_at: '2026-03-01T00:00:00.000Z', end_at: null, enabled: true, next_run_at: '2026-03-10T00:00:00.000Z', consecutive_failures: 0, ...overrides,
});

const buildService = () => {
  const fake = new FakeSupabase();
  const runs = { create: jest.fn().mockResolvedValue({ id: 'run-1' }) };
  const queues = { enqueueCollection: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new SchedulerService(
    fake as unknown as SupabaseService, runs as unknown as CollectionRunsService, queues as unknown as QueueService, notifications as unknown as NotificationsService,
  );
  return { fake, runs, queues, notifications, service };
};

describe('SchedulerService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    const input = { name: ' Daily ', keywords: ['Summer', 'summer'], ad_account_id: 'acc-1', interval_unit: 'day' as const, interval_value: 1, start_at: '2026-03-20T00:00:00.000Z' };

    it('normalises input, validates the account and schedules the first run at the start time', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_accounts', { data: { id: 'acc-1' } });
      await service.create('u1', input);
      expect(fake.argumentsOf('schedules', 'insert')?.[0]).toMatchObject({
        user_id: 'u1', name: 'Daily', keywords: ['summer'], timezone: 'UTC', lookback_days: 30, enabled: true, next_run_at: '2026-03-20T00:00:00.000Z',
      });
    });

    it('does not schedule a run for a disabled schedule', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_accounts', { data: { id: 'acc-1' } });
      await service.create('u1', { ...input, enabled: false });
      expect(fake.argumentsOf('schedules', 'insert')?.[0]).toMatchObject({ enabled: false, next_run_at: null });
    });

    it('rejects an unknown account and an invalid timezone', async () => {
      const unknownAccount = buildService();
      unknownAccount.fake.respond('ad_accounts', { data: null });
      await expect(unknownAccount.service.create('u1', input)).rejects.toThrow(NotFoundException);
      const badZone = buildService();
      badZone.fake.respond('ad_accounts', { data: { id: 'acc-1' } });
      await expect(badZone.service.create('u1', { ...input, timezone: 'Nope/Zone' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('pausing clears the next run', async () => {
      const { fake, service } = buildService();
      fake.respond('schedules', { data: scheduleRow() });
      await service.update('u1', 's1', { enabled: false });
      expect(fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0]).toMatchObject({ enabled: false, next_run_at: null });
    });

    it('resuming schedules the next future slot (no backfill) and resets failures', async () => {
      const { fake, service } = buildService();
      fake.respond('schedules', { data: scheduleRow({ enabled: false, next_run_at: null, consecutive_failures: 3 }) });
      await service.update('u1', 's1', { enabled: true });
      const patch = fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0];
      expect(patch).toMatchObject({ enabled: true, next_run_at: '2026-03-11T00:00:00.000Z', consecutive_failures: 0 });
    });

    it('recomputes the next run when timing fields change', async () => {
      const { fake, service } = buildService();
      fake.respond('schedules', { data: scheduleRow() });
      await service.update('u1', 's1', { interval_unit: 'week', interval_value: 2, name: ' Renamed ', keywords: ['X', 'x'] });
      const patch = fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0];
      expect(patch).toMatchObject({ name: 'Renamed', keywords: ['x'], next_run_at: '2026-03-15T00:00:00.000Z' });
    });

    it('leaves next_run_at alone for non-timing edits', async () => {
      const { fake, service } = buildService();
      fake.respond('schedules', { data: scheduleRow() });
      await service.update('u1', 's1', { lookback_days: 7 });
      const patch = fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0] as Record<string, unknown>;
      expect(patch).not.toHaveProperty('next_run_at');
    });

    it('rejects invalid timing and unknown schedules', async () => {
      const invalid = buildService();
      invalid.fake.respond('schedules', { data: scheduleRow() });
      await expect(invalid.service.update('u1', 's1', { timezone: 'Nope/Zone' })).rejects.toThrow(BadRequestException);
      const missing = buildService();
      missing.fake.respond('schedules', { data: null });
      await expect(missing.service.update('u1', 's1', {})).rejects.toThrow(NotFoundException);
    });
  });

  it('lists schedules with their ad accounts', async () => {
    const { fake, service } = buildService();
    fake.respond('schedules', { data: [scheduleRow()] });
    expect(await service.list('u1')).toHaveLength(1);
  });

  describe('remove', () => {
    it('deletes an owned schedule', async () => {
      const { fake, service } = buildService();
      fake.respond('schedules', { data: [{ id: 's1' }] });
      await expect(service.remove('u1', 's1')).resolves.toBeUndefined();
    });
    it('throws for a missing schedule', async () => {
      await expect(buildService().service.remove('u1', 'x')).rejects.toThrow(NotFoundException);
    });
  });

  it('lists executions of an owned schedule', async () => {
    const { fake, service } = buildService();
    fake.respond('schedules', { data: scheduleRow() });
    fake.respond('schedule_executions', { data: [{ id: 'e1' }] });
    expect(await service.executions('u1', 's1')).toEqual([{ id: 'e1' }]);
  });

  describe('runNow', () => {
    it('starts a run for the schedule without advancing its recurring slot', async () => {
      const { fake, queues, service } = buildService();
      fake.respond('schedules', { data: scheduleRow() });
      fake.respond('schedule_executions', { data: { id: 'ex1' } });
      fake.respond('collection_runs', { data: [] });
      const run = await service.runNow('u1', 's1');
      expect(run).toEqual({ id: 'run-1' });
      expect(queues.enqueueCollection).toHaveBeenCalledWith({ runId: 'run-1', userId: 'u1' });
      const scheduleUpdates = fake.callsTo('schedules').flatMap((call) => call.operations).filter((operation) => operation.name === 'update');
      expect(scheduleUpdates[0].args[0]).toEqual({ last_run_at: FIXED_NOW.toISOString() });
    });
  });

  describe('tick', () => {
    const arrangeDue = (overrides: Record<string, unknown> = {}) => {
      const context = buildService();
      context.fake.respond('schedules', { data: [scheduleRow(overrides)] });
      return context;
    };

    it('dispatches a due schedule, creates the run and advances to the next slot', async () => {
      const { fake, runs, queues, service } = arrangeDue();
      fake.respond('schedule_executions', { data: { id: 'ex1' } });
      fake.respond('collection_runs', { data: [] });
      expect(await service.tick()).toBe(1);
      expect(runs.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u1', adAccountId: 'acc-1', keywords: ['summer'], trigger: 'schedule', scheduleId: 's1', dateTo: '2026-03-10', dateFrom: '2026-02-09',
      }));
      expect(queues.enqueueCollection).toHaveBeenCalledTimes(1);
      const advance = fake.callsTo('schedules').flatMap((call) => call.operations).filter((operation) => operation.name === 'update').at(-1)?.args[0];
      expect(advance).toMatchObject({ next_run_at: '2026-03-11T00:00:00.000Z', enabled: true });
    });

    it('claims the slot through the unique (schedule, time) key', async () => {
      const { fake, service } = arrangeDue();
      fake.respond('schedule_executions', { data: { id: 'ex1' } });
      await service.tick();
      expect(fake.argumentsOf('schedule_executions', 'insert')?.[0]).toMatchObject({ schedule_id: 's1', scheduled_for: '2026-03-10T00:00:00.000Z', status: 'queued' });
    });

    it('skips a slot another worker already claimed, but still advances the schedule', async () => {
      const { fake, runs, service } = arrangeDue();
      fake.respond('schedule_executions', { error: { message: 'duplicate key', code: '23505' } });
      expect(await service.tick()).toBe(0);
      expect(runs.create).not.toHaveBeenCalled();
      const advance = fake.callsTo('schedules').flatMap((call) => call.operations).filter((operation) => operation.name === 'update').at(-1)?.args[0];
      expect(advance).toMatchObject({ next_run_at: '2026-03-11T00:00:00.000Z' });
    });

    it('does not start an overlapping run while the previous one is in flight', async () => {
      const { fake, runs, service } = arrangeDue();
      fake.respond('schedule_executions', { data: { id: 'ex1' } });
      fake.respond('collection_runs', { data: [{ id: 'still-running' }] });
      expect(await service.tick()).toBe(0);
      expect(runs.create).not.toHaveBeenCalled();
      expect(fake.argumentsOf('schedule_executions', 'update')?.[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('still running') });
    });

    it('disables a schedule whose next slot is past its end date', async () => {
      const { fake, service } = arrangeDue({ end_at: '2026-03-10T23:00:00.000Z' });
      fake.respond('schedule_executions', { data: { id: 'ex1' } });
      await service.tick();
      const advance = fake.callsTo('schedules').flatMap((call) => call.operations).filter((operation) => operation.name === 'update').at(-1)?.args[0];
      expect(advance).toMatchObject({ next_run_at: null, enabled: false });
    });

    it('isolates a failing schedule from the others', async () => {
      const { fake, service } = arrangeDue();
      fake.respond('schedule_executions', { error: { message: 'connection reset', code: '08006' } });
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      expect(await service.tick()).toBe(0);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
      logged.mockRestore();
    });
  });

  describe('worker callbacks', () => {
    it('marks the execution running with its attempt number', async () => {
      const { fake, service } = buildService();
      await service.onExecutionStart('run-1', 2);
      expect(fake.argumentsOf('schedule_executions', 'update')?.[0]).toMatchObject({ status: 'running', attempt: 2 });
    });

    it('ignores runs that do not belong to a schedule', async () => {
      const { fake, service } = buildService();
      await service.onRunFinished({ id: 'r', user_id: 'u1', schedule_id: null }, 'failed');
      expect(fake.calls).toHaveLength(0);
    });

    it('records success and resets the failure counter', async () => {
      const { fake, notifications, service } = buildService();
      fake.respond('schedules', { data: { name: 'Daily', consecutive_failures: 2 } });
      await service.onRunFinished({ id: 'r', user_id: 'u1', schedule_id: 's1' }, 'succeeded');
      expect(fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0]).toEqual({ last_status: 'succeeded', consecutive_failures: 0 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('counts a failure and notifies the user', async () => {
      const { fake, notifications, service } = buildService();
      fake.respond('schedules', { data: { name: 'Daily', consecutive_failures: 1 } });
      await service.onRunFinished({ id: 'r', user_id: 'u1', schedule_id: 's1' }, 'failed', 'Meta said no');
      expect(fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0]).toEqual({ last_status: 'failed', consecutive_failures: 2 });
      expect(notifications.notify).toHaveBeenCalledWith('u1', 'schedule_failed', 'Scheduled search "Daily" failed', 'Meta said no', { schedule_id: 's1', run_id: 'r' });
    });

    it('pauses the schedule after five consecutive failures', async () => {
      const { fake, notifications, service } = buildService();
      fake.respond('schedules', { data: { name: 'Daily', consecutive_failures: 4 } });
      await service.onRunFinished({ id: 'r', user_id: 'u1', schedule_id: 's1' }, 'failed');
      expect(fake.callsTo('schedules').flatMap((call) => call.operations).find((operation) => operation.name === 'update')?.args[0]).toMatchObject({ enabled: false, next_run_at: null, consecutive_failures: 5 });
      expect(notifications.notify).toHaveBeenCalledWith('u1', 'schedule_failed', expect.any(String), expect.stringContaining('paused after 5 consecutive failures'), expect.anything());
    });

    it('does nothing when the schedule was deleted meanwhile', async () => {
      const { fake, notifications, service } = buildService();
      fake.respond('schedules', { data: null });
      await service.onRunFinished({ id: 'r', user_id: 'u1', schedule_id: 's1' }, 'failed');
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
