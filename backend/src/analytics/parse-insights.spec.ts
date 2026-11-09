import { actionValue, firstActionValue, parseInsightRow, toNumber } from './parse-insights';

describe('toNumber', () => {
  it('parses numeric strings and numbers', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(7)).toBe(7);
    expect(toNumber('0')).toBe(0);
  });
  it.each([null, undefined, '', 'abc', Number.NaN, Infinity])('returns null for %p', (value) => expect(toNumber(value)).toBeNull());
});

describe('actionValue', () => {
  const actions = [
    { action_type: 'purchase', value: '2' },
    { action_type: 'omni_purchase', value: '3' },
  ];
  it('takes the first type present in priority order, never summing', () => {
    expect(actionValue(actions, ['omni_purchase', 'purchase'])).toBe(3);
    expect(actionValue(actions, ['purchase', 'omni_purchase'])).toBe(2);
  });
  it('returns null when no priority type is present', () => expect(actionValue(actions, ['mobile_app_install'])).toBeNull());
  it('returns null when actions are missing', () => expect(actionValue(undefined, ['purchase'])).toBeNull());
});

describe('firstActionValue', () => {
  it('reads the first entry', () => expect(firstActionValue([{ action_type: 'video_view', value: '9' }])).toBe(9));
  it('returns null for empty or missing lists', () => {
    expect(firstActionValue([])).toBeNull();
    expect(firstActionValue(undefined)).toBeNull();
  });
});

describe('parseInsightRow', () => {
  it('maps a full row', () => {
    const metrics = parseInsightRow({
      spend: '12.5', impressions: '1000', reach: '800', clicks: '50', inline_link_clicks: '30',
      outbound_clicks: [{ action_type: 'outbound_click', value: '20' }],
      actions: [
        { action_type: 'omni_purchase', value: '3' }, { action_type: 'purchase', value: '3' },
        { action_type: 'video_view', value: '400' }, { action_type: 'mobile_app_install', value: '9' },
        { action_type: 'omni_complete_registration', value: '4' }, { action_type: 'omni_start_trial', value: '2' },
      ],
      action_values: [{ action_type: 'omni_purchase', value: '90' }],
      video_thruplay_watched_actions: [{ action_type: 'video_view', value: '100' }],
      video_p25_watched_actions: [{ action_type: 'video_view', value: '300' }],
      video_p50_watched_actions: [{ action_type: 'video_view', value: '200' }],
      video_p75_watched_actions: [{ action_type: 'video_view', value: '150' }],
      video_p100_watched_actions: [{ action_type: 'video_view', value: '80' }],
      video_avg_time_watched_actions: [{ action_type: 'video_view', value: '6.5' }],
    });
    expect(metrics).toEqual({
      spend: 12.5, impressions: 1000, reach: 800, clicks: 50, link_clicks: 30, outbound_clicks: 20, installs: 9, registrations: 4, trials: 2,
      purchases: 3, revenue: 90, video_3s_views: 400, video_thruplays: 100, video_p25: 300, video_p50: 200, video_p75: 150, video_p100: 80,
      avg_watch_seconds: 6.5,
    });
  });

  it('keeps absent metrics null instead of inventing zeros', () => {
    const metrics = parseInsightRow({ spend: '1.00', impressions: '10' });
    expect(metrics.purchases).toBeNull();
    expect(metrics.revenue).toBeNull();
    expect(metrics.video_3s_views).toBeNull();
    expect(metrics.reach).toBeNull();
    expect(metrics.link_clicks).toBeNull();
  });

  it('falls back to the link_click action when inline_link_clicks is absent', () => {
    expect(parseInsightRow({ actions: [{ action_type: 'link_click', value: '11' }] }).link_clicks).toBe(11);
  });
});
