import { AD_INDEX } from './fixtures';

export interface InsightRequest {
  adIds: string[];
  since: string;
  until: string;
  timeIncrement?: number;
  breakdowns?: string;
}

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;

export const daysInRange = (since: string, until: string): string[] => {
  const days: string[] = [];
  for (let time = Date.parse(since); time <= Date.parse(until); time += DAY_MS) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
};

/** Per-day base numbers for an ad. Ad 1 declines in CTR (ad fatigue); others are flat. */
export function dailyNumbers(adId: string, dayOffset: number) {
  const adIndex = AD_INDEX[adId] ?? 0;
  const linkClicks = adIndex === 0 ? Math.max(5, 60 - 2 * dayOffset) : 40 - adIndex * 5;
  return {
    spend: 10 + adIndex * 5,
    impressions: 1000 + adIndex * 100,
    linkClicks,
    purchases: 2,
    revenue: 60 + adIndex * 10,
    videoViews: adIndex === 0 ? 400 : 0,
  };
}

const videoMetrics = (adId: string): Row =>
  adId === 'ad_1'
    ? {
        video_thruplay_watched_actions: [{ action_type: 'video_view', value: '150' }],
        video_p25_watched_actions: [{ action_type: 'video_view', value: '300' }],
        video_p50_watched_actions: [{ action_type: 'video_view', value: '200' }],
        video_p75_watched_actions: [{ action_type: 'video_view', value: '150' }],
        video_p100_watched_actions: [{ action_type: 'video_view', value: '100' }],
        video_avg_time_watched_actions: [{ action_type: 'video_view', value: '7.5' }],
      }
    : {};

/** Insight row for explicit totals; every number is a string like the real API. */
function buildRow(adId: string, totals: { spend: number; impressions: number; linkClicks: number; purchases: number; revenue: number; videoViews: number }): Row {
  const actions: Row[] = [
    { action_type: 'link_click', value: String(totals.linkClicks) },
    { action_type: 'omni_purchase', value: String(totals.purchases) },
    { action_type: 'purchase', value: String(totals.purchases) },
  ];
  if (totals.videoViews > 0) actions.push({ action_type: 'video_view', value: String(totals.videoViews) });
  return {
    ad_id: adId,
    account_currency: 'USD',
    spend: totals.spend.toFixed(2),
    impressions: String(totals.impressions),
    clicks: String(totals.linkClicks + 5),
    inline_link_clicks: String(totals.linkClicks),
    outbound_clicks: [{ action_type: 'outbound_click', value: String(Math.round(totals.linkClicks / 2)) }],
    actions,
    action_values: [{ action_type: 'omni_purchase', value: totals.revenue.toFixed(2) }],
    ...videoMetrics(adId),
  };
}

const BREAKDOWN_SLICES: Record<string, { share: number; values: Row }[]> = {
  'age,gender': [
    { share: 0.5, values: { age: '25-34', gender: 'female' } },
    { share: 0.3, values: { age: '35-44', gender: 'male' } },
    { share: 0.2, values: { age: '18-24', gender: 'female' } },
  ],
  country: [{ share: 0.7, values: { country: 'US' } }, { share: 0.3, values: { country: 'CA' } }],
  'publisher_platform,platform_position': [
    { share: 0.6, values: { publisher_platform: 'facebook', platform_position: 'feed' } },
    { share: 0.4, values: { publisher_platform: 'instagram', platform_position: 'story' } },
  ],
  impression_device: [{ share: 0.55, values: { impression_device: 'iphone' } }, { share: 0.45, values: { impression_device: 'android_smartphone' } }],
};

const ASSET_SLICES: Record<string, Row[]> = {
  image_asset: [{ hash: 'h3a', url: 'https://example.test/h3a.jpg' }, { hash: 'h3b', url: 'https://example.test/h3b.jpg' }],
  video_asset: [{ video_id: 'v9', id: 'v9' }],
  body_asset: [{ id: 'b1', text: 'Stay warm' }, { id: 'b2', text: 'Winter is coming' }],
  title_asset: [{ id: 't1', text: 'Winter promo' }],
  description_asset: [{ id: 'd1', text: 'Free shipping' }],
  link_url_asset: [{ website_url: 'https://shop.example.test/winter' }],
  call_to_action_asset: [{ id: 'cta1', name: 'SHOP_NOW' }],
};

/** Totals for an ad over the whole range (sum of the daily numbers). */
export function rangeTotals(adId: string, since: string, until: string) {
  const days = daysInRange(since, until);
  const totals = { spend: 0, impressions: 0, linkClicks: 0, purchases: 0, revenue: 0, videoViews: 0 };
  for (const [offset] of days.entries()) {
    const day = dailyNumbers(adId, offset);
    totals.spend += day.spend;
    totals.impressions += day.impressions;
    totals.linkClicks += day.linkClicks;
    totals.purchases += day.purchases;
    totals.revenue += day.revenue;
    totals.videoViews += day.videoViews;
  }
  return totals;
}

/**
 * Insight rows the way the Marketing API returns them for `level=ad`:
 * daily (time_increment=1), range snapshot (with reach/frequency/rankings), or broken down.
 */
export function buildInsightRows(request: InsightRequest): Row[] {
  const days = daysInRange(request.since, request.until);
  const rows: Row[] = [];
  for (const adId of request.adIds) {
    if (!(adId in AD_INDEX)) continue;
    if (request.timeIncrement === 1) {
      for (const [offset, day] of days.entries()) {
        rows.push({ ...buildRow(adId, dailyNumbers(adId, offset)), date_start: day, date_stop: day });
      }
      continue;
    }
    const totals = rangeTotals(adId, request.since, request.until);
    const range = { date_start: request.since, date_stop: request.until };
    if (!request.breakdowns) {
      const reach = Math.round(totals.impressions * 0.8);
      rows.push({
        ...buildRow(adId, totals), ...range, reach: String(reach), frequency: (totals.impressions / reach).toFixed(4),
        quality_ranking: 'ABOVE_AVERAGE', engagement_rate_ranking: 'AVERAGE', conversion_rate_ranking: 'BELOW_AVERAGE_35',
      });
      continue;
    }
    const slices = BREAKDOWN_SLICES[request.breakdowns];
    if (slices) {
      for (const slice of slices) {
        rows.push({
          ...buildRow(adId, {
            spend: totals.spend * slice.share, impressions: Math.round(totals.impressions * slice.share), linkClicks: Math.round(totals.linkClicks * slice.share),
            purchases: totals.purchases * slice.share, revenue: totals.revenue * slice.share, videoViews: Math.round(totals.videoViews * slice.share),
          }),
          ...slice.values, ...range,
        });
      }
    } else if (ASSET_SLICES[request.breakdowns] && adId === 'ad_3') {
      for (const asset of ASSET_SLICES[request.breakdowns]) {
        rows.push({ ...buildRow(adId, { ...totals, spend: totals.spend / 2 }), [request.breakdowns]: asset, ...range });
      }
    }
  }
  return rows;
}
