import { createServer } from 'net';
import { MOCK_CODES, MOCK_TOKENS } from './fixtures';
import { applyFiltering, createMockMetaServer, graphError } from './mock-meta-server';

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

describe('applyFiltering', () => {
  const items = [{ name: 'Summer Sale', campaign: 'c1' }, { name: 'Winter', campaign: 'c2' }];
  const resolvers = { name: (item: (typeof items)[number]) => item.name, 'campaign.id': (item: (typeof items)[number]) => item.campaign };
  it('matches CONTAIN case-insensitively', () => {
    expect(applyFiltering(items, [{ field: 'name', operator: 'CONTAIN', value: 'SALE' }], resolvers)).toEqual([items[0]]);
  });
  it('matches IN', () => {
    expect(applyFiltering(items, [{ field: 'campaign.id', operator: 'IN', value: ['c2'] }], resolvers)).toEqual([items[1]]);
  });
  it('ignores unknown fields and operators', () => {
    expect(applyFiltering(items, [{ field: 'other', operator: 'CONTAIN', value: 'x' }, { field: 'name', operator: 'GREATER_THAN', value: 'x' }], resolvers)).toHaveLength(2);
  });
});

describe('graphError', () => {
  it('builds the Graph error envelope', () => {
    expect(graphError(400, 190, 'bad', { is_transient: true })).toEqual({
      status: 400, body: { error: { message: 'bad', type: 'OAuthException', code: 190, fbtrace_id: 'MOCKTRACE', is_transient: true } },
    });
  });
});

interface GraphRow {
  id: string;
  permission: string;
  url: string;
  creative: { thumbnail_url: string };
}

interface GraphBody {
  data: GraphRow[];
  error: { code: number; message: string; is_transient?: boolean };
  paging: { next: string };
  async_status: string;
  access_token: string;
  expires_in: number;
  id: string;
}

