import { Injectable, Logger } from '@nestjs/common';
import { AdCollectorService } from '../advertisements/ad-collector.service';
import { CollectionRunRow } from '../common/types';
import { InsightsService } from '../insights/insights.service';
import { MediaService } from '../media/media.service';
import { MetaApiError } from '../meta/meta-api.client';
import { MetaConnectionsService } from '../meta/meta-connections.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { QueueService } from './queues';

export type RunOutcome = { status: 'succeeded' | 'partial'; errors: string[] };

/** `partial` when anything non-fatal went wrong, otherwise `succeeded`. */
export const outcomeFor = (errors: string[]): RunOutcome['status'] => (errors.length > 0 ? 'partial' : 'succeeded');

/** Executes a collection run end to end and keeps `collection_runs` progress current. */
@Injectable()
export class CollectionOrchestrator {
  private readonly logger = new Logger(CollectionOrchestrator.name);

  constructor(
    private readonly runs: CollectionRunsService,
    private readonly connections: MetaConnectionsService,
    private readonly collector: AdCollectorService,
    private readonly insights: InsightsService,
    private readonly media: MediaService,
    private readonly queues: QueueService,
  ) {}

  async execute(runId: string, userId: string): Promise<RunOutcome> {
    const run = await this.runs.get(userId, runId);
    const { account, context } = await this.connections.contextForAccount(userId, run.ad_account_id as string);
    const errors: string[] = [];
    const setStage = (stage: string, progress: number, counters?: Record<string, unknown>) =>
      this.runs.update(runId, { stage, progress, ...(counters ? { counters } : {}) });

    await this.runs.update(runId, { status: 'running', started_at: new Date().toISOString(), stage: 'searching_meta', progress: 5, error: null });

    try {
      // Step 3: matching ads from Meta (campaign / ad set / creative hierarchy persisted as they arrive).
      const collected = await this.collector.collect({ userId, account, context, keywords: run.keywords });
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
        const insightErrors = await this.insights.collect({
          userId,
          metaAccountId: account.meta_account_id,
          context,
          ads: collected.ads,
          dateFrom: run.date_from as string,
          dateTo: run.date_to as string,
          onProgress: (done, total, label) => setStage(`insights: ${label}`, 30 + Math.round((done / total) * 50), counters),
        });
        errors.push(...insightErrors);

        // Step 6: media downloads go to their own queue; analytics are recalculated afterwards.
        await setStage('queueing_media', 85, counters);
        counters.media_queued = await this.media.planForAds(userId, account.id, collected.ads.map((ad) => ad.id));
        await this.queues.enqueueAnalytics({ userId, adIds: collected.ads.map((ad) => ad.id) });
      }

      const status = outcomeFor(errors);
      await this.runs.update(runId, {
        status, stage: 'done', progress: 100, counters, errors: errors.map((message) => ({ message })), finished_at: new Date().toISOString(),
      });
      return { status, errors };
    } catch (error) {
      if (error instanceof MetaApiError && error.isAuth) await this.connections.noteFailure(account.connection_id, error);
      throw error;
    }
  }

  /** Re-fetch insights for a fixed set of ads over a new range. */
  async refreshInsights(runId: string, userId: string, adIds: string[], dateFrom: string, dateTo: string): Promise<RunOutcome> {
    const run = await this.runs.get(userId, runId);
    const { account, context } = await this.connections.contextForAccount(userId, run.ad_account_id as string);
    await this.runs.update(runId, { status: 'running', started_at: new Date().toISOString(), stage: 'insights', progress: 5 });
    const ads = await this.insights.loadInsightAds(userId, adIds);
    const errors = await this.insights.collect({
      userId,
      metaAccountId: account.meta_account_id,
      context,
      ads,
      dateFrom,
      dateTo,
      onProgress: (done, total, label) => this.runs.update(runId, { stage: `insights: ${label}`, progress: 5 + Math.round((done / total) * 90) }),
    });
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
