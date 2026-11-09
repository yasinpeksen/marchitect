import { Injectable, NotFoundException } from '@nestjs/common';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import {
  AdTotalsRow, BreakdownRow, buildActivitySeries, groupBreakdowns, normalizeDailyRow, rankTopAds, selectReachSnapshot, SnapshotRow,
} from './dashboard';
import { aggregate, BASE_KEYS, DailyRow, derive, fatigue, series } from './metrics';

const POSTGREST_PAGE_SIZE = 1000; // PostgREST max_rows
const MAXIMUM_AD_IDS_PER_RECALCULATION = 200;

type DailyRowWithAd = DailyRow & { ad_id: string };
interface RangeSnapshot extends SnapshotRow {
  frequency: unknown;
  quality_ranking: string | null;
  engagement_rate_ranking: string | null;
  conversion_rate_ranking: string | null;
  collected_at: string;
  currency: string | null;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** All daily rows for the ads in range, paged past PostgREST's row cap. */
  private async fetchDaily(userId: string, adIds: string[], from?: string, to?: string): Promise<DailyRowWithAd[]> {
    const collected: DailyRowWithAd[] = [];
    const columns = ['ad_id', 'date', 'currency', ...BASE_KEYS].join(',');
    for (let offset = 0; ; offset += POSTGREST_PAGE_SIZE) {
      let query = this.supabase
        .from('ad_daily_metrics')
        .select(columns)
        .eq('user_id', userId)
        .in('ad_id', adIds)
        .order('date')
        .range(offset, offset + POSTGREST_PAGE_SIZE - 1);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      const rows = must<Record<string, unknown>[]>(await query, 'daily metrics');
      collected.push(...rows.map((row) => ({ ...normalizeDailyRow(row), ad_id: String(row.ad_id) })));
      if (rows.length < POSTGREST_PAGE_SIZE) return collected;
    }
  }

  /** Full per-ad dashboard payload for a date range (defaults to everything collected). */
  async adDashboard(userId: string, adId: string, from?: string, to?: string) {
    const adResponse = await this.supabase
      .from('ads')
      .select('id,name,format,headline,primary_text,cta,effective_status')
      .eq('id', adId)
      .eq('user_id', userId)
      .maybeSingle();
    const ad = must<Record<string, unknown> | null>(adResponse, 'load ad');
    if (!ad) throw new NotFoundException('Ad not found');

    const allRows = await this.fetchDaily(userId, [adId]);
    const rowsInRange = allRows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
    const firstDataDate = allRows[0]?.date ?? null;
    const lastDataDate = allRows.at(-1)?.date ?? null;

    const snapshots = must<RangeSnapshot[]>(
      await this.supabase
        .from('ad_insights')
        .select('date_start,date_stop,reach,frequency,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,collected_at,currency')
        .eq('ad_id', adId)
        .eq('user_id', userId)
        .order('collected_at', { ascending: false })
        .limit(30),
      'snapshots',
    );
    const reachSnapshot = selectReachSnapshot(snapshots, firstDataDate, lastDataDate, from, to);
    const base = aggregate(rowsInRange, reachSnapshot ? Number(reachSnapshot.reach) : null);
    const latestSnapshot = snapshots[0] ?? null;

    return {
      ad: {
        id: ad.id, name: ad.name, format: ad.format, headline: ad.headline, primary_text: ad.primary_text, cta: ad.cta, status: ad.effective_status,
      },
      range: {
        from: from ?? firstDataDate, to: to ?? lastDataDate, available_from: firstDataDate, available_to: lastDataDate,
        days_with_data: rowsInRange.length,
      },
      currency: (await this.fetchCurrency(userId, adId)) ?? latestSnapshot?.currency ?? null,
      metrics: { ...base, ...derive(base) },
      reach_note: reachSnapshot
        ? null
        : 'Unique reach/frequency is only reported when the range covers all collected data; it cannot be summed from daily values.',
      rankings: latestSnapshot
        ? {
            quality: latestSnapshot.quality_ranking,
            engagement: latestSnapshot.engagement_rate_ranking,
            conversion: latestSnapshot.conversion_rate_ranking,
            as_of: latestSnapshot.collected_at,
          }
        : null,
      daily: series(rowsInRange),
      fatigue: fatigue(rowsInRange),
      breakdowns: await this.breakdowns(userId, adId),
    };
  }

  private async fetchCurrency(userId: string, adId: string): Promise<string | null> {
    const response = await this.supabase
      .from('ad_daily_metrics')
      .select('currency')
      .eq('user_id', userId)
      .eq('ad_id', adId)
      .not('currency', 'is', null)
      .limit(1);
    return must<{ currency: string }[]>(response, 'currency')[0]?.currency ?? null;
  }

