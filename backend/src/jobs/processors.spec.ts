import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { AnalyticsService } from '../analytics/analytics.service';
import { AppConfig } from '../common/app-config';
import { LockService } from '../common/lock.service';
import { MediaService } from '../media/media.service';
import { MetaApiError } from '../meta/meta-api.client';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { buildTestConfig } from '../testing/fake-supabase';
import { CollectionOrchestrator } from './collection.orchestrator';
import { AnalyticsProcessor, CollectionProcessor, isFinalAttempt, MediaProcessor, SchedulerProcessor, toFatalError } from './processors';
import { QueueService } from './queues';

describe('toFatalError', () => {
  it.each([
    new MetaApiError('expired', 401, 190), new MetaApiError('denied', 403, 200), new NotFoundException('gone'), new BadRequestException('bad'),
  ])('makes %p unrecoverable', (error) => expect(toFatalError(error)).toBeInstanceOf(UnrecoverableError));
  it('keeps retryable errors as they are', () => {
    const error = new Error('timeout');
    expect(toFatalError(error)).toBe(error);
    expect(toFatalError(new MetaApiError('rate', 400, 17))).toBeInstanceOf(MetaApiError);
  });
  it('wraps non-Error values', () => expect(toFatalError('text')).toEqual(new Error('text')));
});

describe('isFinalAttempt', () => {
  it('is final for unrecoverable errors regardless of attempts', () => expect(isFinalAttempt(new UnrecoverableError('x'), 1, 5)).toBe(true));
  it('is final once the attempts are used', () => {
    expect(isFinalAttempt(new Error('x'), 3, 3)).toBe(true);
    expect(isFinalAttempt(new Error('x'), 2, 3)).toBe(false);
  });
  it('defaults to a single attempt', () => expect(isFinalAttempt(new Error('x'), 1)).toBe(true));
});

const buildJob = (overrides: Record<string, unknown> = {}) =>
  ({ name: 'collect', data: { runId: 'run-1', userId: 'u1' }, attemptsMade: 0, opts: { attempts: 3 }, moveToDelayed: jest.fn(), ...overrides }) as unknown as Job<never> & { moveToDelayed: jest.Mock };

