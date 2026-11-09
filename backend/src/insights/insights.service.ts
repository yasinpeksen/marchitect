import { Injectable, Logger } from '@nestjs/common';
import { BaseMetrics } from '../analytics/metrics';
import { INSIGHT_METRIC_FIELDS, parseInsightRow, RANKING_FIELDS } from '../analytics/parse-insights';
import { AppConfig } from '../common/app-config';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import { CreativeRow, MetaInsightRow } from '../common/types';
import { MetaApiClient, MetaApiError, MetaContext, RequestParameters } from '../meta/meta-api.client';

export interface InsightAd {
  id: string;
  meta_ad_id: string;
  is_dynamic: boolean;
}

/** Meta breakdown definitions. Dynamic-creative asset breakdowns cannot be combined, so one call each. */
export const BREAKDOWNS: { type: string; fields: string[]; dynamicOnly?: boolean }[] = [
  { type: 'age_gender', fields: ['age', 'gender'] },
  { type: 'country', fields: ['country'] },
  { type: 'placement', fields: ['publisher_platform', 'platform_position'] },
  { type: 'device', fields: ['impression_device'] },
  ...['image_asset', 'video_asset', 'body_asset', 'title_asset', 'description_asset', 'link_url_asset', 'call_to_action_asset'].map(
    (field) => ({ type: field, fields: [field], dynamicOnly: true }),
  ),
];

const BREAKDOWN_FIELDS = [
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'outbound_clicks', 'actions',
  'action_values', 'video_thruplay_watched_actions', 'account_currency',
];

const BREAKDOWN_COLUMNS: (keyof BaseMetrics)[] = [
  'spend', 'impressions', 'reach', 'clicks', 'link_clicks', 'outbound_clicks', 'installs',
  'registrations', 'trials', 'purchases', 'revenue', 'video_3s_views', 'video_thruplays',
];

/** Subset of `metrics` restricted to `keys`. */
export const pickMetrics = (metrics: BaseMetrics, keys: (keyof BaseMetrics)[]): Partial<BaseMetrics> =>
  Object.fromEntries(keys.map((key) => [key, metrics[key]]));

/** Inclusive number of days between two YYYY-MM-DD dates. */
export const daysBetweenInclusive = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** Stable key + dimension map for one breakdown row (`25-34|female`, asset ids/hashes for creative assets). */
export function buildBreakdownDimension(row: MetaInsightRow, fields: string[]): { dimKey: string; dimensions: Record<string, unknown> } {
  const dimensions: Record<string, unknown> = {};
  const keyParts: string[] = [];
  for (const field of fields) {
    const value = row[field];
    dimensions[field] = value;
    if (value !== null && typeof value === 'object') {
      const asset = value as { id?: unknown; hash?: unknown; url?: unknown };
      keyParts.push(String(asset.id ?? asset.hash ?? asset.url ?? JSON.stringify(value)));
    } else {
      keyParts.push(String(value ?? 'unknown'));
    }
  }
  return { dimKey: keyParts.join('|'), dimensions };
}

