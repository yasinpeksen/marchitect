import { AppConfig } from '../common/app-config';
import { buildTestConfig } from '../testing/fake-supabase';
import { encodeTikTokParameters, TikTokApiClient, TikTokApiError, toTikTokError } from './tiktok-api.client';

const envelope = (data: unknown, code = 0, message = 'OK', status = 200) =>
  new Response(JSON.stringify({ code, message, data }), { status, headers: { 'content-type': 'application/json' } });

class InstantClient extends TikTokApiClient {
  readonly waits: number[] = [];

  protected override wait(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
    return Promise.resolve();
  }
}

const context = { token: 'tiktok-secret-token' };
const buildClient = () => new InstantClient(buildTestConfig({ metaMaxRetries: 2 }) as unknown as AppConfig);

describe('TikTokApiError', () => {
  it('flags auth failures by code and by HTTP 401', () => {
    expect(new TikTokApiError('x', 200, 40_105).isAuth).toBe(true);
    expect(new TikTokApiError('x', 401).isAuth).toBe(true);
    expect(new TikTokApiError('x', 200, 40_002).isAuth).toBe(false);
  });
  it('flags permission failures by HTTP 403 or message', () => {
    expect(new TikTokApiError('x', 403).isPermission).toBe(true);
    expect(new TikTokApiError('No permission to operate advertiser', 200, 40_001).isPermission).toBe(true);
    expect(new TikTokApiError('boom', 500).isPermission).toBe(false);
  });
  it('flags rate limits', () => {
    expect(new TikTokApiError('slow down', 200, 40_100).isRateLimit).toBe(true);
    expect(new TikTokApiError('x', 200, 1).isRateLimit).toBe(false);
  });
});

describe('toTikTokError', () => {
  it('is transient for rate limits, system errors and 5xx / 429', () => {
    expect(toTikTokError(200, { code: 40_100, message: 'Too many requests' }).transient).toBe(true);
    expect(toTikTokError(200, { code: 50_002, message: 'System error' }).transient).toBe(true);
    expect(toTikTokError(503, undefined).transient).toBe(true);
    expect(toTikTokError(429, undefined).transient).toBe(true);
  });
  it('is permanent for client errors and falls back to an HTTP message', () => {
    const error = toTikTokError(400, undefined);
    expect(error.transient).toBe(false);
    expect(error.message).toBe('TikTok API HTTP 400');
    expect(toTikTokError(200, { code: 40_002, message: 'Invalid metrics' })).toMatchObject({ code: 40_002, message: 'Invalid metrics', transient: false });
  });
});

describe('encodeTikTokParameters', () => {
  it('JSON-encodes objects and arrays, stringifies scalars, skips blanks', () => {
    const query = encodeTikTokParameters({ advertiser_id: '1', filtering: { ad_name: 'x' }, ids: ['1', '2'], page: 2, skipped: undefined, none: null });
    expect(Object.fromEntries(query)).toEqual({ advertiser_id: '1', filtering: '{"ad_name":"x"}', ids: '["1","2"]', page: '2' });
  });
});

describe('TikTokApiClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('sends the token in the Access-Token header, not in the URL, and unwraps data', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope({ list: [{ advertiser_id: '1' }] })));
    expect(await buildClient().advertiserInfo(context, ['1'])).toEqual([{ advertiser_id: '1' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://tiktok.example.test/open_api/v1.3/advertiser/info/?');
    expect(String(url)).not.toContain('tiktok-secret-token');
    expect((init?.headers as Record<string, string>)['Access-Token']).toBe('tiktok-secret-token');
  });

  it('retries transient failures with backoff and then succeeds', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(envelope(undefined, 40_100, 'Too many requests')))
      .mockImplementationOnce(() => Promise.reject(new Error('socket hang up')))
      .mockImplementation(() => Promise.resolve(envelope({ ok: true })));
    const client = buildClient();
    expect(await client.get(context, 'x/')).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.waits).toHaveLength(2);
    expect(client.waits[0]).toBeGreaterThanOrEqual(30_000); // rate limits always wait at least 30s
  });

  it('gives up after the maximum retries', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope(undefined, 50_001, 'System error', 200)));
    await expect(buildClient().get(context, 'x/')).rejects.toMatchObject({ code: 50_001 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry auth or permission failures', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope(undefined, 40_105, 'Access token is invalid')));
    await expect(buildClient().get(context, 'x/')).rejects.toMatchObject({ isAuth: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry plain parameter errors', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope(undefined, 40_002, 'Invalid metrics', 200)));
    await expect(buildClient().get(context, 'x/')).rejects.toThrow('Invalid metrics');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tolerates non-JSON error bodies', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>', { status: 400 })));
    await expect(buildClient().get(context, 'x/')).rejects.toThrow('TikTok API HTTP 400');
  });

  it('pages through every result page', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(envelope({ list: [{ ad_id: '1' }, { ad_id: '2' }], page_info: { page: 1, total_page: 2 } })))
      .mockImplementationOnce(() => Promise.resolve(envelope({ list: [{ ad_id: '3' }], page_info: { page: 2, total_page: 2 } })));
    const ads = await buildClient().listAds(context, '1', { ad_name: 'x' });
    expect(ads.map((ad) => ad.ad_id)).toEqual(['1', '2', '3']);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('page')).toBe('2');
  });

  it('stops at the item cap', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope({ list: [{ ad_id: '1' }, { ad_id: '2' }], page_info: { page: 1, total_page: 9 } })));
    expect(await buildClient().listAds(context, '1', {}, 1)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a missing list as empty', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope({})));
    expect(await buildClient().listCampaigns(context, '1', {})).toEqual([]);
    expect(await buildClient().advertiserInfo(context, ['1'])).toEqual([]);
  });

  it('calls the matching endpoints for ad groups, files and reports', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope({ list: [] })));
    const client = buildClient();
    await client.listAdGroups(context, '1', {});
    await client.videoInfo(context, '1', ['v1']);
    await client.imageInfo(context, '1', ['i1']);
    await client.report(context, { advertiser_id: '1' });
    const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
    expect(paths).toEqual([
      '/open_api/v1.3/adgroup/get/', '/open_api/v1.3/file/video/ad/info/', '/open_api/v1.3/file/image/ad/info/', '/open_api/v1.3/report/integrated/get/',
    ]);
    const reportQuery = new URL(String(fetchMock.mock.calls[3][0])).searchParams;
    expect(reportQuery.get('data_level')).toBe('AUCTION_AD');
    expect(reportQuery.get('report_type')).toBe('BASIC');
  });
});
