import type {
  AdAccount, AdAnalytics, AdDetail, AdListItem, CollectionRun, MetaConnection, MetricsBundle, SavedSearch, Schedule,
} from '@/lib/types';

/** Builders for API-shaped test data. Pass overrides for the fields a test cares about. */

export const makeAd = (overrides: Partial<AdListItem> = {}): AdListItem => ({
  id: 'ad-1', ad_account_id: 'acc-1', meta_ad_id: 'meta-1', name: 'Summer Sale', headline: 'Big discounts', campaign_name: 'Summer Campaign',
  effective_status: 'ACTIVE', format: 'image', platforms: ['facebook'], total_spend: 100, total_impressions: 10_000, total_link_clicks: 200,
  total_purchases: 0, total_revenue: 0, media: [], ...overrides,
});

export const makeAccount = (overrides: Partial<AdAccount> = {}): AdAccount => ({
  id: 'acc-1', connection_id: 'conn-1', meta_account_id: 'act_1', name: 'Main account', currency: 'USD', timezone_name: 'UTC', business_name: null, selected: true, ...overrides,
});

export const makeRun = (overrides: Partial<CollectionRun> = {}): CollectionRun => ({
  id: 'run-1', status: 'succeeded', stage: 'done', progress: 100, keywords: ['summer'], trigger: 'manual', counters: { ads_found: 2, ads_new: 1, ads_updated: 1 },
  errors: [], error: null, created_at: '2026-03-01T10:00:00Z', started_at: '2026-03-01T10:00:01Z', finished_at: '2026-03-01T10:00:31Z', ...overrides,
});

export const makeSchedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: 's1', name: 'Daily summer', keywords: ['summer'], ad_account_id: 'acc-1', interval_unit: 'day', interval_value: 1, timezone: 'UTC', lookback_days: 30,
  start_at: '2026-03-01T00:00:00Z', end_at: null, enabled: true, last_run_at: '2026-03-02T00:00:00Z', next_run_at: '2026-03-03T00:00:00Z', last_status: 'succeeded',
  consecutive_failures: 0, ad_accounts: { name: 'Main account' }, ...overrides,
});

export const makeSavedSearch = (overrides: Partial<SavedSearch> = {}): SavedSearch => ({
  id: 'ss-1', name: 'Summer set', tags: ['summer', 'sale'], match_mode: 'any', ad_account_id: 'acc-1', last_run_at: null, ...overrides,
});

export const makeConnection = (overrides: Partial<MetaConnection> = {}): MetaConnection => ({
  id: 'conn-1', name: 'My connection', meta_user_id: 'meta-user', status: 'active', scopes: ['ads_read'], token_expires_at: null, last_validated_at: '2026-03-01T10:00:00Z', last_error: null, ...overrides,
});

export const makeMetrics = (overrides: Partial<MetricsBundle> = {}): MetricsBundle => ({
  spend: 100, impressions: 10_000, reach: 8000, frequency: 1.25, cpm: 10, ctr: 2, cpc: 0.5, link_clicks: 200, outbound_clicks: 100, installs: null, cpi: null, ipm: null,
  registrations: null, cost_per_registration: null, trials: null, purchases: 20, cpa: 5, revenue: 600, roas: 6, video_3s_views: 4000, hook_rate: 40, video_thruplays: 1500,
  hold_rate: 37.5, video_p25: 3000, video_p50: 2000, video_p75: 1500, video_p100: 1000, completion_25: 75, completion_50: 50, completion_75: 37.5, completion_100: 25,
  avg_watch_seconds: 7.5, ...overrides,
});

export const makeAnalytics = (overrides: Partial<AdAnalytics> = {}): AdAnalytics => ({
  range: { from: '2026-03-01', to: '2026-03-10', available_from: '2026-03-01', available_to: '2026-03-10', days_with_data: 10 },
  currency: 'USD',
  metrics: makeMetrics(),
  reach_note: null,
  rankings: { quality: 'ABOVE_AVERAGE', engagement: 'AVERAGE', conversion: 'BELOW_AVERAGE_35', as_of: '2026-03-10T00:00:00Z' },
  daily: [{ date: '2026-03-01', spend: 10, impressions: 1000, ctr: 2, cpc: 0.5, purchases: 2, roas: 6 }],
  fatigue: { status: 'none', days_with_data: 20, first_7d_ctr: 2, last_7d_ctr: 1.9, ctr_drop_pct: 5, ctr_ratio: 0.95, ctr_trend_per_day: -0.01 },
  breakdowns: {
    country: { date_start: '2026-03-01', date_stop: '2026-03-10', rows: [{ dim_key: 'US', spend: 70, impressions: 7000, ctr: 2, cpm: 10 }, { dim_key: 'CA', spend: 30, impressions: 3000, ctr: 2, cpm: 10 }] },
  },
  ...overrides,
});

export const makeAdDetail = (overrides: Partial<AdDetail> = {}): AdDetail => ({
  ...makeAd(), platforms: ['facebook', 'instagram'], cta: 'SHOP_NOW', primary_text: 'Save big this summer', ad_created_time: '2026-02-01T10:00:00Z',
  campaign: { name: 'Summer Campaign', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' }, ad_set: { name: 'US Adults', optimization_goal: 'OFFSITE_CONVERSIONS' },
  creative: { link_url: 'https://shop.example.test' }, creative_variations: { dynamic: null, carousel: [] },
  targeting: { age_min: 25, age_max: 44, genders: [2], geo_locations: { countries: ['US'] }, publisher_platforms: ['facebook'] },
  ad_account: { id: 'acc-1', name: 'Main account', currency: 'USD' }, ...overrides,
});
