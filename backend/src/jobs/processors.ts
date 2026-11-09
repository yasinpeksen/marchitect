import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { AnalyticsService } from '../analytics/analytics.service';
import { AppConfig, readInteger } from '../common/app-config';
import { LockService } from '../common/lock.service';
import { MediaService } from '../media/media.service';
import { MetaApiError } from '../meta/meta-api.client';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { CollectionOrchestrator } from './collection.orchestrator';
import { AnalyticsJob, CollectionJob, InsightsRefreshJob, MediaJob, QUEUES, QueueService } from './queues';

const LOCK_TIME_TO_LIVE_MS = 5 * 60_000;
const LOCK_RETRY_DELAY_MS = 30_000;

/** Errors a retry cannot fix (bad token, missing permission, deleted objects) become unrecoverable. */
export function toFatalError(error: unknown): Error {
  if (error instanceof MetaApiError && (error.isAuth || error.isPermission)) return new UnrecoverableError(error.message);
  if (error instanceof NotFoundException || error instanceof BadRequestException) return new UnrecoverableError(error.message);
  return error instanceof Error ? error : new Error(String(error));
}

/** The job will not be retried: it was marked unrecoverable or used its last attempt. */
export function isFinalAttempt(error: Error, attemptsMade: number, maximumAttempts = 1): boolean {
  return error instanceof UnrecoverableError || attemptsMade >= maximumAttempts;
}

@Processor(QUEUES.collection, { concurrency: readInteger(process.env.WORKER_COLLECTION_CONCURRENCY, 2), lockDuration: 120_000 })
@Injectable()
export class CollectionProcessor extends WorkerHost {
  private readonly logger = new Logger('CollectionProcessor');

  constructor(
    private readonly orchestrator: CollectionOrchestrator,
    private readonly locks: LockService,
    private readonly runs: CollectionRunsService,
    private readonly scheduler: SchedulerService,
  ) {
    super();
  }

  async process(job: Job<CollectionJob | InsightsRefreshJob>, token?: string) {
    const { runId, userId } = job.data;
    const run = await this.runs.get(userId, runId);

    // One collection per ad account at a time (distributed lock). Waiting jobs are delayed, not failed.
    const lockKey = `collect:${run.ad_account_id}`;
    const ownerToken = await this.locks.acquire(lockKey, LOCK_TIME_TO_LIVE_MS);
    if (!ownerToken) {
      await job.moveToDelayed(Date.now() + LOCK_RETRY_DELAY_MS, token);
      throw new DelayedError();
    }
    const heartbeat = setInterval(() => {
      void this.locks.extend(lockKey, ownerToken, LOCK_TIME_TO_LIVE_MS).catch(() => undefined);
    }, 60_000);

    try {
      await this.scheduler.onExecutionStart(runId, job.attemptsMade + 1);
      const refresh = job.data as InsightsRefreshJob;
      const result = job.name === 'refresh-insights'
        ? await this.orchestrator.refreshInsights(runId, userId, refresh.adIds, refresh.dateFrom, refresh.dateTo)
        : await this.orchestrator.execute(runId, userId);
      await this.scheduler.onRunFinished(run, result.status);
      return result;
    } catch (error) {
      throw toFatalError(error);
    } finally {
      clearInterval(heartbeat);
      await this.locks.release(lockKey, ownerToken);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<CollectionJob> | undefined, error: Error) {
    if (!job || error instanceof DelayedError) return;
    const finalAttempt = isFinalAttempt(error, job.attemptsMade, job.opts.attempts);
    const { runId, userId } = job.data;
    this.logger.warn(`run ${runId} attempt ${job.attemptsMade} failed: ${error.message}${finalAttempt ? ' (giving up)' : ' (will retry)'}`);
    if (!finalAttempt) {
      await this.runs.update(runId, { status: 'queued', stage: `retrying after error: ${error.message}`.slice(0, 200) });
      return;
    }
    const run = await this.orchestrator.fail(runId, userId, error.message);
    if (run) await this.scheduler.onRunFinished(run, 'failed', error.message);
  }
}

@Processor(QUEUES.media, { concurrency: readInteger(process.env.WORKER_MEDIA_CONCURRENCY, 3), lockDuration: 600_000 })
@Injectable()
export class MediaProcessor extends WorkerHost {
  constructor(private readonly media: MediaService) {
    super();
  }

  async process(job: Job<MediaJob>) {
    try {
      return await this.media.process(job.data.userId, job.data.storageAssetId, job.data.adAccountId);
    } catch (error) {
      throw toFatalError(error);
    }
  }
}

@Processor(QUEUES.analytics, { concurrency: 2 })
@Injectable()
export class AnalyticsProcessor extends WorkerHost {
  constructor(private readonly analytics: AnalyticsService) {
    super();
  }

  async process(job: Job<AnalyticsJob>) {
    return this.analytics.recalculate(job.data.userId, job.data.adIds);
  }
}

/** Repeatable "tick" that dispatches due schedules; DB-persisted schedules survive restarts. */
@Processor(QUEUES.scheduler, { concurrency: 1 })
@Injectable()
export class SchedulerProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger('SchedulerProcessor');

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly queues: QueueService,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.queues.schedulerQueue.upsertJobScheduler(
      'scheduler-tick',
      { every: this.config.schedulerTickMs },
      { name: 'tick', opts: { attempts: 1, removeOnComplete: true, removeOnFail: 50 } },
    );
    this.logger.log(`Scheduler tick every ${this.config.schedulerTickMs}ms`);
  }

  async process() {
    const started = await this.scheduler.tick();
    if (started > 0) this.logger.log(`Dispatched ${started} scheduled collection(s)`);
    return { started };
  }
}
