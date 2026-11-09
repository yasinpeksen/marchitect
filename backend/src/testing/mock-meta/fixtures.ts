/** Deterministic Meta Graph fixtures served by the mock server (test/dev environments only). */

export const MOCK_TOKENS = {
  valid: 'EAA_MOCK_VALID_TOKEN',
  longLived: 'EAA_MOCK_LONG_LIVED_TOKEN',
  noAdsRead: 'EAA_MOCK_NO_ADS_READ',
  expired: 'EAA_MOCK_EXPIRED_TOKEN',
  noPermission: 'EAA_MOCK_NO_PERMISSION',
} as const;

export const MOCK_CODES = { validOAuthCode: 'mock-valid-code', invalidOAuthCode: 'mock-invalid-code' } as const;

export const MOCK_USER = { id: 'mock-user-1', name: 'Mock User' };
export const MOCK_BUSINESS = { id: 'biz1', name: 'Mock Business' };

export interface MockAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export const PERSONAL_ACCOUNT: MockAccount = {
  id: 'act_1001', account_id: '1001', name: 'Mock Personal Account', currency: 'USD', timezone_name: 'America/Los_Angeles', account_status: 1,
};
export const BUSINESS_ACCOUNT: MockAccount = {
  id: 'act_1002', account_id: '1002', name: 'Mock Business Account', currency: 'EUR', timezone_name: 'Europe/Berlin', account_status: 1,
};

export const CAMPAIGNS = [
  { id: 'c1', name: 'Summer Sale Campaign', objective: 'OUTCOME_SALES', status: 'ACTIVE', effective_status: 'ACTIVE', buying_type: 'AUCTION', daily_budget: '5000' },
  { id: 'c2', name: 'Winter Promo Campaign', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', effective_status: 'PAUSED', buying_type: 'AUCTION', lifetime_budget: '90000' },
];

export const AD_SETS = [
  {
    id: 's1', campaign_id: 'c1', name: 'US Adults 25-44', status: 'ACTIVE', effective_status: 'ACTIVE', optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS',
    targeting: { age_min: 25, age_max: 44, genders: [2], geo_locations: { countries: ['US'] }, publisher_platforms: ['facebook', 'instagram'] },
  },
  {
    id: 's2', campaign_id: 'c2', name: 'Europe Broad', status: 'PAUSED', effective_status: 'PAUSED', optimization_goal: 'LINK_CLICKS', billing_event: 'LINK_CLICKS',
    targeting: { age_min: 18, geo_locations: { countries: ['DE', 'FR'] } },
  },
];

export const ADS = [
  {
    id: 'ad_1', name: 'Summer Sale Video', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-02-01T10:00:00+0000', updated_time: '2026-02-02T10:00:00+0000',
    campaign_id: 'c1', adset_id: 's1',
    creative: {
      id: 'cr_1', name: 'Summer video creative', object_type: 'VIDEO', thumbnail_url: 'MEDIA_URL/thumb.jpg', video_id: 'v1',
      object_story_spec: { video_data: { video_id: 'v1', title: 'Summer deals', message: 'Save big this summer', call_to_action: { type: 'SHOP_NOW', value: { link: 'https://shop.example.test/summer' } } } },
    },
  },
  {
    id: 'ad_2', name: 'Summer Banner', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-02-03T10:00:00+0000', updated_time: '2026-02-03T11:00:00+0000',
    campaign_id: 'c1', adset_id: 's1',
    creative: {
      id: 'cr_2', name: 'Summer banner creative', object_type: 'SHARE', image_hash: 'h1', thumbnail_url: 'MEDIA_URL/thumb.jpg',
      title: 'Summer banner', body: 'Fresh summer styles', call_to_action_type: 'LEARN_MORE',
    },
  },
  {
    id: 'ad_3', name: 'Winter Promo Dynamic', status: 'PAUSED', effective_status: 'PAUSED', created_time: '2026-01-10T10:00:00+0000', updated_time: '2026-01-11T10:00:00+0000',
    campaign_id: 'c2', adset_id: 's2',
    creative: {
      id: 'cr_3', name: 'Winter dynamic creative', object_type: 'SHARE', thumbnail_url: 'MEDIA_URL/thumb.jpg',
      asset_feed_spec: {
        bodies: [{ text: 'Stay warm' }, { text: 'Winter is coming' }], titles: [{ text: 'Winter promo' }], images: [{ hash: 'h3a' }, { hash: 'h3b' }],
        call_to_action_types: ['SHOP_NOW'], link_urls: [{ website_url: 'https://shop.example.test/winter' }],
      },
    },
  },
];

export const AD_INDEX: Record<string, number> = { ad_1: 0, ad_2: 1, ad_3: 2 };

export const VIDEOS: Record<string, { id: string; length: number }> = { v1: { id: 'v1', length: 15 } };

export const IMAGES: Record<string, { hash: string; width: number; height: number }> = {
  h1: { hash: 'h1', width: 1200, height: 628 },
  h3a: { hash: 'h3a', width: 1080, height: 1080 },
  h3b: { hash: 'h3b', width: 1080, height: 1350 },
};

/** 1x1 transparent PNG. */
export const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** Not a playable video, just distinct bytes served as video/mp4. */
export const MP4_BYTES = Buffer.concat([Buffer.from('\u0000\u0000\u0000\u0018ftypmp42', 'binary'), Buffer.alloc(256, 7)]);
