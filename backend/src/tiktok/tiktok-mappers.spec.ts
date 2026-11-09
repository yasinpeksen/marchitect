import {
  buildTikTokAdGroupRow, buildTikTokAdRow, buildTikTokCampaignRow, mapDeliveryStatus, mapOperationStatus, mapTikTokCreative, parseTikTokReportRow,
  prefixTikTokId, splitDateRange, stripTikTokPrefix, TIKTOK_REPORT_METRICS, toIsoUtc,
} from './tiktok-mappers';

describe('TikTok ids', () => {
  it('prefixes and strips ids', () => {
    expect(prefixTikTokId('123')).toBe('tiktok:123');
    expect(stripTikTokPrefix('tiktok:123')).toBe('123');
    expect(stripTikTokPrefix('123')).toBe('123');
  });
});

describe('status mapping', () => {
  it('maps operation status to the Meta-style vocabulary', () => {
    expect(mapOperationStatus('ENABLE')).toBe('ACTIVE');
    expect(mapOperationStatus('DISABLE')).toBe('PAUSED');
    expect(mapOperationStatus('DELETE')).toBe('DELETED');
    expect(mapOperationStatus('OTHER')).toBe('OTHER');
    expect(mapOperationStatus(undefined)).toBeNull();
  });
  it('maps delivery status and falls back to the operation status', () => {
    expect(mapDeliveryStatus('AD_STATUS_DELIVERY_OK', 'ENABLE')).toBe('ACTIVE');
    expect(mapDeliveryStatus('AD_STATUS_AUDIT_DENY', 'ENABLE')).toBe('DISAPPROVED');
    expect(mapDeliveryStatus('AD_STATUS_REJECT', 'ENABLE')).toBe('DISAPPROVED');
    expect(mapDeliveryStatus('AD_STATUS_DELETE', 'DELETE')).toBe('DELETED');
    expect(mapDeliveryStatus('AD_STATUS_DISABLE', 'DISABLE')).toBe('PAUSED');
    expect(mapDeliveryStatus('AD_STATUS_NOT_START', 'ENABLE')).toBe('PAUSED');
    expect(mapDeliveryStatus('AD_STATUS_BALANCE_EXCEED', 'ENABLE')).toBe('AD_STATUS_BALANCE_EXCEED');
    expect(mapDeliveryStatus(undefined, 'DISABLE')).toBe('PAUSED');
  });
});

describe('toIsoUtc', () => {
  it('reads TikTok UTC timestamps', () => {
    expect(toIsoUtc('2026-02-01 10:00:00')).toBe('2026-02-01T10:00:00.000Z');
    expect(toIsoUtc('2026-02-01T10:00:00+02:00')).toBe('2026-02-01T08:00:00.000Z');
  });
  it('returns null for blank or unparseable values', () => {
    expect(toIsoUtc('')).toBeNull();
    expect(toIsoUtc(undefined)).toBeNull();
    expect(toIsoUtc('not a date')).toBeNull();
  });
});

const media = {
  videos: new Map([['v1', { video_id: 'v1', video_cover_url: 'https://p16.tiktokcdn.com/cover.jpg' }]]),
  images: new Map([['i1', { image_id: 'i1', image_url: 'https://p16.tiktokcdn.com/i1.jpg' }], ['i2', { image_id: 'i2', image_url: 'https://p16.tiktokcdn.com/i2.jpg' }]]),
};

describe('mapTikTokCreative', () => {
  it('maps a video ad using its cover as thumbnail', () => {
    expect(mapTikTokCreative({ ad_id: '9', ad_name: 'Vid', ad_text: 'Copy', call_to_action: 'SHOP_NOW', landing_page_url: 'https://x.test', display_name: 'Brand', video_id: 'v1' }, media)).toMatchObject({
      meta_creative_id: 'tiktok:creative:9', title: 'Brand', body: 'Copy', call_to_action_type: 'SHOP_NOW', link_url: 'https://x.test', format: 'video',
      object_type: 'VIDEO', thumbnail_url: 'https://p16.tiktokcdn.com/cover.jpg', image_url: null, raw: { video_id: 'v1', image_ids: [] },
    });
  });
  it('maps single and multiple images to image and carousel', () => {
    expect(mapTikTokCreative({ ad_id: '1', image_ids: ['i1'] }, media)).toMatchObject({ format: 'image', image_url: 'https://p16.tiktokcdn.com/i1.jpg', thumbnail_url: 'https://p16.tiktokcdn.com/i1.jpg' });
    expect(mapTikTokCreative({ ad_id: '2', image_ids: ['i1', 'i2'] }, media).format).toBe('carousel');
  });
  it('uses nulls when nothing is known', () => {
    expect(mapTikTokCreative({ ad_id: '3', video_id: 'missing' }, { videos: new Map(), images: new Map() })).toMatchObject({ format: 'video', thumbnail_url: null, body: null, title: null });
    expect(mapTikTokCreative({ ad_id: '4' }, media)).toMatchObject({ format: 'other', object_type: 'IMAGE', image_url: null });
  });
});