  private async breakdowns(userId: string, adId: string) {
    const rows: BreakdownRow[] = [];
    for (let offset = 0; ; offset += POSTGREST_PAGE_SIZE) {
      const page = must<BreakdownRow[]>(
        await this.supabase
          .from('ad_breakdowns')
          .select('*')
          .eq('user_id', userId)
          .eq('ad_id', adId)
          .order('collected_at', { ascending: false })
          .range(offset, offset + POSTGREST_PAGE_SIZE - 1),
        'breakdowns',
      );
      rows.push(...page);
      if (page.length < POSTGREST_PAGE_SIZE) break;
    }
    return groupBreakdowns(rows);
  }

  /** Recompute and cache lifetime analytics for ads (called by the analytics job). */
  async recalculate(userId: string, adIds: string[]): Promise<number> {
    const targetIds = adIds.slice(0, MAXIMUM_AD_IDS_PER_RECALCULATION);
    if (targetIds.length === 0) return 0;
    await this.supabase.rpc('refresh_ad_totals', { p_ad_ids: targetIds });
    let recalculated = 0;
    for (const group of chunk(targetIds, 25)) {
      const rowsByAd = new Map<string, DailyRow[]>();
      for (const row of await this.fetchDaily(userId, group)) rowsByAd.set(row.ad_id, [...(rowsByAd.get(row.ad_id) ?? []), row]);
      const upserts = [...rowsByAd.entries()].map(([adId, dailyRows]) => {
        const base = aggregate(dailyRows);
        return {
          user_id: userId,
          ad_id: adId,
          range_key: 'lifetime',
          date_from: dailyRows[0]?.date ?? null,
          date_to: dailyRows.at(-1)?.date ?? null,
          metrics: { ...base, ...derive(base), fatigue: fatigue(dailyRows) },
          computed_at: new Date().toISOString(),
        };
      });
      if (upserts.length > 0) must(await this.supabase.from('analytics').upsert(upserts, { onConflict: 'ad_id,range_key' }), 'save analytics');
      recalculated += upserts.length;
    }
    return recalculated;
  }

  async overview(userId: string) {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const [ads, savedSearches, activeSchedules, allSchedules, recentAds, recentRuns, topCandidates, dailyTotals, runningRuns] = await Promise.all([
      this.countOwned(userId, 'ads'),
      this.countOwned(userId, 'saved_searches'),
      this.countOwned(userId, 'schedules', { column: 'enabled', equals: true }),
      this.countOwned(userId, 'schedules'),
      this.supabase
        .from('ads')
        .select('id,meta_ad_id,name,format,effective_status,campaign_name,total_spend,total_impressions,total_link_clicks,first_seen_at,last_collected_at')
        .eq('user_id', userId)
        .order('first_seen_at', { ascending: false })
        .limit(8),
      this.supabase.from('collection_runs').select('created_at,status,counters').eq('user_id', userId).gte('created_at', since).limit(1000),
      this.supabase
        .from('ads')
        .select('id,name,format,total_spend,total_impressions,total_link_clicks,total_purchases,total_revenue')
        .eq('user_id', userId)
        .gt('total_spend', 0)
        .order('total_spend', { ascending: false })
        .limit(50),
      this.supabase.rpc('daily_totals', { p_user_id: userId, p_days: 30 }),
      this.countOwned(userId, 'collection_runs', { column: 'status', isIn: ['queued', 'running'] }),
    ]);

    const performance = must<Record<string, unknown>[]>(dailyTotals, 'daily totals').map((day) => {
      const dayRow: DailyRow = normalizeDailyRow({ ...day, date: day.date });
      const base = aggregate([dayRow]);
      return { date: dayRow.date, spend: base.spend, impressions: base.impressions, link_clicks: base.link_clicks, ...derive(base) };
    });

    return {
      totals: {
        ads: ads.count ?? 0,
        saved_searches: savedSearches.count ?? 0,
        scheduled_searches: activeSchedules.count ?? 0,
        schedules_total: allSchedules.count ?? 0,
        active_collections: runningRuns.count ?? 0,
      },
      recent_ads: must(recentAds, 'recent ads'),
      activity: buildActivitySeries(must(recentRuns, 'runs'), 14),
      top_ads: rankTopAds(must<AdTotalsRow[]>(topCandidates, 'top ads')),
      performance,
    };
  }

  /** Number of the user's rows in `table`, optionally narrowed by one equality / membership filter. */
  async countOwned(userId: string, table: string, filter?: { column: string; equals?: unknown; isIn?: unknown[] }): Promise<{ count: number | null }> {
    let query = this.supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (filter?.equals !== undefined) query = query.eq(filter.column, filter.equals);
    if (filter?.isIn) query = query.in(filter.column, filter.isIn);
    return query;
  }
}
