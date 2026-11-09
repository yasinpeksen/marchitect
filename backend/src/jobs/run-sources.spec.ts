import { AdCollectorService } from '../advertisements/ad-collector.service';
import { InsightsService } from '../insights/insights.service';
import { MetaApiError } from '../meta/meta-api.client';
import { MetaConnectionsService } from '../meta/meta-connections.service';
import { TikTokApiError } from '../tiktok/tiktok-api.client';
import { TikTokCollectorService } from '../tiktok/tiktok-collector.service';
import { TikTokConnectionsService } from '../tiktok/tiktok-connections.service';
import { TikTokInsightsService } from '../tiktok/tiktok-insights.service';
import { MetaRunSourceFactory, TikTokRunSourceFactory } from './run-sources';

const ads = [{ id: 'ad-1', meta_ad_id: 'm1', is_dynamic: false }];
const progress = jest.fn();

describe('MetaRunSourceFactory', () => {
  const account = { id: 'acc-1', meta_account_id: 'act_1', connection_id: 'conn-1' };
  const build = () => {
    const connections = { contextForAccount: jest.fn().mockResolvedValue({ account, context: { token: 'EAAx' } }), noteFailure: jest.fn().mockResolvedValue(undefined) };
    const collector = { collect: jest.fn().mockResolvedValue({ ads: [], errors: [], truncated: false }) };
    const insights = { collect: jest.fn().mockResolvedValue(['range insights: failed']) };
    const factory = new MetaRunSourceFactory(connections as unknown as MetaConnectionsService, collector as unknown as AdCollectorService, insights as unknown as InsightsService);
    return { connections, collector, insights, factory };
  };

  it('binds collection, insights and failure handling to the Meta account', async () => {
    const { connections, collector, insights, factory } = build();
    const source = await factory.open('u1', 'acc-1');
    expect(connections.contextForAccount).toHaveBeenCalledWith('u1', 'acc-1');
    expect(source).toMatchObject({ searchStage: 'searching_meta', account });

    await source.collect(['a']);
    expect(collector.collect).toHaveBeenCalledWith({ userId: 'u1', account, context: { token: 'EAAx' }, keywords: ['a'] });
    expect(await source.collectInsights(ads, '2026-01-01', '2026-01-31', progress)).toEqual(['range insights: failed']);
    expect(insights.collect).toHaveBeenCalledWith({ userId: 'u1', metaAccountId: 'act_1', context: { token: 'EAAx' }, ads, dateFrom: '2026-01-01', dateTo: '2026-01-31', onProgress: progress });
    await source.noteFailure(new Error('x'));
    expect(connections.noteFailure).toHaveBeenCalledWith('conn-1', expect.any(Error));
  });

  it('treats only Meta auth errors as token failures', async () => {
    const source = await build().factory.open('u1', 'acc-1');
    expect(source.isAuthFailure(new MetaApiError('expired', 401, 190))).toBe(true);
    expect(source.isAuthFailure(new MetaApiError('rate', 400, 17))).toBe(false);
    expect(source.isAuthFailure(new TikTokApiError('expired', 200, 40_105))).toBe(false);
    expect(source.isAuthFailure(new Error('x'))).toBe(false);
  });
});

describe('TikTokRunSourceFactory', () => {
  const account = { id: 'acc-9', meta_account_id: 'tiktok:700', connection_id: 'conn-tt', currency: 'EUR' };
  const build = () => {
    const connections = {
      contextForAccount: jest.fn().mockResolvedValue({ account, advertiserId: '700', context: { token: 'tt' } }), noteFailure: jest.fn().mockResolvedValue(undefined),
    };
    const collector = { collect: jest.fn().mockResolvedValue({ ads: [], errors: [], truncated: false }) };
    const insights = { collect: jest.fn().mockResolvedValue([]) };
    const factory = new TikTokRunSourceFactory(connections as unknown as TikTokConnectionsService, collector as unknown as TikTokCollectorService, insights as unknown as TikTokInsightsService);
    return { connections, collector, insights, factory };
  };

  it('binds collection, insights and failure handling to the TikTok advertiser', async () => {
    const { connections, collector, insights, factory } = build();
    const source = await factory.open('u1', 'acc-9');
    expect(source).toMatchObject({ searchStage: 'searching_tiktok', account });

    await source.collect(['a']);
    expect(collector.collect).toHaveBeenCalledWith({ userId: 'u1', account, advertiserId: '700', context: { token: 'tt' }, keywords: ['a'] });
    await source.collectInsights(ads, '2026-01-01', '2026-01-31', progress);
    expect(insights.collect).toHaveBeenCalledWith({
      userId: 'u1', advertiserId: '700', context: { token: 'tt' }, currency: 'EUR', ads, dateFrom: '2026-01-01', dateTo: '2026-01-31', onProgress: progress,
    });
    await source.noteFailure('boom');
    expect(connections.noteFailure).toHaveBeenCalledWith('conn-tt', 'boom');
  });

  it('treats only TikTok auth errors as token failures', async () => {
    const source = await build().factory.open('u1', 'acc-9');
    expect(source.isAuthFailure(new TikTokApiError('Access token is invalid', 200, 40_105))).toBe(true);
    expect(source.isAuthFailure(new TikTokApiError('Invalid metrics', 200, 40_002))).toBe(false);
    expect(source.isAuthFailure(new MetaApiError('expired', 401, 190))).toBe(false);
  });
});
