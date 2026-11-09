import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import { AdAccountRow, MetaAd, MetaAdSet, MetaCampaign } from '../common/types';
import { ADSET_FIELDS, CAMPAIGN_FIELDS, MetaApiClient, MetaApiError, MetaContext } from '../meta/meta-api.client';
import { mapCreative, MappedCreative } from './creative-mapper';

export interface CollectedAd {
  id: string; // internal uuid
  meta_ad_id: string;
  creative_id: string | null;
  is_new: boolean;
  is_dynamic: boolean;
  keywords: string[];
}

export interface CollectAdsResult {
  ads: CollectedAd[];
  errors: string[];
  truncated: boolean;
}

export const nullIfBlank = <Value>(value: Value | '' | undefined | null): Value | null =>
  value === undefined || value === null || value === '' ? null : value;

export const toNullableNumber = (value: unknown): number | null => (nullIfBlank(value) === null ? null : Number(value));

/** Meta `filtering` clause: field contains text. */
export const buildContainFilter = (field: string, text: string) => [{ field, operator: 'CONTAIN', value: text }];

/** Meta `filtering` clause: field is one of values. */
export const buildInFilter = (field: string, values: string[]) => [{ field, operator: 'IN', value: values }];

/** Lower-cased, trimmed, de-duplicated keywords with blanks removed. */
export const normalizeKeywordList = (keywords: string[]): string[] => [
  ...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)),
];

interface AdRowContext {
  userId: string;
  accountId: string;
  campaignId: string | null;
  adSetId: string | null;
  creativeId: string | null;
  mappedCreative?: MappedCreative;
  campaign?: MetaCampaign;
  adSet?: MetaAdSet;
  collectedAt: string;
}

/** Database row for an ad, denormalising names/copy from its campaign, ad set and creative for search. */
export function buildAdRow(ad: MetaAd, context: AdRowContext) {
  return {
    user_id: context.userId,
    ad_account_id: context.accountId,
    campaign_id: context.campaignId,
    ad_set_id: context.adSetId,
    creative_id: context.creativeId,
    meta_ad_id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
    format: context.mappedCreative?.format ?? null,
    platforms: context.adSet?.targeting?.publisher_platforms ?? null,
    campaign_name: context.campaign?.name ?? null,
    ad_set_name: context.adSet?.name ?? null,
    headline: context.mappedCreative?.title ?? null,
    primary_text: context.mappedCreative?.body ?? null,
    cta: context.mappedCreative?.call_to_action_type ?? null,
    ad_created_time: nullIfBlank(ad.created_time),
    ad_updated_time: nullIfBlank(ad.updated_time),
    last_collected_at: context.collectedAt,
    raw: ad,
  };
}

/** Step 3 of a search: find matching ads in the authorised ad account and persist the hierarchy. */
@Injectable()
export class AdCollectorService {
  private readonly logger = new Logger(AdCollectorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly meta: MetaApiClient,
    private readonly config: AppConfig,
  ) {}