describe('CollectionProcessor', () => {
  const run = { id: 'run-1', user_id: 'u1', ad_account_id: 'acc-1', schedule_id: 's1' };

  const build = () => {
    const orchestrator = {
      execute: jest.fn().mockResolvedValue({ status: 'succeeded', errors: [] }),
      refreshInsights: jest.fn().mockResolvedValue({ status: 'partial', errors: ['x'] }),
      fail: jest.fn().mockResolvedValue(run),
    };
    const locks = { acquire: jest.fn().mockResolvedValue('owner-token'), extend: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
    const runs = { get: jest.fn().mockResolvedValue(run), update: jest.fn() };
    const scheduler = { onExecutionStart: jest.fn(), onRunFinished: jest.fn() };
    const processor = new CollectionProcessor(
      orchestrator as unknown as CollectionOrchestrator, locks as unknown as LockService, runs as unknown as CollectionRunsService, scheduler as unknown as SchedulerService,
    );
    return { orchestrator, locks, runs, scheduler, processor };
  };

  it('runs a collection under a per-ad-account lock and reports to the schedule', async () => {
    const { orchestrator, locks, scheduler, processor } = build();
    expect(await processor.process(buildJob(), 'token')).toEqual({ status: 'succeeded', errors: [] });
    expect(locks.acquire).toHaveBeenCalledWith('collect:acc-1', 300_000);
    expect(scheduler.onExecutionStart).toHaveBeenCalledWith('run-1', 1);
    expect(orchestrator.execute).toHaveBeenCalledWith('run-1', 'u1');
    expect(scheduler.onRunFinished).toHaveBeenCalledWith(run, 'succeeded');
    expect(locks.release).toHaveBeenCalledWith('collect:acc-1', 'owner-token');
  });

  it('routes insight refresh jobs to the refresh pipeline', async () => {
    const { orchestrator, processor } = build();
    const job = buildJob({ name: 'refresh-insights', data: { runId: 'run-1', userId: 'u1', adIds: ['a'], dateFrom: '2026-01-01', dateTo: '2026-01-31' } });
    await processor.process(job, 'token');
    expect(orchestrator.refreshInsights).toHaveBeenCalledWith('run-1', 'u1', ['a'], '2026-01-01', '2026-01-31');
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  it('delays instead of failing when another collection holds the lock', async () => {
    const { locks, orchestrator, processor } = build();
    locks.acquire.mockResolvedValue(null);
    const job = buildJob();
    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
    expect(orchestrator.execute).not.toHaveBeenCalled();
    expect(locks.release).not.toHaveBeenCalled();
  });

  it('releases the lock and converts fatal errors when the run fails', async () => {
    const { orchestrator, locks, processor } = build();
    orchestrator.execute.mockRejectedValue(new MetaApiError('expired', 401, 190));
    await expect(processor.process(buildJob(), 'token')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(locks.release).toHaveBeenCalledWith('collect:acc-1', 'owner-token');
  });

  describe('onFailed', () => {
    it('ignores delays and missing jobs', async () => {
      const { orchestrator, processor } = build();
      await processor.onFailed(undefined, new Error('x'));
      await processor.onFailed(buildJob(), new DelayedError());
      expect(orchestrator.fail).not.toHaveBeenCalled();
    });

    it('re-queues the run while retries remain', async () => {
      const { runs, orchestrator, processor } = build();
      await processor.onFailed(buildJob({ attemptsMade: 1 }), new Error('timeout'));
      expect(runs.update).toHaveBeenCalledWith('run-1', { status: 'queued', stage: 'retrying after error: timeout' });
      expect(orchestrator.fail).not.toHaveBeenCalled();
    });

    it('fails the run and the schedule execution on the final attempt', async () => {
      const { orchestrator, scheduler, processor } = build();
      await processor.onFailed(buildJob({ attemptsMade: 3 }), new Error('still broken'));
      expect(orchestrator.fail).toHaveBeenCalledWith('run-1', 'u1', 'still broken');
      expect(scheduler.onRunFinished).toHaveBeenCalledWith(run, 'failed', 'still broken');
    });

    it('fails immediately on unrecoverable errors', async () => {
      const { orchestrator, processor } = build();
      await processor.onFailed(buildJob({ attemptsMade: 1 }), new UnrecoverableError('bad token'));
      expect(orchestrator.fail).toHaveBeenCalled();
    });

    it('skips schedule bookkeeping when the run vanished', async () => {
      const { orchestrator, scheduler, processor } = build();
      orchestrator.fail.mockResolvedValue(null);
      await processor.onFailed(buildJob({ attemptsMade: 3 }), new Error('x'));
      expect(scheduler.onRunFinished).not.toHaveBeenCalled();
    });
  });
});

describe('MediaProcessor', () => {
  const job = buildJob({ data: { userId: 'u1', storageAssetId: 'asset-1', adAccountId: 'acc-1' } });
  it('downloads the asset', async () => {
    const media = { process: jest.fn().mockResolvedValue('stored') };
    expect(await new MediaProcessor(media as unknown as MediaService).process(job as never)).toBe('stored');
    expect(media.process).toHaveBeenCalledWith('u1', 'asset-1', 'acc-1');
  });
  it('makes permission errors unrecoverable', async () => {
    const media = { process: jest.fn().mockRejectedValue(new MetaApiError('denied', 403, 200)) };
    await expect(new MediaProcessor(media as unknown as MediaService).process(job as never)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('AnalyticsProcessor', () => {
  it('recalculates analytics for the ads', async () => {
    const analytics = { recalculate: jest.fn().mockResolvedValue(2) };
    const job = buildJob({ data: { userId: 'u1', adIds: ['a', 'b'] } });
    expect(await new AnalyticsProcessor(analytics as unknown as AnalyticsService).process(job as never)).toBe(2);
    expect(analytics.recalculate).toHaveBeenCalledWith('u1', ['a', 'b']);
  });
});

describe('SchedulerProcessor', () => {
  const build = (started = 0) => {
    const scheduler = { tick: jest.fn().mockResolvedValue(started) };
    const schedulerQueue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    const queues = { schedulerQueue };
    const processor = new SchedulerProcessor(scheduler as unknown as SchedulerService, queues as unknown as QueueService, buildTestConfig({ schedulerTickMs: 5000 }) as unknown as AppConfig);
    return { scheduler, schedulerQueue, processor };
  };

  it('registers a repeatable tick on bootstrap', async () => {
    const { schedulerQueue, processor } = build();
    await processor.onApplicationBootstrap();
    expect(schedulerQueue.upsertJobScheduler).toHaveBeenCalledWith('scheduler-tick', { every: 5000 }, expect.objectContaining({ name: 'tick' }));
  });

  it('dispatches due schedules on every tick', async () => {
    const { scheduler, processor } = build(2);
    expect(await processor.process()).toEqual({ started: 2 });
    expect(scheduler.tick).toHaveBeenCalled();
  });

  it('reports zero when nothing was due', async () => {
    expect(await build(0).processor.process()).toEqual({ started: 0 });
  });
});