describe('row builders', () => {
  const creative = mapTikTokCreative({ ad_id: '9', ad_text: 'Copy', display_name: 'Brand', video_id: 'v1' }, media);

  it('builds an ad row with denormalised search fields and the tiktok platform', () => {
    const ad = { ad_id: '9', ad_name: 'Spring Ad', operation_status: 'ENABLE', secondary_status: 'AD_STATUS_DELIVERY_OK', create_time: '2026-02-01 10:00:00' };
    expect(buildTikTokAdRow(ad, {
      userId: 'u1', accountId: 'acc', campaignId: 'c-uuid', adSetId: 's-uuid', creativeId: 'cr-uuid', creative,
      campaign: { campaign_id: 'c1', campaign_name: 'Spring Campaign' }, adGroup: { adgroup_id: 'g1', adgroup_name: 'Spring Group' }, collectedAt: '2026-03-01T00:00:00Z',
    })).toMatchObject({
      user_id: 'u1', ad_account_id: 'acc', platform: 'tiktok', platforms: ['tiktok'], meta_ad_id: 'tiktok:9', name: 'Spring Ad', status: 'ACTIVE', effective_status: 'ACTIVE',
      campaign_name: 'Spring Campaign', ad_set_name: 'Spring Group', headline: 'Brand', primary_text: 'Copy', format: 'video', ad_created_time: '2026-02-01T10:00:00.000Z',
      ad_updated_time: null, last_collected_at: '2026-03-01T00:00:00Z', raw: ad,
    });
  });
  it('falls back to nulls for unknown parents', () => {
    expect(buildTikTokAdRow({ ad_id: '9' }, { userId: 'u', accountId: 'a', campaignId: null, adSetId: null, creativeId: null, creative, collectedAt: 't' })).toMatchObject({
      campaign_name: null, ad_set_name: null, name: null, status: null, effective_status: null,
    });
  });
  it('builds a campaign row, splitting daily and lifetime budgets', () => {
    expect(buildTikTokCampaignRow({ campaign_id: 'c1', campaign_name: 'C', objective_type: 'CONVERSIONS', budget_mode: 'BUDGET_MODE_DAY', budget: 50, operation_status: 'ENABLE' }, { userId: 'u', accountId: 'a' })).toMatchObject({
      meta_campaign_id: 'tiktok:c1', objective: 'CONVERSIONS', status: 'ACTIVE', daily_budget: 50, lifetime_budget: null,
    });
    expect(buildTikTokCampaignRow({ campaign_id: 'c2', budget_mode: 'BUDGET_MODE_TOTAL', budget: 900 }, { userId: 'u', accountId: 'a' })).toMatchObject({ daily_budget: null, lifetime_budget: 900 });
    expect(buildTikTokCampaignRow({ campaign_id: 'c3', budget_mode: 'BUDGET_MODE_INFINITE' }, { userId: 'u', accountId: 'a' })).toMatchObject({ daily_budget: null, lifetime_budget: null });
  });
  it('builds an ad group row linked to its campaign', () => {
    expect(buildTikTokAdGroupRow(
      { adgroup_id: 'g1', adgroup_name: 'G', campaign_id: 'c1', budget_mode: 'BUDGET_MODE_DAY', budget: 20, placements: ['PLACEMENT_TIKTOK'], schedule_start_time: '2026-02-01 00:00:00' },
      { userId: 'u', accountId: 'a', campaignId: 'c-uuid' },
    )).toMatchObject({ meta_adset_id: 'tiktok:g1', campaign_id: 'c-uuid', daily_budget: 20, lifetime_budget: null, targeting: { placements: ['PLACEMENT_TIKTOK'] }, start_time: '2026-02-01T00:00:00.000Z' });
    expect(buildTikTokAdGroupRow({ adgroup_id: 'g2', budget_mode: 'BUDGET_MODE_TOTAL', budget: 5 }, { userId: 'u', accountId: 'a', campaignId: null })).toMatchObject({ lifetime_budget: 5, targeting: { placements: null } });
  });
});

describe('parseTikTokReportRow', () => {
  it('maps metrics and keeps unreported ones null (never 0)', () => {
    const metrics = parseTikTokReportRow({
      dimensions: { ad_id: '9' },
      metrics: { spend: '12.5', impressions: '1000', reach: '800', clicks: '40', average_video_play: '3.2', video_views_p25: '500', video_views_p50: '250', video_views_p75: '100', video_views_p100: '50' },
    });
    expect(metrics).toMatchObject({ spend: 12.5, impressions: 1000, reach: 800, clicks: 40, link_clicks: 40, avg_watch_seconds: 3.2, video_p25: 500, video_p100: 50 });
    expect(metrics).toMatchObject({ purchases: null, revenue: null, installs: null, video_3s_views: null, video_thruplays: null, outbound_clicks: null });
  });
  it('turns "-" and missing values into null', () => {
    expect(parseTikTokReportRow({ dimensions: { ad_id: '9' }, metrics: { spend: '-', impressions: undefined, clicks: null } })).toMatchObject({ spend: null, impressions: null, clicks: null });
  });
  it('requests only metrics the parser understands', () => {
    expect(TIKTOK_REPORT_METRICS).toEqual(expect.arrayContaining(['spend', 'impressions', 'reach', 'clicks']));
  });
});

describe('splitDateRange', () => {
  it('returns one window for short ranges', () => {
    expect(splitDateRange('2026-03-01', '2026-03-10', 30)).toEqual([{ start: '2026-03-01', end: '2026-03-10' }]);
  });
  it('splits long ranges into consecutive windows', () => {
    expect(splitDateRange('2026-03-01', '2026-04-15', 30)).toEqual([{ start: '2026-03-01', end: '2026-03-30' }, { start: '2026-03-31', end: '2026-04-15' }]);
  });
  it('handles a single day', () => {
    expect(splitDateRange('2026-03-01', '2026-03-01', 30)).toEqual([{ start: '2026-03-01', end: '2026-03-01' }]);
  });
});