/** Groups ad ids by identical platform set so each distinct set needs one update. */
export function groupAdsByPlatformSet(platformsByAd: Map<string, Set<string>>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [adId, platforms] of platformsByAd) {
    const key = [...platforms].sort().join(',');
    groups.set(key, [...(groups.get(key) ?? []), adId]);
  }
  return groups;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly meta: MetaApiClient,
    private readonly config: AppConfig,
  ) {}

  /** Ads (with their dynamic-creative flag) the insights collector needs for the given internal ids. */
  async loadInsightAds(userId: string, adIds: string[]): Promise<InsightAd[]> {
    const rows = must<{ id: string; meta_ad_id: string; ad_creatives: Pick<CreativeRow, 'asset_feed_spec'> | null }[]>(
      await this.supabase.from('ads').select('id,meta_ad_id,ad_creatives(asset_feed_spec)').eq('user_id', userId).in('id', adIds),
      'load ads',
    );
    return rows.map((row) => ({ id: row.id, meta_ad_id: row.meta_ad_id, is_dynamic: Boolean(row.ad_creatives?.asset_feed_spec) }));
  }

  /** Large ranges or many ads go through Meta's asynchronous report runs. */
  shouldUseAsyncReports(dateFrom: string, dateTo: string, adCount: number): boolean {
    return daysBetweenInclusive(dateFrom, dateTo) >= this.config.asyncInsightsMinDays || adCount >= this.config.asyncInsightsMinAds;
  }

  /** Collects daily metrics, a range snapshot and breakdowns for the given ads. Returns non-fatal errors. */
  async collect(input: {
    userId: string;
    metaAccountId: string;
    context: MetaContext;
    ads: InsightAd[];
    dateFrom: string;
    dateTo: string;
    onProgress?: (done: number, total: number, label: string) => Promise<void> | void;
  }): Promise<string[]> {
    const { userId, ads, dateFrom, dateTo, context, metaAccountId } = input;
    const errors: string[] = [];
    if (ads.length === 0) return errors;

    const adByMetaId = new Map(ads.map((ad) => [ad.meta_ad_id, ad]));
    const useAsync = this.shouldUseAsyncReports(dateFrom, dateTo, ads.length);
    const batchSize = useAsync ? 200 : 50;
    const totalSteps = 2 + BREAKDOWNS.length;
    let completedSteps = 0;
    const reportStep = async (label: string) => input.onProgress?.(++completedSteps, totalSteps, label);

    const fetchInsights = async (adSubset: InsightAd[], extraParameters: RequestParameters): Promise<MetaInsightRow[]> => {
      const parameters: RequestParameters = {
        level: 'ad',
        time_range: { since: dateFrom, until: dateTo },
        filtering: [{ field: 'ad.id', operator: 'IN', value: adSubset.map((ad) => ad.meta_ad_id) }],
        ...extraParameters,
      };
      return useAsync
        ? this.meta.insightsAsync(context, metaAccountId, parameters, this.config.asyncInsightsTimeoutMs)
        : this.meta.insights(context, metaAccountId, { ...parameters, limit: 500 });
    };

    const guarded = async (label: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        if (error instanceof MetaApiError && (error.isAuth || error.isPermission)) throw error;
        const message = `${label}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.warn(message);
        errors.push(message);
      }
      await reportStep(label);
    };

    // 1) Daily metrics
    await guarded('daily insights', async () => {
      for (const batch of chunk(ads, batchSize)) {
        const rows = await fetchInsights(batch, { time_increment: 1, fields: ['ad_id', 'date_start', ...INSIGHT_METRIC_FIELDS].join(',') });
        const records = rows.flatMap((row) => {
          const ad = adByMetaId.get(row.ad_id as string);
          if (!ad) return [];
          return [{ user_id: userId, ad_id: ad.id, date: row.date_start, currency: row.account_currency ?? null, ...parseInsightRow(row), raw: row }];
        });
        for (const group of chunk(records, 500)) {
          must(await this.supabase.from('ad_daily_metrics').upsert(group, { onConflict: 'ad_id,date' }), 'upsert daily metrics');
        }
      }
    });

    // 2) Range snapshot: exact unique reach/frequency and quality rankings. History kept per snapshot day.
    await guarded('range insights', async () => {
      for (const batch of chunk(ads, batchSize)) {
        const rows = await fetchInsights(batch, {
          fields: ['ad_id', 'date_start', 'date_stop', ...INSIGHT_METRIC_FIELDS, ...RANKING_FIELDS].join(','),
        });
        const records = rows.flatMap((row) => {
          const ad = adByMetaId.get(row.ad_id as string);
          if (!ad) return [];
          return [
            {
              user_id: userId,
              ad_id: ad.id,
              date_start: row.date_start,
              date_stop: row.date_stop,
              snapshot_date: new Date().toISOString().slice(0, 10),
              currency: row.account_currency ?? null,
              frequency: row.frequency === undefined ? null : Number(row.frequency),
              quality_ranking: row.quality_ranking ?? null,
              engagement_rate_ranking: row.engagement_rate_ranking ?? null,
              conversion_rate_ranking: row.conversion_rate_ranking ?? null,
              ...parseInsightRow(row),
              raw: row,
              collected_at: new Date().toISOString(),
            },
          ];
        });
        for (const group of chunk(records, 500)) {
          must(await this.supabase.from('ad_insights').upsert(group, { onConflict: 'ad_id,date_start,date_stop,snapshot_date' }), 'upsert insights');
        }
      }
    });

    // 3) Breakdowns
    const platformsByAd = new Map<string, Set<string>>();
    for (const breakdown of BREAKDOWNS) {
      const subset = breakdown.dynamicOnly ? ads.filter((ad) => ad.is_dynamic) : ads;
      if (subset.length === 0) {
        await reportStep(`${breakdown.type} (skipped)`);
        continue;
      }
      await guarded(`breakdown ${breakdown.type}`, async () => {
        for (const batch of chunk(subset, batchSize)) {
          const rows = await fetchInsights(batch, { breakdowns: breakdown.fields.join(','), fields: ['ad_id', ...BREAKDOWN_FIELDS].join(',') });
          const records = rows.flatMap((row) => {
            const ad = adByMetaId.get(row.ad_id as string);
            if (!ad) return [];
            const { dimKey, dimensions } = buildBreakdownDimension(row, breakdown.fields);
            if (breakdown.type === 'placement' && row.publisher_platform) {
              const platforms = platformsByAd.get(ad.id) ?? new Set<string>();
              platforms.add(String(row.publisher_platform));
              platformsByAd.set(ad.id, platforms);
            }
            return [
              {
                user_id: userId,
                ad_id: ad.id,
                breakdown_type: breakdown.type,
                dim_key: dimKey,
                dimensions,
                date_start: dateFrom,
                date_stop: dateTo,
                currency: row.account_currency ?? null,
                ...pickMetrics(parseInsightRow(row), BREAKDOWN_COLUMNS),
                raw: row,
                collected_at: new Date().toISOString(),
              },
            ];
          });
          for (const group of chunk(records, 500)) {
            must(
              await this.supabase.from('ad_breakdowns').upsert(group, { onConflict: 'ad_id,breakdown_type,dim_key,date_start,date_stop' }),
              'upsert breakdowns',
            );
          }
        }
      });
    }

    // Delivery platforms observed in the placement breakdown are the truth for "platform" filtering.
    for (const [platformKey, adIds] of groupAdsByPlatformSet(platformsByAd)) {
      for (const group of chunk(adIds, 200)) {
        await this.supabase.from('ads').update({ platforms: platformKey.split(',') }).in('id', group).eq('user_id', userId);
      }
    }

    must(await this.supabase.rpc('refresh_ad_totals', { p_ad_ids: ads.map((ad) => ad.id) }), 'refresh totals');
    return errors;
  }
}
