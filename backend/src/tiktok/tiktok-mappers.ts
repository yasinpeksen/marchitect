import { BaseMetrics } from '../analytics/metrics';
import { toNumber } from '../analytics/parse-insights';
import { nullIfBlank, toNullableNumber } from '../advertisements/ad-collector.service';
import { CreativeFormat } from '../advertisements/creative-mapper';
import { TikTokAd, TikTokAdGroup, TikTokCampaign, TikTokImageInfo, TikTokReportRow, TikTokVideoInfo } from '../common/types';

/** TikTok ids share the `meta_*_id` columns; the prefix keeps them from ever colliding with Meta ids. */
export const TIKTOK_ID_PREFIX = 'tiktok:';

export const prefixTikTokId = (id: string): string => `${TIKTOK_ID_PREFIX}${id}`;
export const stripTikTokPrefix = (id: string): string => (id.startsWith(TIKTOK_ID_PREFIX) ? id.slice(TIKTOK_ID_PREFIX.length) : id);

/** TikTok operation status -> the Meta-style vocabulary the UI filters on. */
export function mapOperationStatus(operationStatus: string | undefined): string | null {
  if (operationStatus === 'ENABLE') return 'ACTIVE';
  if (operationStatus === 'DISABLE') return 'PAUSED';
  if (operationStatus === 'DELETE') return 'DELETED';
  return nullIfBlank(operationStatus);
}

/** TikTok secondary (delivery) status -> Meta-style effective status; unknown values are kept verbatim. */
export function mapDeliveryStatus(secondaryStatus: string | undefined, operationStatus: string | undefined): string | null {
  if (!secondaryStatus) return mapOperationStatus(operationStatus);
  if (secondaryStatus.includes('DELIVERY_OK')) return 'ACTIVE';
  if (/REJECT|AUDIT_DENY|DENY/.test(secondaryStatus)) return 'DISAPPROVED';
  if (secondaryStatus.includes('DELETE')) return 'DELETED';
  if (/DISABLE|NOT_START|TIME_DONE|NO_SCHEDULE/.test(secondaryStatus)) return 'PAUSED';
  return secondaryStatus;
}

