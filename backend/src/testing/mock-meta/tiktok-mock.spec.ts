import { createServer } from 'net';
import { createMockMetaServer } from './mock-meta-server';
import {
  buildTikTokReportRows, createTikTokRoutes, daysInRange, MOCK_TIKTOK_ADVERTISER, MOCK_TIKTOK_TOKENS, paginateTikTok, tiktokError,
} from './tiktok-mock';

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

interface Envelope<Data = Record<string, unknown>> {
  code: number;
  message: string;
  data?: Data;
}

type ListData = { list: Record<string, unknown>[]; page_info: { total_page: number } };

describe('tiktokError', () => {
  it('builds the TikTok error envelope', () => {
    expect(tiktokError(40_105, 'bad')).toEqual({ status: 200, body: { code: 40_105, message: 'bad', request_id: 'mock-request' } });
    expect(tiktokError(1, 'x', 404).status).toBe(404);
  });
});

describe('paginateTikTok', () => {
  const items = [1, 2, 3, 4, 5];
  it('slices pages and reports page_info', () => {
    expect(paginateTikTok(items, { page: '2', page_size: '2' }, 10).body).toMatchObject({ data: { list: [3, 4], page_info: { page: 2, page_size: 2, total_number: 5, total_page: 3 } } });
  });
  it('caps the page size and defaults to the first page', () => {
    expect(paginateTikTok(items, { page_size: '99' }, 3).body).toMatchObject({ data: { list: [1, 2, 3], page_info: { page: 1, total_page: 2 } } });
    expect(paginateTikTok([], {}, 3).body).toMatchObject({ data: { list: [], page_info: { total_page: 1 } } });
  });
});

