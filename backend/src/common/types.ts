/** Shapes of the external (Meta Graph API) payloads and of our database rows. */

// ------------------------------------------------------------------ Meta API
export interface MetaAction {
  action_type: string;
  value: string | number;
}

export interface MetaTargeting {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: { countries?: string[]; cities?: { name: string }[] };
  publisher_platforms?: string[];
  [field: string]: unknown;
}

export interface MetaLinkData {
  link?: string;
  message?: string;
  name?: string;
  picture?: string;
  image_hash?: string;
  call_to_action?: { type?: string; value?: { link?: string } };
  child_attachments?: { name?: string; description?: string }[];
}

export interface MetaVideoData {
  video_id?: string;
  title?: string;
  message?: string;
  image_url?: string;
  image_hash?: string;
  call_to_action?: { type?: string; value?: { link?: string } };
}

export interface MetaObjectStorySpec {
  link_data?: MetaLinkData;
  video_data?: MetaVideoData;
  photo_data?: { image_hash?: string; url?: string; caption?: string };
}

export interface MetaAssetFeedSpec {
  bodies?: { text: string }[];
  titles?: { text: string }[];
  descriptions?: { text: string }[];
  images?: { hash?: string; url?: string }[];
  videos?: { video_id: string }[];
  call_to_action_types?: string[];
  link_urls?: { website_url: string }[];
}

export interface MetaCreative {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  call_to_action_type?: string;
  object_type?: string;
  image_url?: string;
  image_hash?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_story_spec?: MetaObjectStorySpec;
  asset_feed_spec?: MetaAssetFeedSpec;
}

export interface MetaAd {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  created_time?: string;
  updated_time?: string;
  campaign_id?: string;
  adset_id?: string;
  creative?: MetaCreative;
}

export interface MetaCampaign {
  id: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
}

export interface MetaAdSet {
  id: string;
  name?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  targeting?: MetaTargeting;
}

export interface MetaAdAccount {
  id: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { id: string; name: string };
}

/** One row of an insights response. Metric fields are optional; unknown fields are preserved. */
export interface MetaInsightRow {
  ad_id?: string;
  date_start?: string;
  date_stop?: string;
  account_currency?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  outbound_clicks?: MetaAction[];
  actions?: MetaAction[];
  action_values?: MetaAction[];
  video_thruplay_watched_actions?: MetaAction[];
  video_p25_watched_actions?: MetaAction[];
  video_p50_watched_actions?: MetaAction[];
  video_p75_watched_actions?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];
  video_avg_time_watched_actions?: MetaAction[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  [field: string]: unknown;
}

export interface MetaVideo {
  id: string;
  source?: string;
  picture?: string;
  length?: number;
}

export interface MetaImage {
  hash: string;
  url?: string;
  width?: number;
  height?: number;
}

// ------------------------------------------------------------ TikTok Marketing API
export interface TikTokPage<Item> {
  list?: Item[];
  page_info?: { page: number; page_size?: number; total_number?: number; total_page: number };
}

export interface TikTokAdvertiser {
  advertiser_id: string;
  name?: string;
  currency?: string;
  timezone?: string;
  display_timezone?: string;
  status?: string;
  company?: string;
}

export interface TikTokCampaign {
  campaign_id: string;
  campaign_name?: string;
  objective_type?: string;
  budget_mode?: string;
  budget?: number;
  operation_status?: string;
  secondary_status?: string;
  create_time?: string;
  modify_time?: string;
}

export interface TikTokAdGroup {
  adgroup_id: string;
  adgroup_name?: string;
  campaign_id?: string;
  optimization_goal?: string;
  billing_event?: string;
  budget_mode?: string;
  budget?: number;
  schedule_start_time?: string;
  schedule_end_time?: string;
  placements?: string[];
  operation_status?: string;
  secondary_status?: string;
}

export interface TikTokAd {
  ad_id: string;
  ad_name?: string;
  campaign_id?: string;
  adgroup_id?: string;
  ad_text?: string;
  call_to_action?: string;
  landing_page_url?: string;
  display_name?: string;
  video_id?: string;
  image_ids?: string[];
  operation_status?: string;
  secondary_status?: string;
  create_time?: string;
  modify_time?: string;
}

export interface TikTokVideoInfo {
  video_id: string;
  video_cover_url?: string;
  preview_url?: string;
  duration?: number;
}

export interface TikTokImageInfo {
  image_id: string;
  image_url?: string;
  width?: number;
  height?: number;
}

/** One row of /report/integrated/get: dimension values plus metrics (numbers arrive as strings, "-" when unavailable). */
export interface TikTokReportRow {
  dimensions: { ad_id: string; stat_time_day?: string };
  metrics: Record<string, string | number | null | undefined>;
}

// ------------------------------------------------------------ database rows
export type AdPlatform = 'meta' | 'tiktok';

export interface MetaConnectionRow {
  id: string;
  user_id: string;
  meta_user_id: string;
  name: string | null;
  token_encrypted: string;
  token_expires_at: string | null;
  scopes: string[];
  graph_version: string | null;
  status: 'active' | 'expired' | 'revoked' | 'error';
}

export interface AdAccountRow {
  id: string;
  user_id: string;
  connection_id: string;
  meta_account_id: string;
  platform?: AdPlatform;
  name: string | null;
  currency: string | null;
  selected: boolean;
}

export interface CreativeRow {
  id: string;
  meta_creative_id: string;
  video_id: string | null;
  image_hash: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  asset_feed_spec: MetaAssetFeedSpec | null;
  object_story_spec: MetaObjectStorySpec | null;
}

export interface AdRow {
  id: string;
  user_id: string;
  ad_account_id: string;
  campaign_id: string | null;
  ad_set_id: string | null;
  creative_id: string | null;
  meta_ad_id: string;
  name: string | null;
  effective_status: string | null;
  format: string | null;
  platforms: string[] | null;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  campaign_name: string | null;
  ad_set_name: string | null;
  ad_created_time: string | null;
  total_spend: number;
  total_impressions: number;
  total_link_clicks: number;
  total_purchases: number;
  total_revenue: number;
  first_seen_at: string;
  last_collected_at: string | null;
}

export interface StorageAssetRow {
  id: string;
  user_id: string;
  kind: 'image' | 'video' | 'thumbnail';
  dedupe_key: string;
  source_ref: string | null;
  status: 'pending' | 'downloading' | 'stored' | 'failed' | 'unavailable';
  attempts: number;
  path: string | null;
  error: string | null;
}

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export interface CollectionRunRow {
  id: string;
  user_id: string;
  ad_account_id: string | null;
  saved_search_id: string | null;
  schedule_id: string | null;
  trigger: 'manual' | 'schedule';
  keywords: string[];
  date_from: string | null;
  date_to: string | null;
  status: RunStatus;
  stage: string | null;
  progress: number;
  counters: Record<string, unknown>;
  errors: { message: string }[];
  error: string | null;
}

export interface ScheduleRow {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  ad_account_id: string;
  interval_unit: 'hour' | 'day' | 'week' | 'month';
  interval_value: number;
  timezone: string;
  lookback_days: number;
  start_at: string;
  end_at: string | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
}

/** Daily metrics row as stored (numeric columns arrive as numbers or numeric strings). */
export type DailyMetricsRow = Record<string, string | number | null> & { ad_id: string; date: string };