/** TikTok times are "YYYY-MM-DD HH:MM:SS" in UTC; blank stays null. */
export function toIsoUtc(time: string | undefined): string | null {
  const value = nullIfBlank(time);
  if (value === null) return null;
  const parsed = new Date(`${value.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface TikTokMediaLookup {
  videos: Map<string, TikTokVideoInfo>;
  images: Map<string, TikTokImageInfo>;
}

export interface TikTokCreativeColumns {
  meta_creative_id: string;
  name: string | null;
  title: string | null;
  body: string | null;
  call_to_action_type: string | null;
  link_url: string | null;
  object_type: string;
  format: CreativeFormat;
  image_url: string | null;
  thumbnail_url: string | null;
  raw: { video_id: string | null; image_ids: string[] };
}

/** One TikTok ad owns exactly one creative. Videos are not downloadable via the API, so only cover images are stored. */
export function mapTikTokCreative(ad: TikTokAd, media: TikTokMediaLookup): TikTokCreativeColumns {
  const imageIds = ad.image_ids ?? [];
  const videoId = nullIfBlank(ad.video_id);
  const firstImageUrl = imageIds.map((imageId) => media.images.get(imageId)?.image_url).find(Boolean) ?? null;
  const coverUrl = videoId ? media.videos.get(videoId)?.video_cover_url ?? null : null;
  let format: CreativeFormat = 'other';
  if (videoId) format = 'video';
  else if (imageIds.length > 1) format = 'carousel';
  else if (imageIds.length === 1) format = 'image';
  return {
    meta_creative_id: prefixTikTokId(`creative:${ad.ad_id}`),
    name: nullIfBlank(ad.ad_name),
    title: nullIfBlank(ad.display_name),
    body: nullIfBlank(ad.ad_text),
    call_to_action_type: nullIfBlank(ad.call_to_action),
    link_url: nullIfBlank(ad.landing_page_url),
    object_type: videoId ? 'VIDEO' : 'IMAGE',
    format,
    image_url: firstImageUrl,
    thumbnail_url: coverUrl ?? firstImageUrl,
    raw: { video_id: videoId, image_ids: imageIds },
  };
}

export interface TikTokAdRowContext {
  userId: string;
  accountId: string;
  campaignId: string | null;
  adSetId: string | null;
  creativeId: string | null;
  creative: TikTokCreativeColumns;
  campaign?: TikTokCampaign;
  adGroup?: TikTokAdGroup;
  collectedAt: string;
}

/** Database row for a TikTok ad, denormalising campaign / ad group names and creative copy for search. */
export function buildTikTokAdRow(ad: TikTokAd, context: TikTokAdRowContext) {
  return {
    user_id: context.userId,
    ad_account_id: context.accountId,
    platform: 'tiktok',
    campaign_id: context.campaignId,
    ad_set_id: context.adSetId,
    creative_id: context.creativeId,
    meta_ad_id: prefixTikTokId(ad.ad_id),
    name: nullIfBlank(ad.ad_name),
    status: mapOperationStatus(ad.operation_status),
    effective_status: mapDeliveryStatus(ad.secondary_status, ad.operation_status),
    format: context.creative.format,
    platforms: ['tiktok'],
    campaign_name: nullIfBlank(context.campaign?.campaign_name),
    ad_set_name: nullIfBlank(context.adGroup?.adgroup_name),
    headline: context.creative.title,
    primary_text: context.creative.body,
    cta: context.creative.call_to_action_type,
    ad_created_time: toIsoUtc(ad.create_time),
    ad_updated_time: toIsoUtc(ad.modify_time),
    last_collected_at: context.collectedAt,
    raw: ad,
  };
}

export function buildTikTokCampaignRow(campaign: TikTokCampaign, base: { userId: string; accountId: string }) {
  return {
    user_id: base.userId,
    ad_account_id: base.accountId,
    meta_campaign_id: prefixTikTokId(campaign.campaign_id),
    name: nullIfBlank(campaign.campaign_name),
    objective: nullIfBlank(campaign.objective_type),
    status: mapOperationStatus(campaign.operation_status),
    effective_status: mapDeliveryStatus(campaign.secondary_status, campaign.operation_status),
    daily_budget: campaign.budget_mode === 'BUDGET_MODE_DAY' ? toNullableNumber(campaign.budget) : null,
    lifetime_budget: campaign.budget_mode === 'BUDGET_MODE_TOTAL' ? toNullableNumber(campaign.budget) : null,
    start_time: toIsoUtc(campaign.create_time),
    raw: campaign,
  };
}

export function buildTikTokAdGroupRow(adGroup: TikTokAdGroup, base: { userId: string; accountId: string; campaignId: string | null }) {
  return {
    user_id: base.userId,
    ad_account_id: base.accountId,
    campaign_id: base.campaignId,
    meta_adset_id: prefixTikTokId(adGroup.adgroup_id),
    name: nullIfBlank(adGroup.adgroup_name),
    status: mapOperationStatus(adGroup.operation_status),
    effective_status: mapDeliveryStatus(adGroup.secondary_status, adGroup.operation_status),
    optimization_goal: nullIfBlank(adGroup.optimization_goal),
    billing_event: nullIfBlank(adGroup.billing_event),
    daily_budget: adGroup.budget_mode === 'BUDGET_MODE_DAY' ? toNullableNumber(adGroup.budget) : null,
    lifetime_budget: adGroup.budget_mode === 'BUDGET_MODE_TOTAL' ? toNullableNumber(adGroup.budget) : null,
    start_time: toIsoUtc(adGroup.schedule_start_time),
    end_time: toIsoUtc(adGroup.schedule_end_time),
    targeting: { placements: adGroup.placements ?? null },
    raw: adGroup,
  };
}

/** Metrics requested from /report/integrated/get. Anything TikTok does not report here stays null. */
export const TIKTOK_REPORT_METRICS = [
  'spend', 'impressions', 'reach', 'clicks', 'average_video_play',
  'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100',
];

/** Maps one report row to normalised metrics. Purchases, revenue and installs are not requested, so they are null, never 0. */
export function parseTikTokReportRow(row: TikTokReportRow): BaseMetrics {
  const { metrics } = row;
  return {
    spend: toNumber(metrics.spend),
    impressions: toNumber(metrics.impressions),
    reach: toNumber(metrics.reach),
    clicks: toNumber(metrics.clicks),
    link_clicks: toNumber(metrics.clicks),
    outbound_clicks: null,
    installs: null,
    registrations: null,
    trials: null,
    purchases: null,
    revenue: null,
    video_3s_views: null,
    video_thruplays: null,
    video_p25: toNumber(metrics.video_views_p25),
    video_p50: toNumber(metrics.video_views_p50),
    video_p75: toNumber(metrics.video_views_p75),
    video_p100: toNumber(metrics.video_views_p100),
    avg_watch_seconds: toNumber(metrics.average_video_play),
  };
}

/** Splits an inclusive YYYY-MM-DD range into windows of at most `maxDays` days (TikTok limits daily reports). */
export function splitDateRange(dateFrom: string, dateTo: string, maxDays: number): { start: string; end: string }[] {
  const windows: { start: string; end: string }[] = [];
  const last = Date.parse(dateTo);
  for (let cursor = Date.parse(dateFrom); cursor <= last; cursor += maxDays * 86_400_000) {
    const windowEnd = Math.min(cursor + (maxDays - 1) * 86_400_000, last);
    windows.push({ start: new Date(cursor).toISOString().slice(0, 10), end: new Date(windowEnd).toISOString().slice(0, 10) });
  }
  return windows;
}
