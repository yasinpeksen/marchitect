/**
 * Deterministic fake of the TikTok Marketing API (v1.3) for test and development environments.
 * Served by the mock Meta server under /open_api/v1.3/. Point the app at it with
 * TIKTOK_API_BASE_URL=http://<mock host>/open_api/v1.3 and add the host to MEDIA_ALLOWED_HOSTS.
 */

export const MOCK_TIKTOK_TOKENS = {
  valid: 'tiktok-mock-valid-token-0001',
  noAccess: 'tiktok-mock-no-access-token',
  expired: 'tiktok-mock-expired-token-01',
} as const;

export const MOCK_TIKTOK_ADVERTISER = {
  advertiser_id: '7001001', name: 'Mock TikTok Advertiser', currency: 'USD', timezone: 'Etc/GMT', display_timezone: 'America/New_York', status: 'STATUS_ENABLE', company: 'Mock Co',
};

export const TIKTOK_CAMPAIGNS = [
  { campaign_id: 'tc1', campaign_name: 'Summer TikTok Campaign', objective_type: 'CONVERSIONS', budget_mode: 'BUDGET_MODE_DAY', budget: 50, operation_status: 'ENABLE', secondary_status: 'CAMPAIGN_STATUS_DELIVERY_OK', create_time: '2026-02-01 08:00:00' },
  { campaign_id: 'tc2', campaign_name: 'Winter TikTok Campaign', objective_type: 'TRAFFIC', budget_mode: 'BUDGET_MODE_TOTAL', budget: 900, operation_status: 'DISABLE', secondary_status: 'CAMPAIGN_STATUS_DISABLE', create_time: '2026-01-05 08:00:00' },
];

export const TIKTOK_AD_GROUPS = [
  { adgroup_id: 'tg1', adgroup_name: 'US Gen Z', campaign_id: 'tc1', optimization_goal: 'CLICK', billing_event: 'CPC', budget_mode: 'BUDGET_MODE_DAY', budget: 20, placements: ['PLACEMENT_TIKTOK'], operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK', schedule_start_time: '2026-02-01 00:00:00' },
  { adgroup_id: 'tg2', adgroup_name: 'Europe Broad', campaign_id: 'tc2', optimization_goal: 'REACH', billing_event: 'CPM', budget_mode: 'BUDGET_MODE_TOTAL', budget: 400, placements: ['PLACEMENT_TIKTOK'], operation_status: 'DISABLE', secondary_status: 'ADGROUP_STATUS_CAMPAIGN_DISABLE', schedule_start_time: '2026-01-05 00:00:00' },
];

export const TIKTOK_ADS = [
  { ad_id: 'ta1', ad_name: 'Summer Dance Video', campaign_id: 'tc1', adgroup_id: 'tg1', ad_text: 'Dance into summer deals', call_to_action: 'SHOP_NOW', landing_page_url: 'https://shop.example.test/summer', display_name: 'Mock Brand', video_id: 'tv1', operation_status: 'ENABLE', secondary_status: 'AD_STATUS_DELIVERY_OK', create_time: '2026-02-01 10:00:00', modify_time: '2026-02-02 10:00:00' },
  { ad_id: 'ta2', ad_name: 'Summer Banner', campaign_id: 'tc1', adgroup_id: 'tg1', ad_text: 'Fresh summer styles', call_to_action: 'LEARN_MORE', landing_page_url: 'https://shop.example.test/banner', display_name: 'Mock Brand', image_ids: ['ti1'], operation_status: 'ENABLE', secondary_status: 'AD_STATUS_DELIVERY_OK', create_time: '2026-02-03 10:00:00', modify_time: '2026-02-03 11:00:00' },
  { ad_id: 'ta3', ad_name: 'Winter Promo Carousel', campaign_id: 'tc2', adgroup_id: 'tg2', ad_text: 'Stay warm', call_to_action: 'SHOP_NOW', landing_page_url: 'https://shop.example.test/winter', display_name: 'Mock Brand', image_ids: ['ti1', 'ti2'], operation_status: 'DISABLE', secondary_status: 'AD_STATUS_DISABLE', create_time: '2026-01-10 10:00:00', modify_time: '2026-01-11 10:00:00' },
];

export interface TikTokMockRequest {
  path: string;
  query: Record<string, string>;
  token?: string;
}

export interface TikTokMockResponse {
  status: number;
  body: unknown;
}

const envelope = (data: unknown): TikTokMockResponse => ({ status: 200, body: { code: 0, message: 'OK', request_id: 'mock-request', data } });
export const tiktokError = (code: number, message: string, status = 200): TikTokMockResponse => ({ status, body: { code, message, request_id: 'mock-request' } });

const parseJson = <Value>(text: string | undefined, fallback: Value): Value => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as Value;
  } catch {
    return fallback;
  }
};

