import { Global, Injectable, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { JobsOptions, Queue } from 'bullmq';
import { AppConfig } from '../common/app-config';

export const QUEUES = {
  collection: 'collection',
  media: 'media',
  analytics: 'analytics',
  scheduler: 'scheduler',
} as const;

export interface CollectionJob {
  runId: string;
  userId: string;
}
export interface InsightsRefreshJob {
  runId: string;
  userId: string;
  adIds: string[];
  dateFrom: string;
  dateTo: string;
}
export interface MediaJob {
  userId: string;
  storageAssetId: string;
  adAccountId: string;
}
export interface AnalyticsJob {
  userId: string;
  adIds: string[];
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400 },
};

/** Analytics jobs are debounced into 30 second windows so repeated triggers collapse. */
export const ANALYTICS_WINDOW_MS = 30_000;

/** Producer API. BullMQ job ids use "_" (":" is reserved) and make enqueueing idempotent. */
@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUES.collection) private readonly collectionQueue: Queue,
    @InjectQueue(QUEUES.media) private readonly mediaQueue: Queue,
    @InjectQueue(QUEUES.analytics) private readonly analyticsQueue: Queue,
    @InjectQueue(QUEUES.scheduler) readonly schedulerQueue: Queue,
  ) {}

  enqueueCollection(data: CollectionJob) {
    return this.collectionQueue.add('collect', data, { jobId: `run_${data.runId}` });
  }

  enqueueInsightsRefresh(data: InsightsRefreshJob) {
    return this.collectionQueue.add('refresh-insights', data, { jobId: `refresh_${data.runId}` });
  }

  enqueueMedia(data: MediaJob) {
    return this.mediaQueue.add('download', data, {
      jobId: `media_${data.storageAssetId}`,
      attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  }

  enqueueAnalytics(data: AnalyticsJob, now: number = Date.now()) {
    const windowIndex = Math.floor(now / ANALYTICS_WINDOW_MS);
    return this.analyticsQueue.add('recalculate', data, { jobId: `analytics_${data.userId}_${windowIndex}_${data.adIds.length}` });
  }
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.redisUrl, maxRetriesPerRequest: null },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.collection },
      { name: QUEUES.media },
      { name: QUEUES.analytics },
      { name: QUEUES.scheduler },
    ),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueuesModule {}
