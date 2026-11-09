import { Injectable, Logger } from '@nestjs/common';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import { InsightAd } from '../insights/insights.service';
import { TikTokApiClient, TikTokApiError, TikTokContext, TikTokParameters } from './tiktok-api.client';
import { parseTikTokReportRow, splitDateRange, stripTikTokPrefix, TIKTOK_REPORT_METRICS } from './tiktok-mappers';

const AD_BATCH = 100;
/** TikTok limits day-level reports to 30 days per request. */
const DAILY_REPORT_MAX_DAYS = 30;

/** `ad_ids IN [...]` clause of the report API (the value is a JSON string). */
export const buildAdIdsFilter = (adIds: string[]) => [{ field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify(adIds) }];

/** Daily metrics and a range snapshot for TikTok ads. Breakdowns are not collected for TikTok. */
@Injectable()
export class TikTokInsightsService {
  private readonly logger = new Logger(TikTokInsightsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly tiktok: TikTokApiClient,
  ) {}

  /** Returns non-fatal error messages; auth and permission failures are thrown. */
  async collect(input: {
    userId: string;
    advertiserId: string;
    context: TikTokContext;
    currency: string | null;
    ads: InsightAd[];
    dateFrom: string;
    dateTo: string;
    onProgress?: (done: number, total: number, label: string) => Promise<void> | void;
  }): Promise<string[]> {
    const { userId, advertiserId, context, currency, ads, dateFrom, dateTo } = input;
    const errors: string[] = [];
    if (ads.length === 0) return errors;

    const adByTikTokId = new Map(ads.map((ad) => [stripTikTokPrefix(ad.meta_ad_id), ad]));
    const totalSteps = 2;
    let completedSteps = 0;
    const baseParameters = (batch: InsightAd[]): TikTokParameters => ({
      advertiser_id: advertiserId,
      metrics: TIKTOK_REPORT_METRICS,
      filtering: buildAdIdsFilter(batch.map((ad) => stripTikTokPrefix(ad.meta_ad_id))),
    });

    const guarded = async (label: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        if (error instanceof TikTokApiError && (error.isAuth || error.isPermission)) throw error;
        const message = `${label}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.warn(message);
        errors.push(message);
      }
      await input.onProgress?.(++completedSteps, totalSteps, label);
    };

    await guarded('daily insights', async () => {
      for (const dateWindow of splitDateRange(dateFrom, dateTo, DAILY_REPORT_MAX_DAYS)) {
        for (const batch of chunk(ads, AD_BATCH)) {
          const rows = await this.tiktok.report(context, { ...baseParameters(batch), dimensions: ['ad_id', 'stat_time_day'], start_date: dateWindow.start, end_date: dateWindow.end });
          const records = rows.flatMap((row) => {
            const ad = adByTikTokId.get(row.dimensions.ad_id);
            if (!ad || !row.dimensions.stat_time_day) return [];
            return [{ user_id: userId, ad_id: ad.id, date: row.dimensions.stat_time_day.slice(0, 10), currency, ...parseTikTokReportRow(row), raw: row }];
          });
          for (const group of chunk(records, 500)) must(await this.supabase.from('ad_daily_metrics').upsert(group, { onConflict: 'ad_id,date' }), 'upsert daily metrics');
        }
      }
    });

    // Unique reach over the whole range cannot be summed from daily rows, so it comes from a range-level report.
    await guarded('range insights', async () => {
      for (const batch of chunk(ads, AD_BATCH)) {
        const rows = await this.tiktok.report(context, { ...baseParameters(batch), dimensions: ['ad_id'], start_date: dateFrom, end_date: dateTo });
        const records = rows.flatMap((row) => {
          const ad = adByTikTokId.get(row.dimensions.ad_id);
          if (!ad) return [];
          return [{
            user_id: userId,
            ad_id: ad.id,
            date_start: dateFrom,
            date_stop: dateTo,
            snapshot_date: new Date().toISOString().slice(0, 10),
            currency,
            ...parseTikTokReportRow(row),
            raw: row,
            collected_at: new Date().toISOString(),
          }];
        });
        for (const group of chunk(records, 500)) {
          must(await this.supabase.from('ad_insights').upsert(group, { onConflict: 'ad_id,date_start,date_stop,snapshot_date' }), 'upsert insights');
        }
      }
    });

    must(await this.supabase.rpc('refresh_ad_totals', { p_ad_ids: ads.map((ad) => ad.id) }), 'refresh totals');
    return errors;
  }
}
