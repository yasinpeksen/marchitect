import { Injectable, Logger } from '@nestjs/common';
import { CollectAdsResult, normalizeKeywordList, upsertAndMapIds } from '../advertisements/ad-collector.service';
import { AppConfig } from '../common/app-config';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import { AdAccountRow, TikTokAd, TikTokAdGroup, TikTokCampaign } from '../common/types';
import { TikTokApiClient, TikTokApiError, TikTokContext } from './tiktok-api.client';
import {
  buildTikTokAdGroupRow, buildTikTokAdRow, buildTikTokCampaignRow, mapTikTokCreative, prefixTikTokId, TikTokCreativeColumns, TikTokMediaLookup,
} from './tiktok-mappers';

const FILTER_BATCH = 100;
const FILE_LOOKUP_BATCH = 60;

/** Substring match on a name filter, e.g. `{ ad_name: "sale" }`. */
export const buildNameFilter = (field: 'ad_name' | 'campaign_name' | 'adgroup_name', text: string) => ({ [field]: text });

/** Step 3 of a search for TikTok: find matching ads in the advertiser account and persist the hierarchy. */
@Injectable()
export class TikTokCollectorService {
  private readonly logger = new Logger(TikTokCollectorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly tiktok: TikTokApiClient,
    private readonly config: AppConfig,
  ) {}

