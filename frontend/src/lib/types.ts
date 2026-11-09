/** Shapes of the backend API responses the UI consumes. */

export type NullableNumber = number | null;

export interface MediaItem {
  kind: string;
  status: string;
  url: string | null;
  error: string | null;
}

export interface AdListItem {
  id: string;
  ad_account_id: string;
  meta_ad_id: string;
  name: string | null;
  headline: string | null;
  campaign_name: string | null;
  effective_status: string | null;
  format: string | null;
  platforms: string[] | null;
  total_spend: number;
  total_impressions: number;
  total_link_clicks: number;
  total_purchases: number;
  total_revenue: number;
  media: MediaItem[];
}

export interface AdsPage {
  items: AdListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdAccount {
  id: string;
  connection_id: string;
  meta_account_id: string;
  name: string | null;
  currency: string | null;
  timezone_name: string | null;
  business_name: string | null;
  selected: boolean;
}

export interface Campaign {
  id: string;
  name: string | null;
}

export interface MetaConnection {
  id: string;
  name: string | null;
  meta_user_id: string;
  status: string;
  scopes: string[] | null;
  token_expires_at: string | null;
  last_validated_at: string | null;
  last_error: string | null;
}

export interface MetaStatus {
  oauthConfigured: boolean;
  adLibraryEnabled: boolean;
  graphVersion: string;
}

export interface CollectionRun {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  stage: string | null;
  progress: number;
  keywords: string[];
  trigger: 'manual' | 'schedule';
  counters: { ads_found?: number; ads_new?: number; ads_updated?: number; media_queued?: number };
  errors: { message: string }[];
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  schedules?: { name: string } | null;
}

export interface RunsPage {
  items: CollectionRun[];
  total: number;
}

export interface StartCollectionResponse {
  run: CollectionRun;
  existing_matches: number;
  reused: boolean;
}

export interface SearchHistoryEntry {
  keywords: string[];
}

export interface SavedSearch {
  id: string;
  name: string;
  tags: string[];
  match_mode: 'any' | 'all';
  ad_account_id: string | null;
  last_run_at: string | null;
}

export type IntervalUnit = 'hour' | 'day' | 'week' | 'month';

export interface Schedule {
  id: string;
  name: string;
  keywords: string[];
  ad_account_id: string;
  interval_unit: IntervalUnit;
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
  ad_accounts?: { name: string | null } | null;
}

export interface ScheduleExecution {
  id: string;
  scheduled_for: string;
  status: string;
  attempt: number;
  finished_at: string | null;
  error: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  timezone: string;
}

export interface DailyMetricsPoint {
  date: string;
  spend: NullableNumber;
  impressions: NullableNumber;
  ctr: NullableNumber;
  cpc: NullableNumber;
  purchases: NullableNumber;
  roas: NullableNumber;
}

export interface MetricsBundle {
  spend: NullableNumber;
  impressions: NullableNumber;
  reach: NullableNumber;
  frequency: NullableNumber;
  cpm: NullableNumber;
  ctr: NullableNumber;
  cpc: NullableNumber;
  link_clicks: NullableNumber;
  outbound_clicks: NullableNumber;
  installs: NullableNumber;
  cpi: NullableNumber;
  ipm: NullableNumber;
  registrations: NullableNumber;
  cost_per_registration: NullableNumber;
  trials: NullableNumber;
  purchases: NullableNumber;
  cpa: NullableNumber;
  revenue: NullableNumber;
  roas: NullableNumber;
  video_3s_views: NullableNumber;
  hook_rate: NullableNumber;
  video_thruplays: NullableNumber;
  hold_rate: NullableNumber;
  video_p25: NullableNumber;
  video_p50: NullableNumber;
  video_p75: NullableNumber;
  video_p100: NullableNumber;
  completion_25: NullableNumber;
  completion_50: NullableNumber;
  completion_75: NullableNumber;
  completion_100: NullableNumber;
  avg_watch_seconds: NullableNumber;
}

export interface BreakdownRow extends Partial<MetricsBundle> {
  dim_key: string;
}

export interface BreakdownGroup {
  date_start: string;
  date_stop: string;
  rows: BreakdownRow[];
}

export interface FatigueReport {
  status: 'insufficient_data' | 'none' | 'moderate' | 'high';
  days_with_data: number;
  first_7d_ctr: NullableNumber;
  last_7d_ctr: NullableNumber;
  ctr_drop_pct: NullableNumber;
  ctr_ratio: NullableNumber;
  ctr_trend_per_day: NullableNumber;
}

export interface AdAnalytics {
  range: { from: string | null; to: string | null; available_from: string | null; available_to: string | null; days_with_data: number };
  currency: string | null;
  metrics: MetricsBundle;
  reach_note: string | null;
  rankings: { quality: string | null; engagement: string | null; conversion: string | null; as_of: string } | null;
  daily: DailyMetricsPoint[];
  fatigue: FatigueReport;
  breakdowns: Record<string, BreakdownGroup>;
}

export interface AdDetail extends AdListItem {
  platforms: string[] | null;
  cta: string | null;
  primary_text: string | null;
  ad_created_time: string | null;
  campaign: { name: string | null; objective: string | null; effective_status: string | null } | null;
  ad_set: { name: string | null; optimization_goal: string | null } | null;
  creative: { link_url: string | null } | null;
  creative_variations: { dynamic: DynamicVariations | null; carousel: { name?: string; description?: string }[] };
  targeting: Targeting | null;
  ad_account: { id: string; name: string | null; currency: string | null } | null;
}

export interface DynamicVariations {
  bodies: string[];
  titles: string[];
  descriptions: string[];
  images: string[];
  videos: string[];
  call_to_actions: string[];
  link_urls: string[];
}

export interface Targeting {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: { countries?: string[]; cities?: { name: string }[] };
  publisher_platforms?: string[];
  [field: string]: unknown;
}

export interface DashboardOverview {
  totals: { ads: number; saved_searches: number; scheduled_searches: number; schedules_total: number; active_collections: number };
  recent_ads: { id: string; name: string | null; meta_ad_id: string; campaign_name: string | null; effective_status: string | null }[];
  activity: { date: string; runs: number; failed: number; ads_found: number }[];
  top_ads: { id: string; name: string | null; roas: NullableNumber; ctr: NullableNumber; impressions: NullableNumber }[];
  performance: { date: string; spend: NullableNumber; ctr: NullableNumber }[];
}