describe('daysInRange', () => {
  it('lists every day inclusively', () => {
    expect(daysInRange('2026-03-01', '2026-03-03')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(daysInRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });
});

describe('buildTikTokReportRows', () => {
  const filter = (ids: string[]) => JSON.stringify([{ field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify(ids) }]);

  it('returns one row per ad and day, honouring the ad id filter', () => {
    const rows = buildTikTokReportRows({ dimensions: '["ad_id","stat_time_day"]', start_date: '2026-03-01', end_date: '2026-03-02', filtering: filter(['ta1', 'ta2']) });
    expect(rows).toHaveLength(4);
    expect(rows[0].dimensions).toEqual({ ad_id: 'ta1', stat_time_day: '2026-03-01 00:00:00' });
    expect(rows[0].metrics).toMatchObject({ spend: '10.00', average_video_play: '4.5' });
  });
  it('returns one range row per ad without a time dimension, and "-" video metrics for image ads', () => {
    const rows = buildTikTokReportRows({ dimensions: '["ad_id"]', start_date: '2026-03-01', end_date: '2026-03-10', filtering: filter(['ta2']) });
    expect(rows).toHaveLength(1);
    expect(rows[0].dimensions).toEqual({ ad_id: 'ta2' });
    expect(rows[0].metrics).toMatchObject({ average_video_play: '-', video_views_p25: '-' });
  });
  it('covers all ads when unfiltered', () => {
    expect(buildTikTokReportRows({ start_date: '2026-03-01', end_date: '2026-03-01' })).toHaveLength(3);
  });
});

describe('createTikTokRoutes', () => {
  const routes = createTikTokRoutes({ publicUrl: 'http://mock:4010', pageSize: 2 });
  const call = (path: string, query: Record<string, string> = {}, token: string | null = MOCK_TIKTOK_TOKENS.valid) =>
    routes({ path: `open_api/v1.3/${path}`, query: { advertiser_id: MOCK_TIKTOK_ADVERTISER.advertiser_id, ...query }, token: token ?? undefined })?.body as Envelope<ListData>;

  it('ignores paths outside the TikTok API', () => {
    expect(routes({ path: 'v24.0/me', query: {} })).toBeNull();
  });
  it('rejects missing, unknown and expired tokens', () => {
    expect(call('ad/get/', {}, null).code).toBe(40_102);
    expect(call('ad/get/', {}, 'nope').code).toBe(40_105);
    expect(call('ad/get/', {}, MOCK_TIKTOK_TOKENS.expired).code).toBe(40_105);
  });
  it('rejects unknown endpoints and advertisers without access', () => {
    expect(routes({ path: 'open_api/v1.3/nope/', query: {}, token: MOCK_TIKTOK_TOKENS.valid })).toMatchObject({ status: 404 });
    expect(call('ad/get/', { advertiser_id: '999' }).message).toMatch(/permission/);
    expect(call('ad/get/', {}, MOCK_TIKTOK_TOKENS.noAccess).message).toMatch(/permission/);
  });
  it('returns advertiser info only for accessible advertisers', () => {
    expect(call('advertiser/info/', { advertiser_ids: '["7001001"]' }).data?.list).toEqual([MOCK_TIKTOK_ADVERTISER]);
    expect(call('advertiser/info/', { advertiser_ids: '["1"]' }).data?.list).toEqual([]);
    expect(call('advertiser/info/', { advertiser_ids: '["7001001"]' }, MOCK_TIKTOK_TOKENS.noAccess).data?.list).toEqual([]);
  });
  it('filters ads by name, campaign and ad group, and paginates', () => {
    expect(call('ad/get/', { filtering: '{"ad_name":"SUMMER"}' }).data?.list.map((ad) => ad.ad_id)).toEqual(['ta1', 'ta2']);
    expect(call('ad/get/', { filtering: '{"campaign_ids":["tc2"]}' }).data?.list.map((ad) => ad.ad_id)).toEqual(['ta3']);
    expect(call('ad/get/', { filtering: '{"adgroup_ids":["tg1"]}' }).data?.list).toHaveLength(2);
    expect(call('ad/get/', {}).data?.page_info.total_page).toBe(2);
    expect(call('ad/get/', { page: '2' }).data?.list.map((ad) => ad.ad_id)).toEqual(['ta3']);
  });
  it('filters campaigns and ad groups', () => {
    expect(call('campaign/get/', { filtering: '{"campaign_name":"winter"}' }).data?.list.map((item) => item.campaign_id)).toEqual(['tc2']);
    expect(call('campaign/get/', { filtering: '{"campaign_ids":["tc1"]}' }).data?.list).toHaveLength(1);
    expect(call('adgroup/get/', { filtering: '{"adgroup_name":"gen z"}' }).data?.list.map((item) => item.adgroup_id)).toEqual(['tg1']);
    expect(call('adgroup/get/', { filtering: '{"adgroup_ids":["tg2"]}' }).data?.list).toHaveLength(1);
  });
  it('serves video covers and images from the media host', () => {
    expect(call('file/video/ad/info/', { video_ids: '["tv1","tv9"]' }).data?.list).toEqual([expect.objectContaining({ video_id: 'tv1', video_cover_url: 'http://mock:4010/media/thumb.jpg' })]);
    expect(call('file/image/ad/info/', { image_ids: '["ti1","zzz"]' }).data?.list).toEqual([expect.objectContaining({ image_id: 'ti1', image_url: 'http://mock:4010/media/image.jpg' })]);
  });
  it('serves reports', () => {
    expect(call('report/integrated/get/', { dimensions: '["ad_id"]', start_date: '2026-03-01', end_date: '2026-03-02' }).data?.list).toHaveLength(3);
  });
});

describe('mock server TikTok routing', () => {
  let stop: () => Promise<void>;
  let baseUrl: string;
  let mock: ReturnType<typeof createMockMetaServer>;

  beforeAll(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    mock = createMockMetaServer({ publicUrl: baseUrl });
    await mock.start(port);
    stop = mock.stop;
  });
  afterAll(() => stop());
  beforeEach(async () => {
    await fetch(`${baseUrl}/__admin/reset`, { method: 'POST' });
  });

  const call = async (path: string, token: string | null = MOCK_TIKTOK_TOKENS.valid) => {
    const response = await fetch(`${baseUrl}/open_api/v1.3/${path}?advertiser_id=7001001`, { headers: token ? { 'Access-Token': token } : {} });
    return { status: response.status, body: (await response.json()) as Envelope<ListData> };
  };
  const injectFailure = (failure: Record<string, unknown>) =>
    fetch(`${baseUrl}/__admin/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(failure) });

  it('reads the token from the Access-Token header', async () => {
    expect((await call('ad/get/')).body).toMatchObject({ code: 0, data: { list: [{ ad_id: 'ta1' }, { ad_id: 'ta2' }] } });
    expect((await call('ad/get/', null)).body.code).toBe(40_102);
  });

  it('injects TikTok-shaped failures and logs requests', async () => {
    await injectFailure({ match: 'campaign/get', times: 1, status: 200, error: { code: 40_100, message: 'Too many requests' } });
    expect((await call('campaign/get/')).body).toMatchObject({ code: 40_100, message: 'Too many requests' });
    expect((await call('campaign/get/')).body.code).toBe(0);
    await injectFailure({ match: 'adgroup/get', times: 1 });
    expect((await call('adgroup/get/')).body).toMatchObject({ code: 2, message: 'Injected failure' });
    expect(mock.requests.map((entry) => entry.path)).toContain('open_api/v1.3/campaign/get/');
  });
});
