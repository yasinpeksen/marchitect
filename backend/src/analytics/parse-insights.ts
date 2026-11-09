import { MetaAction, MetaInsightRow } from '../common/types';
import { BaseMetrics, NullableNumber } from './metrics';

/**
 * Meta reports the same event under several action types (e.g. omni_* aggregates the pixel and
 * app variants). We take the FIRST type present in priority order instead of summing, which
 * would double count.
 */
export const ACTION_PRIORITY = {
  link_clicks: ['link_click'],
  installs: ['mobile_app_install', 'omni_app_install', 'app_install'],
  registrations: [
    'omni_complete_registration',
    'complete_registration',
    'offsite_conversion.fb_pixel_complete_registration',
    'app_custom_event.fb_mobile_complete_registration',
  ],
  trials: [
    'omni_start_trial',
    'start_trial_total',
    'start_trial',
    'offsite_conversion.fb_pixel_start_trial',
    'app_custom_event.fb_mobile_start_trial',
  ],
  purchases: [
    'omni_purchase',
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'app_custom_event.fb_mobile_purchase',
  ],
  video_3s_views: ['video_view'], // "video_view" action = 3-second video plays
} as const;

/** Parses a finite number, `null` for missing/blank/non-numeric values. */
export const toNumber = (value: unknown): NullableNumber => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** First action whose type appears in `priority` (in priority order); `null` when none is present. */
export function actionValue(actions: MetaAction[] | undefined, priority: readonly string[]): NullableNumber {
  if (!Array.isArray(actions)) return null;
  for (const actionType of priority) {
    const match = actions.find((action) => action.action_type === actionType);
    if (match) return toNumber(match.value);
  }
  return null;
}

/** Video metrics arrive as [{action_type: "video_view", value: "123"}]; take the first entry. */
export const firstActionValue = (actions: MetaAction[] | undefined): NullableNumber =>
  Array.isArray(actions) && actions.length > 0 ? toNumber(actions[0].value) : null;

/** Maps one Meta insights row to normalised metrics. Absent fields stay null. */
export function parseInsightRow(row: MetaInsightRow): BaseMetrics {
  return {
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    reach: toNumber(row.reach),
    clicks: toNumber(row.clicks),
    link_clicks: toNumber(row.inline_link_clicks) ?? actionValue(row.actions, ACTION_PRIORITY.link_clicks),
    outbound_clicks: firstActionValue(row.outbound_clicks),
    installs: actionValue(row.actions, ACTION_PRIORITY.installs),
    registrations: actionValue(row.actions, ACTION_PRIORITY.registrations),
    trials: actionValue(row.actions, ACTION_PRIORITY.trials),
    purchases: actionValue(row.actions, ACTION_PRIORITY.purchases),
    revenue: actionValue(row.action_values, ACTION_PRIORITY.purchases),
    video_3s_views: actionValue(row.actions, ACTION_PRIORITY.video_3s_views),
    video_thruplays: firstActionValue(row.video_thruplay_watched_actions),
    video_p25: firstActionValue(row.video_p25_watched_actions),
    video_p50: firstActionValue(row.video_p50_watched_actions),
    video_p75: firstActionValue(row.video_p75_watched_actions),
    video_p100: firstActionValue(row.video_p100_watched_actions),
    avg_watch_seconds: firstActionValue(row.video_avg_time_watched_actions),
  };
}

export const INSIGHT_METRIC_FIELDS = [
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks', 'outbound_clicks',
  'actions', 'action_values', 'purchase_roas', 'cost_per_action_type',
  'video_thruplay_watched_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
  'video_p75_watched_actions', 'video_p100_watched_actions', 'video_avg_time_watched_actions',
  'account_currency',
];
export const RANKING_FIELDS = ['quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking'];
