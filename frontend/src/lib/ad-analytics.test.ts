import { describe, expect, it } from 'vitest';
import { buildRetentionFunnel, describeTargeting, fatigueLabel, RANGE_PRESETS, rangeStartFor, segmentLabel } from './ad-analytics';
import type { MetricsBundle } from './types';

const metrics = (overrides: Partial<MetricsBundle>): MetricsBundle => ({ video_3s_views: null, video_p25: null, video_p50: null, video_p75: null, video_p100: null, video_thruplays: null, ...overrides }) as MetricsBundle;

describe('buildRetentionFunnel', () => {
  it('lists reported steps in funnel order and leaves out missing ones', () => {
    expect(buildRetentionFunnel(metrics({ video_3s_views: 100, video_p25: 60, video_p100: 10, video_thruplays: 30 }))).toEqual([
      { name: '3s views', value: 100 }, { name: '25%', value: 60 }, { name: '100%', value: 10 }, { name: 'ThruPlay', value: 30 },
    ]);
  });
  it('keeps zero values (reported) but not nulls (missing)', () => {
    expect(buildRetentionFunnel(metrics({ video_3s_views: 0 }))).toEqual([{ name: '3s views', value: 0 }]);
    expect(buildRetentionFunnel(metrics({}))).toEqual([]);
  });
});

describe('describeTargeting', () => {
  it('describes age, genders, locations and platforms', () => {
    expect(describeTargeting({ age_min: 25, age_max: 44, genders: [1, 2, 0], geo_locations: { countries: ['US'], cities: [{ name: 'Austin' }] }, publisher_platforms: ['facebook'] })).toEqual([
      { label: 'Age', value: '25–44' }, { label: 'Genders', value: 'male, female, all' }, { label: 'Locations', value: 'US, Austin' }, { label: 'Platforms', value: 'facebook' },
    ]);
  });
  it('uses 65+ without a max age and "custom" for unnamed locations', () => {
    expect(describeTargeting({ age_min: 18, geo_locations: {} })).toEqual([{ label: 'Age', value: '18–65+' }, { label: 'Locations', value: 'custom' }]);
  });
  it('returns nothing for an empty targeting object', () => expect(describeTargeting({})).toEqual([]));
});

describe('rangeStartFor', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  it('returns the first day of a last-N-days preset', () => expect(rangeStartFor(7, now)).toBe('2026-03-04'));
  it('returns empty for "all collected"', () => expect(rangeStartFor(null, now)).toBe(''));
});

describe('segmentLabel', () => {
  it('prettifies composite keys', () => expect(segmentLabel('25-34|female')).toBe('25-34 · female'));
});

describe('fatigueLabel', () => {
  it('calls no fatigue "healthy"', () => expect(fatigueLabel('none')).toBe('healthy'));
  it('names other levels', () => expect(fatigueLabel('high')).toBe('high fatigue'));
});

describe('RANGE_PRESETS', () => {
  it('offers 7/30/90 days and everything collected', () => expect(RANGE_PRESETS.map(([, days]) => days)).toEqual([7, 30, 90, null]));
});