  async collect(input: {
    userId: string;
    account: Pick<AdAccountRow, 'id' | 'meta_account_id'>;
    advertiserId: string;
    context: TikTokContext;
    keywords: string[];
  }): Promise<CollectAdsResult> {
    const { userId, account, advertiserId, context } = input;
    const errors: string[] = [];
    const found = new Map<string, { ad: TikTokAd; keywords: Set<string> }>();
    let truncated = false;

    const remember = (ads: TikTokAd[], keyword: string) => {
      for (const ad of ads) {
        if (!found.has(ad.ad_id)) {
          if (found.size >= this.config.maxAdsPerRun) {
            truncated = true;
            continue;
          }
          found.set(ad.ad_id, { ad, keywords: new Set() });
        }
        found.get(ad.ad_id)?.keywords.add(keyword);
      }
    };

    for (const keyword of normalizeKeywordList(input.keywords)) {
      try {
        remember(await this.tiktok.listAds(context, advertiserId, buildNameFilter('ad_name', keyword), this.config.maxAdsPerRun), keyword);
        const [campaigns, adGroups] = await Promise.all([
          this.tiktok.listCampaigns(context, advertiserId, buildNameFilter('campaign_name', keyword), 500),
          this.tiktok.listAdGroups(context, advertiserId, buildNameFilter('adgroup_name', keyword), 500),
        ]);
        for (const campaignIds of chunk(campaigns.map((campaign) => campaign.campaign_id), FILTER_BATCH)) {
          remember(await this.tiktok.listAds(context, advertiserId, { campaign_ids: campaignIds }, this.config.maxAdsPerRun), keyword);
        }
        for (const adGroupIds of chunk(adGroups.map((adGroup) => adGroup.adgroup_id), FILTER_BATCH)) {
          remember(await this.tiktok.listAds(context, advertiserId, { adgroup_ids: adGroupIds }, this.config.maxAdsPerRun), keyword);
        }
      } catch (error) {
        if (error instanceof TikTokApiError && (error.isAuth || error.isPermission)) throw error; // fatal for the whole run
        errors.push(`Keyword "${keyword}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (truncated) errors.push(`Result capped at ${this.config.maxAdsPerRun} ads (MAX_ADS_PER_RUN).`);
    if (found.size === 0) return { ads: [], errors, truncated };

    const matchedAds = [...found.values()].map((entry) => entry.ad);
    const campaigns = await this.loadByIds<TikTokCampaign>(matchedAds.map((ad) => ad.campaign_id), (ids) => this.tiktok.listCampaigns(context, advertiserId, { campaign_ids: ids }), (item) => item.campaign_id);
    const adGroups = await this.loadByIds<TikTokAdGroup>(matchedAds.map((ad) => ad.adgroup_id), (ids) => this.tiktok.listAdGroups(context, advertiserId, { adgroup_ids: ids }), (item) => item.adgroup_id);
    const media = await this.loadMedia(context, advertiserId, matchedAds, errors);

    const base = { userId, accountId: account.id };
    const campaignIdByExternalId = await upsertAndMapIds(this.supabase, 'campaigns', 'meta_campaign_id', [...campaigns.values()].map((campaign) => buildTikTokCampaignRow(campaign, base)));
    const adSetIdByExternalId = await upsertAndMapIds(
      this.supabase,
      'ad_sets',
      'meta_adset_id',
      [...adGroups.values()].map((adGroup) => buildTikTokAdGroupRow(adGroup, { ...base, campaignId: campaignIdByExternalId.get(prefixTikTokId(adGroup.campaign_id ?? '')) ?? null })),
    );

    const creatives = new Map<string, TikTokCreativeColumns>(matchedAds.map((ad) => [ad.ad_id, mapTikTokCreative(ad, media)]));
    const creativeIdByExternalId = await upsertAndMapIds(
      this.supabase,
      'ad_creatives',
      'meta_creative_id',
      [...creatives.values()].map((creative) => ({ user_id: userId, ad_account_id: account.id, ...creative })),
    );

    const existingExternalIds = new Set<string>();
    for (const externalIds of chunk([...found.keys()].map(prefixTikTokId), 200)) {
      const response = await this.supabase.from('ads').select('meta_ad_id').eq('user_id', userId).in('meta_ad_id', externalIds);
      for (const row of must<{ meta_ad_id: string }[]>(response, 'existing ads')) existingExternalIds.add(row.meta_ad_id);
    }

    const collectedAt = new Date().toISOString();
    const rows = matchedAds.map((ad) => {
      const creative = creatives.get(ad.ad_id) as TikTokCreativeColumns;
      return buildTikTokAdRow(ad, {
        userId,
        accountId: account.id,
        campaignId: campaignIdByExternalId.get(prefixTikTokId(ad.campaign_id ?? '')) ?? null,
        adSetId: adSetIdByExternalId.get(prefixTikTokId(ad.adgroup_id ?? '')) ?? null,
        creativeId: creativeIdByExternalId.get(creative.meta_creative_id) ?? null,
        creative,
        campaign: campaigns.get(ad.campaign_id ?? ''),
        adGroup: adGroups.get(ad.adgroup_id ?? ''),
        collectedAt,
      });
    });
    const adIdByExternalId = await upsertAndMapIds(this.supabase, 'ads', 'meta_ad_id', rows);

    const ads = [...found.entries()].map(([adId, entry]) => ({
      id: adIdByExternalId.get(prefixTikTokId(adId)) as string,
      meta_ad_id: prefixTikTokId(adId),
      creative_id: creativeIdByExternalId.get((creatives.get(adId) as TikTokCreativeColumns).meta_creative_id) ?? null,
      is_new: !existingExternalIds.has(prefixTikTokId(adId)),
      is_dynamic: false,
      keywords: [...entry.keywords],
    }));
    this.logger.log(`Collected ${ads.length} TikTok ads (${ads.filter((ad) => ad.is_new).length} new) for advertiser ${advertiserId}`);
    return { ads, errors, truncated };
  }

  /** Reads campaigns / ad groups by id (batched), keyed by their TikTok id. */
  private async loadByIds<Item>(ids: (string | undefined)[], fetchBatch: (ids: string[]) => Promise<Item[]>, keyOf: (item: Item) => string): Promise<Map<string, Item>> {
    const items = new Map<string, Item>();
    const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    for (const batch of chunk(uniqueIds, FILTER_BATCH)) for (const item of await fetchBatch(batch)) items.set(keyOf(item), item);
    return items;
  }

  /** Cover / image URLs for the ads. Failures are non-fatal: the ad is still stored, just without artwork. */
  private async loadMedia(context: TikTokContext, advertiserId: string, ads: TikTokAd[], errors: string[]): Promise<TikTokMediaLookup> {
    const media: TikTokMediaLookup = { videos: new Map(), images: new Map() };
    const videoIds = [...new Set(ads.map((ad) => ad.video_id).filter((id): id is string => Boolean(id)))];
    const imageIds = [...new Set(ads.flatMap((ad) => ad.image_ids ?? []))];
    try {
      for (const batch of chunk(videoIds, FILE_LOOKUP_BATCH)) for (const video of await this.tiktok.videoInfo(context, advertiserId, batch)) media.videos.set(video.video_id, video);
      for (const batch of chunk(imageIds, FILE_LOOKUP_BATCH)) for (const image of await this.tiktok.imageInfo(context, advertiserId, batch)) media.images.set(image.image_id, image);
    } catch (error) {
      if (error instanceof TikTokApiError && (error.isAuth || error.isPermission)) throw error;
      errors.push(`Creative artwork: ${error instanceof Error ? error.message : String(error)}`);
    }
    return media;
  }
}
