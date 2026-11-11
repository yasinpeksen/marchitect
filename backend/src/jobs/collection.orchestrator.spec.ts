import { AdCollectorService } from '../advertisements/ad-collector.service';
import { AdLibraryCollectorService } from '../advertisements/ad-library-collector.service';
import { AppConfig } from '../common/app-config';
import { InsightsService } from '../insights/insights.service';
import { MediaService } from '../media/media.service';
import { MetaApiError } from '../meta/meta-api.client';
import { MetaConnectionsService } from '../meta/meta-connections.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { TikTokApiError } from '../tiktok/tiktok-api.client';
import { TikTokCollectorService } from '../tiktok/tiktok-collector.service';
import { TikTokConnectionsService } from '../tiktok/tiktok-connections.service';
import { TikTokInsightsService } from '../tiktok/tiktok-insights.service';
import { CollectionOrchestrator, outcomeFor } from './collection.orchestrator';
import { QueueService } from './queues';
import { MetaRunSourceFactory, TikTokRunSourceFactory } from './run-sources';

describe('outcomeFor', () => {
  it('is succeeded without errors and partial with any', () => {
    expect(outcomeFor([])).toBe('succeeded');
    expect(outcomeFor(['breakdown failed'])).toBe('partial');
  });
});

const run = { id: 'run-1', user_id: 'u1', ad_account_id: 'acc-1', keywords: ['summer'], date_from: '2026-03-01', date_to: '2026-03-10', schedule_id: null };
const account = { id: 'acc-1', meta_account_id: 'act_1', connection_id: 'conn-1' };

const buildOrchestrator = () => {
  const runs = {
    get: jest.fn().mockResolvedValue(run), update: jest.fn().mockResolvedValue(undefined),
    saveSearchResults: jest.fn().mockResolvedValue(undefined), markFailed: jest.fn().mockResolvedValue(run),
    platformOfAccount: jest.fn().mockResolvedValue('meta'),
  };
  const connections = { contextForAccount: jest.fn().mockResolvedValue({ account, context: { token: 'EAAx' } }), noteFailure: jest.fn() };
  const collector = {
    collect: jest.fn().mockResolvedValue({
      ads: [
        { id: 'ad-1', meta_ad_id: 'm1', is_new: true, is_dynamic: false, keywords: ['summer'] },
        { id: 'ad-2', meta_ad_id: 'm2', is_new: false, is_dynamic: false, keywords: ['summer', 'sale'] },
      ],
      errors: [], truncated: false,
    }),
  };
  const insights = { collect: jest.fn().mockResolvedValue([]), loadInsightAds: jest.fn().mockResolvedValue([{ id: 'ad-1', meta_ad_id: 'm1', is_dynamic: false }]) };
  const media = { planForAds: jest.fn().mockResolvedValue(3) };
  const queues = { enqueueAnalytics: jest.fn() };
  const tiktokAccount = { id: 'acc-1', meta_account_id: 'tiktok:700', connection_id: 'conn-tt', currency: 'USD' };
  const tiktokConnections = {
    contextForAccount: jest.fn().mockResolvedValue({ account: tiktokAccount, advertiserId: '700', context: { token: 'tt-token' } }), noteFailure: jest.fn(),
  };
  const tiktokCollector = { collect: jest.fn().mockResolvedValue({ ads: [{ id: 'ad-9', meta_ad_id: 'tiktok:9', is_new: true, is_dynamic: false, keywords: ['summer'] }], errors: [], truncated: false }) };
  const tiktokInsights = { collect: jest.fn().mockResolvedValue([]) };
  const metaSources = new MetaRunSourceFactory(
    connections as unknown as MetaConnectionsService, collector as unknown as AdCollectorService, insights as unknown as InsightsService,
    { collect: jest.fn() } as unknown as AdLibraryCollectorService, { adLibraryEnabled: false } as unknown as AppConfig,
  );
  const tiktokSources = new TikTokRunSourceFactory(
    tiktokConnections as unknown as TikTokConnectionsService, tiktokCollector as unknown as TikTokCollectorService, tiktokInsights as unknown as TikTokInsightsService,
  );
  const orchestrator = new CollectionOrchestrator(
    runs as unknown as CollectionRunsService, metaSources, tiktokSources, insights as unknown as InsightsService, media as unknown as MediaService, queues as unknown as QueueService,
  );
  return { runs, connections, collector, insights, media, queues, tiktokConnections, tiktokCollector, tiktokInsights, orchestrator };
};