describe('mock Meta server (over HTTP)', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  let requests: ReturnType<typeof createMockMetaServer>['requests'];

  beforeAll(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const mock = createMockMetaServer({ publicUrl: baseUrl });
    await mock.start(port);
    ({ stop, requests } = mock);
  });
  afterAll(() => stop());
  beforeEach(async () => {
    await fetch(`${baseUrl}/__admin/reset`, { method: 'POST' });
  });

  const call = async (path: string, token: string = MOCK_TOKENS.valid, parameters: Record<string, string> = {}) => {
    const response = await fetch(`${baseUrl}/v24.0/${path}?${new URLSearchParams({ access_token: token, ...parameters })}`, { redirect: 'manual' });
    const text = await response.text();
    const isJson = Boolean(text) && Boolean(response.headers.get('content-type')?.includes('json'));
    return { status: response.status, body: (isJson ? JSON.parse(text) : {}) as GraphBody, headers: response.headers };
  };

  it('serves the profile and permissions, with ads_read missing for the restricted token', async () => {
    expect((await call('me')).body).toMatchObject({ id: 'mock-user-1' });
    expect((await call('me/permissions')).body.data.map((entry) => entry.permission)).toEqual(['ads_read', 'business_management']);
    expect((await call('me/permissions', MOCK_TOKENS.noAdsRead)).body.data.map((entry) => entry.permission)).toEqual(['email']);
  });

  it('rejects expired, missing and malformed tokens with Graph error codes (and echoes malformed tokens)', async () => {
    expect(await call('me', MOCK_TOKENS.expired)).toMatchObject({ status: 401, body: { error: { code: 190 } } });
    expect((await call('me', '')).body.error.code).toBe(2500);
    const malformed = await call('me', 'EAA_FAKE_TOKEN_123');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.message).toContain('EAA_FAKE_TOKEN_123');
  });

  it('denies ad endpoints for the token without ad access', async () => {
    expect(await call('act_1001/ads', MOCK_TOKENS.noPermission)).toMatchObject({ status: 403, body: { error: { code: 200 } } });
    expect((await call('me/adaccounts', MOCK_TOKENS.noPermission)).body.data).toEqual([]);
  });

  it('lists personal, business and business-owned accounts', async () => {
    expect((await call('me/adaccounts')).body.data.map((account) => account.id)).toEqual(['act_1001']);
    expect((await call('me/businesses')).body.data[0].id).toBe('biz1');
    expect((await call('biz1/owned_ad_accounts')).body.data[0].id).toBe('act_1002');
    expect((await call('biz1/client_ad_accounts')).body.data).toEqual([]);
    expect((await call('act_1002')).body.id).toBe('act_1002');
  });

  it('filters ads by name, campaign and ad set, and embeds media URLs', async () => {
    const byName = await call('act_1001/ads', MOCK_TOKENS.valid, { filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: 'summer' }]) });
    expect(byName.body.data.map((ad) => ad.id)).toEqual(['ad_1', 'ad_2']);
    expect(byName.body.data[0].creative.thumbnail_url).toBe(`${baseUrl}/media/thumb.jpg`);
    const byCampaign = await call('act_1001/ads', MOCK_TOKENS.valid, { filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ['c2'] }]) });
    expect(byCampaign.body.data.map((ad) => ad.id)).toEqual(['ad_3']);
    const bySet = await call('act_1001/ads', MOCK_TOKENS.valid, { filtering: JSON.stringify([{ field: 'adset.id', operator: 'IN', value: ['s1'] }]) });
    expect(bySet.body.data).toHaveLength(2);
  });

  it('paginates with paging.next links that keep working', async () => {
    const first = await call('act_1001/ads', MOCK_TOKENS.valid, { limit: '2' });
    expect(first.body.data).toHaveLength(2);
    expect(first.body.paging.next).toContain('after=2');
    const second = await (await fetch(first.body.paging.next)).json() as { data: unknown[]; paging?: unknown };
    expect(second.data).toHaveLength(1);
    expect(second.paging).toBeUndefined();
  });

  it('filters campaigns and ad sets by name and reads objects by id', async () => {
    const filter = JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: 'summer' }]);
    expect((await call('act_1001/campaigns', MOCK_TOKENS.valid, { filtering: filter })).body.data.map((campaign) => campaign.id)).toEqual(['c1']);
    expect((await call('act_1001/adsets', MOCK_TOKENS.valid, { filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: 'europe' }]) })).body.data[0].id).toBe('s2');
    expect(Object.keys((await call('', MOCK_TOKENS.valid, { ids: 'c1,s1,unknown' })).body)).toEqual(['c1', 's1']);
    expect((await call('act_1001/adcreatives')).body.data.length).toBe(2);
  });

  it('serves synchronous insights for a range', async () => {
    const response = await call('act_1001/insights', MOCK_TOKENS.valid, {
      time_range: JSON.stringify({ since: '2026-03-01', until: '2026-03-02' }), time_increment: '1', filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: ['ad_1'] }]),
    });
    expect(response.body.data).toHaveLength(2);
    expect(response.headers.get('x-app-usage')).toContain('call_count');
  });

  it('runs asynchronous insight reports: create, poll (running then completed), fetch', async () => {
    const parameters = { time_range: JSON.stringify({ since: '2026-03-01', until: '2026-03-01' }), time_increment: '1', filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: ['ad_2'] }]) };
    const created = await fetch(`${baseUrl}/v24.0/act_1001/insights`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: MOCK_TOKENS.valid, ...parameters }) });
    const { report_run_id: reportId } = (await created.json()) as { report_run_id: string };
    expect((await call(reportId)).body.async_status).toBe('Job Running');
    expect((await call(reportId)).body.async_status).toBe('Job Completed');
    expect((await call(`${reportId}/insights`)).body.data).toHaveLength(1);
    expect((await call('report-999')).status).toBe(400);
    expect((await call('report-999/insights')).status).toBe(400);
  });

  it('serves ad images, videos and media bytes', async () => {
    const images = await call('act_1001/adimages', MOCK_TOKENS.valid, { hashes: JSON.stringify(['h1', 'zzz']) });
    expect(images.body.data).toHaveLength(1);
    expect(images.body.data[0].url).toBe(`${baseUrl}/media/image.jpg?sig=1`);
    expect((await call('v1')).body).toMatchObject({ id: 'v1', source: `${baseUrl}/media/video.mp4?sig=1` });
    expect((await call('v99')).status).toBe(400);

    const video = await fetch(`${baseUrl}/media/video.mp4`);
    expect(video.headers.get('content-type')).toBe('video/mp4');
    expect((await video.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await fetch(`${baseUrl}/media/image.jpg`)).headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${baseUrl}/media/forbidden.mp4`)).status).toBe(403);
  });

  it('implements the OAuth code and long-lived token exchange plus the login dialog redirect', async () => {
    const short = await call('oauth/access_token', '', { client_id: 'a', client_secret: 's', redirect_uri: 'http://app/cb', code: MOCK_CODES.validOAuthCode });
    expect(short.body.access_token).toBe(MOCK_TOKENS.valid);
    expect((await call('oauth/access_token', '', { code: MOCK_CODES.invalidOAuthCode })).status).toBe(400);
    const long = await call('oauth/access_token', '', { grant_type: 'fb_exchange_token', fb_exchange_token: MOCK_TOKENS.valid });
    expect(long.body).toMatchObject({ access_token: MOCK_TOKENS.longLived, expires_in: 5_184_000 });
    expect((await call('oauth/access_token', '', { grant_type: 'fb_exchange_token', fb_exchange_token: 'x' })).status).toBe(400);
    expect(((await call('debug_token', 'app|secret', { input_token: MOCK_TOKENS.valid })).body as unknown as { data: { is_valid: boolean } }).data.is_valid).toBe(true);

    const dialog = await call('dialog/oauth', '', { redirect_uri: 'http://app/cb', state: 'abc' });
    expect(dialog.status).toBe(302);
    expect(dialog.headers.get('location')).toBe(`http://app/cb?code=${MOCK_CODES.validOAuthCode}&state=abc`);
  });

  it('searches the ad library', async () => {
    expect((await call('ads_archive', MOCK_TOKENS.valid, { search_terms: 'shoes' })).body.data).toHaveLength(1);
    expect((await call('ads_archive', MOCK_TOKENS.valid, { search_terms: 'nothing' })).body.data).toHaveLength(0);
  });

  it('injects failures a limited number of times, then recovers', async () => {
    await fetch(`${baseUrl}/__admin/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ match: 'act_1001/ads', times: 2, status: 500, error: { code: 2, is_transient: true, message: 'Temporary' } }) });
    expect((await call('act_1001/ads')).status).toBe(500);
    expect((await call('act_1001/ads')).body.error.is_transient).toBe(true);
    expect((await call('act_1001/ads')).status).toBe(200);
  });

  it('matches injected failures against query parameters too', async () => {
    await fetch(`${baseUrl}/__admin/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ match: 'breakdowns=country', times: 1, status: 400, error: { code: 100, message: 'Unsupported breakdown' } }) });
    const parameters = { time_range: JSON.stringify({ since: '2026-03-01', until: '2026-03-01' }) };
    expect((await call('act_1001/insights', MOCK_TOKENS.valid, { ...parameters, breakdowns: 'impression_device' })).status).toBe(200);
    expect((await call('act_1001/insights', MOCK_TOKENS.valid, { ...parameters, breakdowns: 'country' })).status).toBe(400);
    expect((await call('act_1001/insights', MOCK_TOKENS.valid, { ...parameters, breakdowns: 'country' })).status).toBe(200);
  });

  it('delays responses when latency is configured and clears it on reset', async () => {
    await fetch(`${baseUrl}/__admin/latency`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: 150 }) });
    const startedAt = Date.now();
    await call('me');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
    await fetch(`${baseUrl}/__admin/reset`, { method: 'POST' });
    const resetStartedAt = Date.now();
    await call('me');
    expect(Date.now() - resetStartedAt).toBeLessThan(140);
  });

  it('records requests with the access token redacted and resets on demand', async () => {
    await call('me');
    const log = (await (await fetch(`${baseUrl}/__admin/requests`)).json()) as { path: string; query: Record<string, string> }[];
    expect(log).toEqual([expect.objectContaining({ path: 'me', query: expect.objectContaining({ access_token: '[redacted]' }) })]);
    expect(requests).toHaveLength(1);
    await fetch(`${baseUrl}/__admin/reset`, { method: 'POST' });
    expect(requests).toHaveLength(0);
  });

  it('answers unknown routes with a Graph-style 404', async () => {
    expect(await call('nope/nothing')).toMatchObject({ status: 404, body: { error: { code: 803 } } });
  });
});