  async collect(input: {
    userId: string;
    account: Pick<AdAccountRow, 'id' | 'meta_account_id'>;
    context: MetaContext;
    keywords: string[];
  }): Promise<CollectAdsResult> {
    const { userId, account, context } = input;
    const metaAccountId = account.meta_account_id;
    const keywords = normalizeKeywordList(input.keywords);
    const errors: string[] = [];
    const found = new Map<string, { ad: MetaAd; keywords: Set<string> }>();
    let truncated = false;

    const remember = (ads: MetaAd[], keyword: string) => {
      for (const ad of ads) {
        if (!found.has(ad.id)) {
          if (found.size >= this.config.maxAdsPerRun) {
            truncated = true;
            continue;
          }
          found.set(ad.id, { ad, keywords: new Set() });
        }
        found.get(ad.id)?.keywords.add(keyword);
      }
    };

    for (const keyword of keywords) {
      try {
        // 1) ads whose own name matches
        remember(await this.meta.listAds(context, metaAccountId, { filtering: buildContainFilter('name', keyword) }, this.config.maxAdsPerRun), keyword);

        // 2) ads under campaigns / ad sets whose name matches
        const [campaigns, adSets] = await Promise.all([
          this.meta.getAll<{ id: string }>(context, `${metaAccountId}/campaigns`, { fields: 'id', filtering: buildContainFilter('name', keyword) }, 500),
          this.meta.getAll<{ id: string }>(context, `${metaAccountId}/adsets`, { fields: 'id', filtering: buildContainFilter('name', keyword) }, 500),
        ]);
        for (const campaignIds of chunk(campaigns.map((campaign) => campaign.id), 50)) {
          remember(await this.meta.listAds(context, metaAccountId, { filtering: buildInFilter('campaign.id', campaignIds) }, this.config.maxAdsPerRun), keyword);
        }
        for (const adSetIds of chunk(adSets.map((adSet) => adSet.id), 50)) {
          remember(await this.meta.listAds(context, metaAccountId, { filtering: buildInFilter('adset.id', adSetIds) }, this.config.maxAdsPerRun), keyword);
        }
      } catch (error) {
        if (error instanceof MetaApiError && (error.isAuth || error.isPermission)) throw error; // fatal for the whole run
        errors.push(`Keyword "${keyword}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (truncated) errors.push(`Result capped at ${this.config.maxAdsPerRun} ads (MAX_ADS_PER_RUN).`);
    if (found.size === 0) return { ads: [], errors, truncated };

    // Campaign / ad set details (names, objective, targeting) via multi-id reads.
    const matchedAds = [...found.values()].map((entry) => entry.ad);
    const campaignIds = [...new Set(matchedAds.map((ad) => ad.campaign_id).filter((id): id is string => Boolean(id)))];
    const adSetIds = [...new Set(matchedAds.map((ad) => ad.adset_id).filter((id): id is string => Boolean(id)))];
    const campaigns = await this.readMany<MetaCampaign>(context, campaignIds, CAMPAIGN_FIELDS);
    const adSets = await this.readMany<MetaAdSet>(context, adSetIds, ADSET_FIELDS);

    const campaignIdByMetaId = await this.upsertAndMapIds(
      'campaigns',
      'meta_campaign_id',
      Object.values(campaigns).map((campaign) => ({
        user_id: userId,
        ad_account_id: account.id,
        meta_campaign_id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
        effective_status: campaign.effective_status,
        buying_type: campaign.buying_type,
        daily_budget: toNullableNumber(campaign.daily_budget),
        lifetime_budget: toNullableNumber(campaign.lifetime_budget),
        start_time: nullIfBlank(campaign.start_time),
        stop_time: nullIfBlank(campaign.stop_time),
        raw: campaign,
      })),
    );
    const adSetIdByMetaId = await this.upsertAndMapIds(
      'ad_sets',
      'meta_adset_id',
      Object.values(adSets).map((adSet) => ({
        user_id: userId,
        ad_account_id: account.id,
        campaign_id: adSet.campaign_id ? campaignIdByMetaId.get(adSet.campaign_id) ?? null : null,
        meta_adset_id: adSet.id,
        name: adSet.name,
        status: adSet.status,
        effective_status: adSet.effective_status,
        optimization_goal: adSet.optimization_goal,
        billing_event: adSet.billing_event,
        daily_budget: toNullableNumber(adSet.daily_budget),
        lifetime_budget: toNullableNumber(adSet.lifetime_budget),
        start_time: nullIfBlank(adSet.start_time),
        end_time: nullIfBlank(adSet.end_time),
        targeting: adSet.targeting ?? null,
        raw: adSet,
      })),
    );

    const mappedCreatives = new Map<string, MappedCreative>();
    for (const ad of matchedAds) if (ad.creative?.id) mappedCreatives.set(ad.creative.id, mapCreative(ad.creative));
    const creativeIdByMetaId = await this.upsertAndMapIds(
      'ad_creatives',
      'meta_creative_id',
      [...mappedCreatives.values()].map((creative) => ({ user_id: userId, ad_account_id: account.id, ...creative, raw: null })),
    );

    // Which ads already exist (for new-vs-updated accounting).
    const existingMetaIds = new Set<string>();
    for (const metaIds of chunk([...found.keys()], 200)) {
      const response = await this.supabase.from('ads').select('meta_ad_id').eq('user_id', userId).in('meta_ad_id', metaIds);
      for (const row of must<{ meta_ad_id: string }[]>(response, 'existing ads')) existingMetaIds.add(row.meta_ad_id);
    }

    const collectedAt = new Date().toISOString();
    const rows = matchedAds.map((ad) =>
      buildAdRow(ad, {
        userId,
        accountId: account.id,
        campaignId: ad.campaign_id ? campaignIdByMetaId.get(ad.campaign_id) ?? null : null,
        adSetId: ad.adset_id ? adSetIdByMetaId.get(ad.adset_id) ?? null : null,
        creativeId: ad.creative?.id ? creativeIdByMetaId.get(ad.creative.id) ?? null : null,
        mappedCreative: ad.creative?.id ? mappedCreatives.get(ad.creative.id) : undefined,
        campaign: ad.campaign_id ? campaigns[ad.campaign_id] : undefined,
        adSet: ad.adset_id ? adSets[ad.adset_id] : undefined,
        collectedAt,
      }),
    );
    const adIdByMetaId = await this.upsertAndMapIds('ads', 'meta_ad_id', rows);

    const ads: CollectedAd[] = [...found.entries()].map(([metaAdId, entry]) => ({
      id: adIdByMetaId.get(metaAdId) as string,
      meta_ad_id: metaAdId,
      creative_id: entry.ad.creative?.id ? creativeIdByMetaId.get(entry.ad.creative.id) ?? null : null,
      is_new: !existingMetaIds.has(metaAdId),
      is_dynamic: entry.ad.creative?.id ? mappedCreatives.get(entry.ad.creative.id)?.format === 'dynamic' : false,
      keywords: [...entry.keywords],
    }));
    this.logger.log(`Collected ${ads.length} ads (${ads.filter((ad) => ad.is_new).length} new) for ${metaAccountId}`);
    return { ads, errors, truncated };
  }

  private async readMany<Item>(context: MetaContext, ids: string[], fields: string): Promise<Record<string, Item>> {
    const merged: Record<string, Item> = {};
    for (const part of chunk(ids, 50)) Object.assign(merged, await this.meta.getMany<Item>(context, part, fields));
    return merged;
  }

  /** Batched upsert; returns metaId -> internal uuid. */
  private async upsertAndMapIds(table: string, metaColumn: string, rows: Record<string, unknown>[]): Promise<Map<string, string>> {
    const idByMetaId = new Map<string, string>();
    for (const part of chunk(rows, 300)) {
      const response = await this.supabase.from(table).upsert(part, { onConflict: `user_id,${metaColumn}` }).select(`id,${metaColumn}`);
      for (const row of must<Record<string, string>[]>(response, `upsert ${table}`)) idByMetaId.set(row[metaColumn], row.id);
    }
    return idByMetaId;
  }
}
