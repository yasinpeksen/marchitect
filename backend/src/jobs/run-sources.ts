import { Injectable } from '@nestjs/common';
import { AdCollectorService, CollectAdsResult } from '../advertisements/ad-collector.service';
import { AdAccountRow } from '../common/types';
import { InsightAd, InsightsService } from '../insights/insights.service';
import { MetaApiError } from '../meta/meta-api.client';
import { MetaConnectionsService } from '../meta/meta-connections.service';
import { TikTokApiError } from '../tiktok/tiktok-api.client';
import { TikTokCollectorService } from '../tiktok/tiktok-collector.service';
import { TikTokConnectionsService } from '../tiktok/tiktok-connections.service';
import { TikTokInsightsService } from '../tiktok/tiktok-insights.service';

export type InsightsProgress = (done: number, total: number, label: string) => Promise<void> | void;

/** What the collection pipeline needs from one ad platform (Meta or TikTok) for one ad account. */
export interface RunSource {
  /** Run stage shown while ads are being searched. */
  searchStage: string;
  account: Pick<AdAccountRow, 'id'>;
  collect(keywords: string[]): Promise<CollectAdsResult>;
  collectInsights(ads: InsightAd[], dateFrom: string, dateTo: string, onProgress: InsightsProgress): Promise<string[]>;
  /** Records the failure on the connection (and marks it expired when the token is dead). */
  noteFailure(error: unknown): Promise<void>;
  /** True for errors that mean the token itself is invalid. */
  isAuthFailure(error: unknown): boolean;
}

@Injectable()
export class MetaRunSourceFactory {
  constructor(
    private readonly connections: MetaConnectionsService,
    private readonly collector: AdCollectorService,
    private readonly insights: InsightsService,
  ) {}

  async open(userId: string, adAccountId: string): Promise<RunSource> {
    const { account, context } = await this.connections.contextForAccount(userId, adAccountId);
    return {
      searchStage: 'searching_meta',
      account,
      collect: (keywords) => this.collector.collect({ userId, account, context, keywords }),
      collectInsights: (ads, dateFrom, dateTo, onProgress) =>
        this.insights.collect({ userId, metaAccountId: account.meta_account_id, context, ads, dateFrom, dateTo, onProgress }),
      noteFailure: (error) => this.connections.noteFailure(account.connection_id, error),
      isAuthFailure: (error) => error instanceof MetaApiError && error.isAuth,
    };
  }
}

@Injectable()
export class TikTokRunSourceFactory {
  constructor(
    private readonly connections: TikTokConnectionsService,
    private readonly collector: TikTokCollectorService,
    private readonly insights: TikTokInsightsService,
  ) {}

  async open(userId: string, adAccountId: string): Promise<RunSource> {
    const { account, advertiserId, context } = await this.connections.contextForAccount(userId, adAccountId);
    return {
      searchStage: 'searching_tiktok',
      account,
      collect: (keywords) => this.collector.collect({ userId, account, advertiserId, context, keywords }),
      collectInsights: (ads, dateFrom, dateTo, onProgress) =>
        this.insights.collect({ userId, advertiserId, context, currency: account.currency, ads, dateFrom, dateTo, onProgress }),
      noteFailure: (error) => this.connections.noteFailure(account.connection_id, error),
      isAuthFailure: (error) => error instanceof TikTokApiError && error.isAuth,
    };
  }
}
