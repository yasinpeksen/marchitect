import { Injectable, Logger } from '@nestjs/common';
import { CollectionRunRow } from '../common/types';
import { InsightsService } from '../insights/insights.service';
import { MediaService } from '../media/media.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { QueueService } from './queues';
import { MetaRunSourceFactory, RunSource, TikTokRunSourceFactory } from './run-sources';

export type RunOutcome = { status: 'succeeded' | 'partial'; errors: string[] };

/** `partial` when anything non-fatal went wrong, otherwise `succeeded`. */
export const outcomeFor = (errors: string[]): RunOutcome['status'] => (errors.length > 0 ? 'partial' : 'succeeded');

/** Executes a collection run end to end and keeps `collection_runs` progress current. */
@Injectable()
export class CollectionOrchestrator {
  private readonly logger = new Logger(CollectionOrchestrator.name);

  constructor(
    private readonly runs: CollectionRunsService,
    private readonly metaSources: MetaRunSourceFactory,
    private readonly tiktokSources: TikTokRunSourceFactory,
    private readonly insights: InsightsService,
    private readonly media: MediaService,
    private readonly queues: QueueService,
  ) {}

  /** Picks the Meta or TikTok implementation for the run's ad account. */
  openSource(userId: string, adAccountId: string): Promise<RunSource> {
    return this.runs.platformOfAccount(userId, adAccountId).then((platform) => (platform === 'tiktok' ? this.tiktokSources : this.metaSources).open(userId, adAccountId));
  }

  async execute(runId: string, userId: string): Promise<RunOutcome> {
    const run = await this.runs.get(userId, runId);
    const source = await this.openSource(userId, run.ad_account_id as string);
    const errors: string[] = [];
    const setStage = (stage: string, progress: number, counters?: Record<string, unknown>) =>
      this.runs.update(runId, { stage, progress, ...(counters ? { counters } : {}) });

    await this.runs.update(runId, { status: 'running', started_at: new Date().toISOString(), stage: source.searchStage, progress: 5, error: null });

    try {
      // Step 3: matching ads from the platform (campaign / ad set / creative hierarchy persisted as they arrive).
      const collected = await source.collect(run.keywords);
      errors.push(...collected.errors);
      const counters: Record<string, unknown> = {
        ads_found: collected.ads.length,
        ads_new: collected.ads.filter((ad) => ad.is_new).length,
        ads_updated: collected.ads.filter((ad) => !ad.is_new).length,
      };
      await setStage('ads_saved', 30, counters); // results are queryable from here on

      if (collected.ads.length > 0) {
        await this.runs.saveSearchResults(
          userId,
          runId,
          collected.ads.flatMap((ad) => ad.keywords.map((keyword) => ({ adId: ad.id, keyword, isNew: ad.is_new }))),
        );

        // Step 4: creatives are on the ad rows already; performance insights next.
        const insightErrors = await source.collectInsights(
          collected.ads,
          run.date_from as string,
          run.date_to as string,
          (done, total, label) => setStage(`insights: ${label}`, 30 + Math.round((done / total) * 50), counters),
        );
        errors.push(...insightErrors);

        // Step 6: media downloads go to their own queue; analytics are recalculated afterwards.
        await setStage('queueing_media', 85, counters);
        counters.media_queued = await this.media.planForAds(userId, source.account.id, collected.ads.map((ad) => ad.id));
        await this.queues.enqueueAnalytics({ userId, adIds: collected.ads.map((ad) => ad.id) });
      }

      const status = outcomeFor(errors);
      await this.runs.update(runId, {
        status, stage: 'done', progress: 100, counters, errors: errors.map((message) => ({ message })), finished_at: new Date().toISOString(),
      });
      return { status, errors };
    } catch (error) {
      if (source.isAuthFailure(error)) await source.noteFailure(error);
      throw error;
    }
  }

  /** Re-fetch insights for a fixed set of ads over a new range. */
  async refreshInsights(runId: string, userId: string, adIds: string[], dateFrom: string, dateTo: string): Promise<RunOutcome> {
    const run = await this.runs.get(userId, runId);
    const source = await this.openSource(userId, run.ad_account_id as string);
    await this.runs.update(runId, { status: 'running', started_at: new Date().toISOString(), stage: 'insights', progress: 5 });
    const ads = await this.insights.loadInsightAds(userId, adIds);
    const errors = await source.collectInsights(
      ads,
      dateFrom,
      dateTo,
      (done, total, label) => this.runs.update(runId, { stage: `insights: ${label}`, progress: 5 + Math.round((done / total) * 90) }),
    );
    await this.queues.enqueueAnalytics({ userId, adIds });
    const status = outcomeFor(errors);
    await this.runs.update(runId, {
      status, stage: 'done', progress: 100, counters: { ads_found: ads.length }, errors: errors.map((message) => ({ message })), finished_at: new Date().toISOString(),
    });
    return { status, errors };
  }

  /** Terminal failure after all retries. Returns the run (for the schedule bookkeeping) or `null` if it vanished. */
  fail(runId: string, userId: string, errorMessage: string): Promise<CollectionRunRow | null> {
    return this.runs.markFailed(userId, runId, errorMessage);
  }
}