describe('CollectionOrchestrator', () => {
  describe('execute', () => {
    it('runs the full pipeline and records progress and counters', async () => {
      const { runs, collector, insights, media, queues, orchestrator } = buildOrchestrator();
      expect(await orchestrator.execute('run-1', 'u1')).toEqual({ status: 'succeeded', errors: [] });

      expect(collector.collect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', account, keywords: ['summer'] }));
      expect(runs.saveSearchResults).toHaveBeenCalledWith('u1', 'run-1', [
        { adId: 'ad-1', keyword: 'summer', isNew: true }, { adId: 'ad-2', keyword: 'summer', isNew: false }, { adId: 'ad-2', keyword: 'sale', isNew: false },
      ]);
      expect(insights.collect).toHaveBeenCalledWith(expect.objectContaining({ metaAccountId: 'act_1', dateFrom: '2026-03-01', dateTo: '2026-03-10' }));
      expect(media.planForAds).toHaveBeenCalledWith('u1', 'acc-1', ['ad-1', 'ad-2']);
      expect(queues.enqueueAnalytics).toHaveBeenCalledWith({ userId: 'u1', adIds: ['ad-1', 'ad-2'] });

      const updates = runs.update.mock.calls.map((call) => call[1]);
      expect(updates[0]).toMatchObject({ status: 'running', stage: 'searching_meta', progress: 5 });
      expect(updates.find((patch) => patch.stage === 'ads_saved')).toMatchObject({ progress: 30, counters: { ads_found: 2, ads_new: 1, ads_updated: 1 } });
      expect(updates.at(-1)).toMatchObject({ status: 'succeeded', stage: 'done', progress: 100, counters: { ads_found: 2, media_queued: 3 }, errors: [] });
    });

    it('reports insight progress while collecting', async () => {
      const { runs, insights, orchestrator } = buildOrchestrator();
      insights.collect.mockImplementation(async ({ onProgress }: { onProgress: (done: number, total: number, label: string) => Promise<void> }) => {
        await onProgress(5, 10, 'daily insights');
        return [];
      });
      await orchestrator.execute('run-1', 'u1');
      expect(runs.update.mock.calls.map((call) => call[1])).toContainEqual(expect.objectContaining({ stage: 'insights: daily insights', progress: 55 }));
    });

    it('finishes as partial and keeps non-fatal errors', async () => {
      const { collector, insights, runs, orchestrator } = buildOrchestrator();
      collector.collect.mockResolvedValue({ ads: [{ id: 'ad-1', meta_ad_id: 'm1', is_new: true, is_dynamic: false, keywords: ['summer'] }], errors: ['Keyword "x": failed'], truncated: false });
      insights.collect.mockResolvedValue(['breakdown device: failed']);
      const outcome = await orchestrator.execute('run-1', 'u1');
      expect(outcome).toEqual({ status: 'partial', errors: ['Keyword "x": failed', 'breakdown device: failed'] });
      expect(runs.update.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'partial', errors: [{ message: 'Keyword "x": failed' }, { message: 'breakdown device: failed' }] });
    });

    it('skips insights, media and analytics when nothing matched', async () => {
      const { collector, insights, media, queues, orchestrator } = buildOrchestrator();
      collector.collect.mockResolvedValue({ ads: [], errors: [], truncated: false });
      expect(await orchestrator.execute('run-1', 'u1')).toEqual({ status: 'succeeded', errors: [] });
      expect(insights.collect).not.toHaveBeenCalled();
      expect(media.planForAds).not.toHaveBeenCalled();
      expect(queues.enqueueAnalytics).not.toHaveBeenCalled();
    });

    it('flags the connection and rethrows on an auth error', async () => {
      const { collector, connections, orchestrator } = buildOrchestrator();
      const authError = new MetaApiError('expired', 401, 190);
      collector.collect.mockRejectedValue(authError);
      await expect(orchestrator.execute('run-1', 'u1')).rejects.toBe(authError);
      expect(connections.noteFailure).toHaveBeenCalledWith('conn-1', authError);
    });

    it('rethrows other errors without flagging the connection', async () => {
      const { collector, connections, orchestrator } = buildOrchestrator();
      collector.collect.mockRejectedValue(new Error('boom'));
      await expect(orchestrator.execute('run-1', 'u1')).rejects.toThrow('boom');
      expect(connections.noteFailure).not.toHaveBeenCalled();
    });
  });

  describe('refreshInsights', () => {
    it('re-collects insights for the given ads over the new range', async () => {
      const { runs, insights, queues, orchestrator } = buildOrchestrator();
      expect(await orchestrator.refreshInsights('run-1', 'u1', ['ad-1'], '2026-01-01', '2026-01-31')).toEqual({ status: 'succeeded', errors: [] });
      expect(insights.loadInsightAds).toHaveBeenCalledWith('u1', ['ad-1']);
      expect(insights.collect).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-01-01', dateTo: '2026-01-31', ads: [{ id: 'ad-1', meta_ad_id: 'm1', is_dynamic: false }] }));
      expect(queues.enqueueAnalytics).toHaveBeenCalledWith({ userId: 'u1', adIds: ['ad-1'] });
      expect(runs.update.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'succeeded', counters: { ads_found: 1 } });
    });

    it('is partial when insights report errors, and tracks progress', async () => {
      const { runs, insights, orchestrator } = buildOrchestrator();
      insights.collect.mockImplementation(async ({ onProgress }: { onProgress: (done: number, total: number, label: string) => Promise<void> }) => {
        await onProgress(1, 2, 'daily insights');
        return ['range insights: failed'];
      });
      expect((await orchestrator.refreshInsights('run-1', 'u1', ['ad-1'], '2026-01-01', '2026-01-31')).status).toBe('partial');
      expect(runs.update.mock.calls.map((call) => call[1])).toContainEqual({ stage: 'insights: daily insights', progress: 50 });
    });
  });

  describe('TikTok accounts', () => {
    const useTikTok = (runs: { platformOfAccount: jest.Mock }) => runs.platformOfAccount.mockResolvedValue('tiktok');

    it('runs the same pipeline through the TikTok services', async () => {
      const { runs, collector, insights, media, tiktokConnections, tiktokCollector, tiktokInsights, orchestrator } = buildOrchestrator();
      useTikTok(runs);
      expect(await orchestrator.execute('run-1', 'u1')).toEqual({ status: 'succeeded', errors: [] });

      expect(collector.collect).not.toHaveBeenCalled();
      expect(insights.collect).not.toHaveBeenCalled();
      expect(tiktokConnections.contextForAccount).toHaveBeenCalledWith('u1', 'acc-1');
      expect(tiktokCollector.collect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', advertiserId: '700', keywords: ['summer'], context: { token: 'tt-token' } }));
      expect(tiktokInsights.collect).toHaveBeenCalledWith(expect.objectContaining({ advertiserId: '700', currency: 'USD', dateFrom: '2026-03-01', dateTo: '2026-03-10' }));
      expect(media.planForAds).toHaveBeenCalledWith('u1', 'acc-1', ['ad-9']);
      expect(runs.update.mock.calls[0][1]).toMatchObject({ status: 'running', stage: 'searching_tiktok' });
    });

    it('reports TikTok insight progress', async () => {
      const { runs, tiktokInsights, orchestrator } = buildOrchestrator();
      useTikTok(runs);
      tiktokInsights.collect.mockImplementation(async ({ onProgress }: { onProgress: (done: number, total: number, label: string) => Promise<void> }) => {
        await onProgress(1, 2, 'daily insights');
        return [];
      });
      await orchestrator.execute('run-1', 'u1');
      expect(runs.update.mock.calls.map((call) => call[1])).toContainEqual(expect.objectContaining({ stage: 'insights: daily insights', progress: 55 }));
    });

    it('flags the TikTok connection on an auth error but not on other errors', async () => {
      const { runs, tiktokConnections, tiktokCollector, orchestrator } = buildOrchestrator();
      useTikTok(runs);
      const authError = new TikTokApiError('Access token is invalid', 200, 40_105);
      tiktokCollector.collect.mockRejectedValueOnce(authError);
      await expect(orchestrator.execute('run-1', 'u1')).rejects.toBe(authError);
      expect(tiktokConnections.noteFailure).toHaveBeenCalledWith('conn-tt', authError);

      tiktokConnections.noteFailure.mockClear();
      tiktokCollector.collect.mockRejectedValueOnce(new Error('boom'));
      await expect(orchestrator.execute('run-1', 'u1')).rejects.toThrow('boom');
      expect(tiktokConnections.noteFailure).not.toHaveBeenCalled();
    });

    it('refreshes insights through TikTok too', async () => {
      const { runs, insights, tiktokInsights, orchestrator } = buildOrchestrator();
      useTikTok(runs);
      expect(await orchestrator.refreshInsights('run-1', 'u1', ['ad-1'], '2026-01-01', '2026-01-31')).toEqual({ status: 'succeeded', errors: [] });
      expect(insights.collect).not.toHaveBeenCalled();
      expect(tiktokInsights.collect).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-01-01', ads: [{ id: 'ad-1', meta_ad_id: 'm1', is_dynamic: false }] }));
    });
  });

  it('fail delegates to the runs service', async () => {
    const { runs, orchestrator } = buildOrchestrator();
    expect(await orchestrator.fail('run-1', 'u1', 'boom')).toEqual(run);
    expect(runs.markFailed).toHaveBeenCalledWith('u1', 'run-1', 'boom');
  });
});