const containsText = (value: string | undefined, text: string): boolean => (value ?? '').toLowerCase().includes(text.toLowerCase());

/** `page` / `page_size` slice with TikTok's `page_info`. */
export function paginateTikTok<Item>(items: Item[], query: Record<string, string>, maxPageSize: number): TikTokMockResponse {
  const pageSize = Math.min(Number(query.page_size) || maxPageSize, maxPageSize);
  const page = Math.max(Number(query.page) || 1, 1);
  return envelope({
    list: items.slice((page - 1) * pageSize, page * pageSize),
    page_info: { page, page_size: pageSize, total_number: items.length, total_page: Math.max(Math.ceil(items.length / pageSize), 1) },
  });
}

/** Inclusive list of YYYY-MM-DD days. */
export function daysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  for (let cursor = Date.parse(start); cursor <= Date.parse(end); cursor += 86_400_000) days.push(new Date(cursor).toISOString().slice(0, 10));
  return days;
}

/** Report rows: one per ad (and day when `stat_time_day` is a dimension). Video metrics are "-" for non-video ads. */
export function buildTikTokReportRows(query: Record<string, string>) {
  const dimensions = parseJson<string[]>(query.dimensions, ['ad_id']);
  const filter = parseJson<{ field_name: string; filter_value: string }[]>(query.filtering, []).find((clause) => clause.field_name === 'ad_ids');
  const wantedIds = filter ? parseJson<string[]>(filter.filter_value, []) : TIKTOK_ADS.map((ad) => ad.ad_id);
  const days = dimensions.includes('stat_time_day') ? daysInRange(query.start_date, query.end_date) : [undefined];
  return TIKTOK_ADS.filter((ad) => wantedIds.includes(ad.ad_id)).flatMap((ad, adIndex) =>
    days.map((day, dayIndex) => {
      const scale = (adIndex + 1) * (day ? 1 : days.length);
      const impressions = 1000 * (adIndex + 1) + dayIndex;
      const isVideo = Boolean(ad.video_id);
      return {
        dimensions: { ad_id: ad.ad_id, ...(day ? { stat_time_day: `${day} 00:00:00` } : {}) },
        metrics: {
          spend: (10 * scale).toFixed(2),
          impressions: String(impressions),
          reach: String(Math.round(impressions * 0.8)),
          clicks: String(20 * (adIndex + 1)),
          average_video_play: isVideo ? '4.5' : '-',
          video_views_p25: isVideo ? String(Math.round(impressions * 0.5)) : '-',
          video_views_p50: isVideo ? String(Math.round(impressions * 0.3)) : '-',
          video_views_p75: isVideo ? String(Math.round(impressions * 0.2)) : '-',
          video_views_p100: isVideo ? String(Math.round(impressions * 0.1)) : '-',
        },
      };
    }),
  );
}

