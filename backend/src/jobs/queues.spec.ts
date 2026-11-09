import { Queue } from 'bullmq';
import { ANALYTICS_WINDOW_MS, QueueService } from './queues';

const buildQueue = () => ({ add: jest.fn().mockResolvedValue({}) }) as unknown as Queue & { add: jest.Mock };

const buildService = () => {
  const queues = { collection: buildQueue(), media: buildQueue(), analytics: buildQueue(), scheduler: buildQueue() };
  return { queues, service: new QueueService(queues.collection, queues.media, queues.analytics, queues.scheduler) };
};

describe('QueueService', () => {
  it('enqueues a collection with an idempotent job id (no ":" which BullMQ reserves)', async () => {
    const { queues, service } = buildService();
    await service.enqueueCollection({ runId: 'run-1', userId: 'u1' });
    expect(queues.collection.add).toHaveBeenCalledWith('collect', { runId: 'run-1', userId: 'u1' }, { jobId: 'run_run-1' });
  });

  it('enqueues an insights refresh on the collection queue', async () => {
    const { queues, service } = buildService();
    const data = { runId: 'r2', userId: 'u1', adIds: ['a'], dateFrom: '2026-01-01', dateTo: '2026-01-31' };
    await service.enqueueInsightsRefresh(data);
    expect(queues.collection.add).toHaveBeenCalledWith('refresh-insights', data, { jobId: 'refresh_r2' });
  });

  it('enqueues media downloads once per asset with its own retry policy', async () => {
    const { queues, service } = buildService();
    await service.enqueueMedia({ userId: 'u1', storageAssetId: 'asset-1', adAccountId: 'acc' });
    const [name, , options] = queues.media.add.mock.calls[0];
    expect(name).toBe('download');
    expect(options).toMatchObject({ jobId: 'media_asset-1', attempts: 4, backoff: { type: 'exponential', delay: 60_000 } });
    expect(options.jobId).not.toContain(':');
  });

  it('debounces analytics jobs into time windows', async () => {
    const { queues, service } = buildService();
    const data = { userId: 'u1', adIds: ['a', 'b'] };
    await service.enqueueAnalytics(data, 5 * ANALYTICS_WINDOW_MS + 1);
    await service.enqueueAnalytics(data, 5 * ANALYTICS_WINDOW_MS + ANALYTICS_WINDOW_MS - 1);
    await service.enqueueAnalytics(data, 6 * ANALYTICS_WINDOW_MS);
    const jobIds = queues.analytics.add.mock.calls.map((call) => call[2].jobId);
    expect(jobIds[0]).toBe(jobIds[1]);
    expect(jobIds[2]).not.toBe(jobIds[0]);
    expect(jobIds[0]).toBe('analytics_u1_5_2');
  });

  it('exposes the scheduler queue for repeatable ticks', async () => {
    const { queues, service } = buildService();
    expect(service.schedulerQueue).toBe(queues.scheduler);
  });
});
