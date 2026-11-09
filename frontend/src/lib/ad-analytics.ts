import { daysAgoIso } from './format';
import type { MetricsBundle, NullableNumber, Targeting } from './types';

export const RANKING_TONES: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  ABOVE_AVERAGE: 'green', AVERAGE: 'gray', BELOW_AVERAGE_35: 'amber', BELOW_AVERAGE_20: 'red', BELOW_AVERAGE_10: 'red',
};

export const ASSET_BREAKDOWN_TYPES = ['image_asset', 'video_asset', 'body_asset', 'title_asset', 'description_asset', 'link_url_asset', 'call_to_action_asset'];

/** Viewer counts at each video retention step; steps Meta did not report are left out. */
export function buildRetentionFunnel(metrics: MetricsBundle): { name: string; value: number }[] {
  const steps: [string, NullableNumber][] = [
    ['3s views', metrics.video_3s_views], ['25%', metrics.video_p25], ['50%', metrics.video_p50],
    ['75%', metrics.video_p75], ['100%', metrics.video_p100], ['ThruPlay', metrics.video_thruplays],
  ];
  return steps.filter((step): step is [string, number] => step[1] !== null).map(([name, value]) => ({ name, value }));
}

/** Readable lines for the targeting panel (only what the ad set actually specifies). */
export function describeTargeting(targeting: Targeting): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (targeting.age_min) lines.push({ label: 'Age', value: `${targeting.age_min}–${targeting.age_max ?? '65+'}` });
  if (targeting.genders) {
    lines.push({ label: 'Genders', value: targeting.genders.map((gender) => (gender === 1 ? 'male' : (gender === 2 ? 'female' : 'all'))).join(', ') });
  }
  if (targeting.geo_locations) {
    const places = [...(targeting.geo_locations.countries ?? []), ...(targeting.geo_locations.cities ?? []).map((city) => city.name)];
    lines.push({ label: 'Locations', value: places.join(', ') || 'custom' });
  }
  if (targeting.publisher_platforms) lines.push({ label: 'Platforms', value: targeting.publisher_platforms.join(', ') });
  return lines;
}

/** Start date for a "last N days" preset, or empty for "all collected". */
export const rangeStartFor = (days: number | null, now: Date = new Date()): string => (days ? daysAgoIso(days - 1, now) : '');

/** Breakdown segment label: "25-34|female" -> "25-34 · female". */
export const segmentLabel = (dimensionKey: string): string => dimensionKey.replaceAll('|', ' · ');

/** Fatigue badge text. */
export const fatigueLabel = (status: string): string => (status === 'none' ? 'healthy' : `${status} fatigue`);

/** Date range presets for the ad dashboard: label and number of days (`null` = everything collected). */
export const RANGE_PRESETS: [string, number | null][] = [['7d', 7], ['30d', 30], ['90d', 90], ['All collected', null]];