/** Returns `null` when the path is not a TikTok endpoint. */
export function createTikTokRoutes(options: { publicUrl: string; pageSize: number }) {
  const mediaUrl = (file: string) => `${options.publicUrl}/media/${file}`;

  const tokenProblem = (request: TikTokMockRequest): TikTokMockResponse | null => {
    if (!request.token) return tiktokError(40_102, 'Access token is empty');
    if (request.token === MOCK_TIKTOK_TOKENS.expired) return tiktokError(40_105, 'Access token is invalid or expired');
    if (!Object.values<string>(MOCK_TIKTOK_TOKENS).includes(request.token)) return tiktokError(40_105, 'Access token is invalid or expired');
    return null;
  };

  const advertiserProblem = (request: TikTokMockRequest): TikTokMockResponse | null =>
    request.token === MOCK_TIKTOK_TOKENS.noAccess || request.query.advertiser_id !== MOCK_TIKTOK_ADVERTISER.advertiser_id
      ? tiktokError(40_001, 'No permission to operate advertiser')
      : null;

  type Filtering = Record<string, string | string[] | undefined>;
  const filteringOf = (request: TikTokMockRequest) => parseJson<Filtering>(request.query.filtering, {});

  const handlers: [RegExp, (request: TikTokMockRequest) => TikTokMockResponse][] = [
    [
      /^advertiser\/info\/$/,
      (request) => {
        const wanted = parseJson<string[]>(request.query.advertiser_ids, []);
        const accessible = request.token !== MOCK_TIKTOK_TOKENS.noAccess && wanted.includes(MOCK_TIKTOK_ADVERTISER.advertiser_id);
        return envelope({ list: accessible ? [MOCK_TIKTOK_ADVERTISER] : [] });
      },
    ],
    [
      /^campaign\/get\/$/,
      (request) => {
        const filtering = filteringOf(request);
        return paginateTikTok(
          TIKTOK_CAMPAIGNS.filter((campaign) => (!filtering.campaign_name || containsText(campaign.campaign_name, String(filtering.campaign_name))) && (!filtering.campaign_ids || (filtering.campaign_ids as string[]).includes(campaign.campaign_id))),
          request.query, options.pageSize,
        );
      },
    ],
    [
      /^adgroup\/get\/$/,
      (request) => {
        const filtering = filteringOf(request);
        return paginateTikTok(
          TIKTOK_AD_GROUPS.filter((adGroup) => (!filtering.adgroup_name || containsText(adGroup.adgroup_name, String(filtering.adgroup_name))) && (!filtering.adgroup_ids || (filtering.adgroup_ids as string[]).includes(adGroup.adgroup_id))),
          request.query, options.pageSize,
        );
      },
    ],
    [
      /^ad\/get\/$/,
      (request) => {
        const filtering = filteringOf(request);
        return paginateTikTok(
          TIKTOK_ADS.filter((ad) => (!filtering.ad_name || containsText(ad.ad_name, String(filtering.ad_name)))
            && (!filtering.campaign_ids || (filtering.campaign_ids as string[]).includes(ad.campaign_id))
            && (!filtering.adgroup_ids || (filtering.adgroup_ids as string[]).includes(ad.adgroup_id))),
          request.query, options.pageSize,
        );
      },
    ],
    [
      /^file\/video\/ad\/info\/$/,
      (request) => envelope({ list: parseJson<string[]>(request.query.video_ids, []).filter((id) => id === 'tv1').map((id) => ({ video_id: id, video_cover_url: mediaUrl('thumb.jpg'), preview_url: mediaUrl('video.mp4'), duration: 15 })) }),
    ],
    [
      /^file\/image\/ad\/info\/$/,
      (request) => envelope({ list: parseJson<string[]>(request.query.image_ids, []).filter((id) => ['ti1', 'ti2'].includes(id)).map((id) => ({ image_id: id, image_url: mediaUrl('image.jpg'), width: 1080, height: 1920 })) }),
    ],
    [/^report\/integrated\/get\/$/, (request) => paginateTikTok(buildTikTokReportRows(request.query), request.query, 1000)],
  ];

  return (request: TikTokMockRequest): TikTokMockResponse | null => {
    const match = /^open_api\/v\d+\.\d+\/(.+)$/.exec(request.path);
    if (!match) return null;
    const problem = tokenProblem(request);
    if (problem) return problem;
    for (const [pattern, handler] of handlers) {
      if (!pattern.test(match[1])) continue;
      return (pattern.source.startsWith('^advertiser') ? null : advertiserProblem(request)) ?? handler(request);
    }
    return tiktokError(40_002, `Unsupported endpoint: ${match[1]}`, 404);
  };
}
