import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import { AdAccountRow, MetaLibraryAd } from '../common/types';
import { MetaApiClient, MetaApiError, MetaContext } from '../meta/meta-api.client';
import { CollectAdsResult, normalizeKeywordList, nullIfBlank, upsertAndMapIds } from './ad-collector.service';

/** Library ads share the `ads.meta_ad_id` column; the prefix keeps them apart from ads of your own accounts. */
export const LIBRARY_ID_PREFIX = 'adlib:';

export const isLibraryAdId = (metaAdId: string): boolean => metaAdId.startsWith(LIBRARY_ID_PREFIX);

/** Where Meta explains how to get Ad Library API access (error 10 until the user completes it). */
export const AD_LIBRARY_ACCESS_URL = 'facebook.com/ads/library/api';

/** Non-fatal run message for a failed Ad Library search, with the fix when Meta has not granted access. */
export function describeLibraryFailure(error: unknown): string {
  if (error instanceof MetaApiError && (error.code === 10 || error.isPermission)) {
    return `Meta Ad Library: access not granted (${error.message}). Complete the identity confirmation for your Meta user at ${AD_LIBRARY_ACCESS_URL}, then collect again.`;
  }
  return `Meta Ad Library: ${error instanceof Error ? error.message : String(error)}`;
}

/** Combines two collection results (ads of both, all errors, truncated if either was). */
export const mergeCollectResults = (first: CollectAdsResult, second: CollectAdsResult): CollectAdsResult => ({
  ads: [...first.ads, ...second.ads],
  errors: [...first.errors, ...second.errors],
  truncated: first.truncated || second.truncated,
});

/** Database row for a public Ad Library ad. The advertiser (page) name is searchable through `campaign_name`. No metrics exist for these ads. */
export function buildLibraryAdRow(entry: MetaLibraryAd, context: { userId: string; accountId: string; collectedAt: string }) {
  const stopped = Boolean(nullIfBlank(entry.ad_delivery_stop_time));
  return {
    user_id: context.userId,
    ad_account_id: context.accountId,
    platform: 'meta',
    meta_ad_id: `${LIBRARY_ID_PREFIX}${entry.id}`,
    name: nullIfBlank(entry.page_name) ?? `Library ad ${entry.id}`,
    status: stopped ? 'INACTIVE' : 'ACTIVE',
    effective_status: stopped ? 'INACTIVE' : 'ACTIVE',
    platforms: (entry.publisher_platforms ?? []).map((platform) => platform.toLowerCase()),
    campaign_name: nullIfBlank(entry.page_name),
    headline: nullIfBlank(entry.ad_creative_link_titles?.[0]),
    primary_text: nullIfBlank(entry.ad_creative_bodies?.[0]),
    ad_created_time: nullIfBlank(entry.ad_creation_time ?? entry.ad_delivery_start_time),
    last_collected_at: context.collectedAt,
    raw: entry,
  };
}

/** Adds entries to `found` (tagging the matching keyword) up to `cap` distinct ads; returns true when some were dropped. */
export function rememberLibraryEntries(
  found: Map<string, { entry: MetaLibraryAd; keywords: Set<string> }>,
  entries: MetaLibraryAd[],
  keyword: string,
  cap: number,
): boolean {
  let dropped = false;
  for (const entry of entries) {
    if (!found.has(entry.id) && found.size >= cap) {
      dropped = true;
      continue;
    }
    const known = found.get(entry.id) ?? { entry, keywords: new Set<string>() };
    known.keywords.add(keyword);
    found.set(entry.id, known);
  }
  return dropped;
}

export const AD_LIBRARY_FIELDS =
  'id,page_id,page_name,ad_creation_time,ad_delivery_start_time,ad_delivery_stop_time,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,publisher_platforms,languages';

/** Searches Meta's public Ad Library for the keywords (anyone's ads, no performance data) and stores the matches. */
@Injectable()
export class AdLibraryCollectorService {
  private readonly logger = new Logger(AdLibraryCollectorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly meta: MetaApiClient,
    private readonly config: AppConfig,
  ) {}

  async collect(input: { userId: string; account: Pick<AdAccountRow, 'id'>; context: MetaContext; keywords: string[] }): Promise<CollectAdsResult> {
    const { userId, account, context } = input;
    const found = new Map<string, { entry: MetaLibraryAd; keywords: Set<string> }>();
    let truncated = false;
    try {
      for (const keyword of normalizeKeywordList(input.keywords)) {
        const entries = await this.meta.listAdLibrary(context, {
          search_terms: keyword,
          ad_reached_countries: this.config.adLibraryCountries,
          ad_active_status: 'ALL',
          fields: AD_LIBRARY_FIELDS,
        }, this.config.maxAdsPerRun);
        truncated = rememberLibraryEntries(found, entries, keyword, this.config.maxAdsPerRun) || truncated;
      }
    } catch (error) {
      // Library access is separate from the ad account: a failure must not discard the account's own results.
      const message = describeLibraryFailure(error);
      this.logger.warn(message);
      return { ads: [], errors: [message], truncated };
    }
    if (found.size === 0) return { ads: [], errors: [], truncated };

    const existingIds = new Set<string>();
    for (const externalIds of chunk([...found.keys()].map((id) => `${LIBRARY_ID_PREFIX}${id}`), 200)) {
      const response = await this.supabase.from('ads').select('meta_ad_id').eq('user_id', userId).in('meta_ad_id', externalIds);
      for (const row of must<{ meta_ad_id: string }[]>(response, 'existing library ads')) existingIds.add(row.meta_ad_id);
    }
    const collectedAt = new Date().toISOString();
    const rows = [...found.values()].map(({ entry }) => buildLibraryAdRow(entry, { userId, accountId: account.id, collectedAt }));
    const adIdByExternalId = await upsertAndMapIds(this.supabase, 'ads', 'meta_ad_id', rows);

    const ads = [...found.entries()].map(([id, { keywords }]) => ({
      id: adIdByExternalId.get(`${LIBRARY_ID_PREFIX}${id}`) as string,
      meta_ad_id: `${LIBRARY_ID_PREFIX}${id}`,
      creative_id: null,
      is_new: !existingIds.has(`${LIBRARY_ID_PREFIX}${id}`),
      is_dynamic: false,
      keywords: [...keywords],
    }));
    this.logger.log(`Collected ${ads.length} Ad Library ads (${ads.filter((ad) => ad.is_new).length} new)`);
    return { ads, errors: [], truncated };
  }
}
