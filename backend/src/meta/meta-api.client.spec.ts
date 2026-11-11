import { AppConfig } from '../common/app-config';
import { buildTestConfig } from '../testing/fake-supabase';
import {
  AD_FIELDS, computeBackoffDelay, isRateLimitCode, MetaApiClient, MetaApiError, MetaContext, pauseFromUsageHeaders, redactTokens,
} from './meta-api.client';

const context: MetaContext = { token: 'EAAtesttoken123456', connectionId: 'conn-1' };

const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });

/** Client whose sleeping is instant and recorded. */
class InstantClient extends MetaApiClient {
  readonly waits: number[] = [];
  protected override wait(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
    return Promise.resolve();
  }
}

const buildClient = (overrides: Record<string, unknown> = {}) => new InstantClient(buildTestConfig(overrides) as unknown as AppConfig);

describe('MetaApiError', () => {
  it.each([190, 102])('flags auth errors (%s)', (code) => expect(new MetaApiError('x', 400, code).isAuth).toBe(true));
  it.each([10, 200, 299])('flags permission errors (%s)', (code) => expect(new MetaApiError('x', 403, code).isPermission).toBe(true));
  it('does not flag unrelated codes', () => {
    const error = new MetaApiError('x', 400, 100);
    expect(error.isAuth).toBe(false);
    expect(error.isPermission).toBe(false);
  });
});

describe('redactTokens', () => {
  it('removes access tokens from messages', () => {
    expect(redactTokens('Malformed access token EAAFAKE_TOKEN_123 given')).toBe('Malformed access token [redacted-token] given');
  });
  it('leaves other text alone', () => expect(redactTokens('nothing to see')).toBe('nothing to see'));
});

describe('isRateLimitCode', () => {
  it.each([4, 17, 32, 613, 80_000, 80_014])('recognises %s', (code) => expect(isRateLimitCode(code)).toBe(true));
  it.each([undefined, 1, 190, 80_015])('ignores %s', (code) => expect(isRateLimitCode(code)).toBe(false));
});

describe('computeBackoffDelay', () => {
  const noJitter = () => 0;
  it('doubles per attempt', () => {
    expect(computeBackoffDelay({ attempt: 0, baseMs: 1000, random: noJitter })).toBe(1000);
    expect(computeBackoffDelay({ attempt: 3, baseMs: 1000, random: noJitter })).toBe(8000);
  });
  it('caps at one minute', () => expect(computeBackoffDelay({ attempt: 20, baseMs: 1000, random: noJitter })).toBe(60_000));
  it('adds up to 25% jitter', () => expect(computeBackoffDelay({ attempt: 0, baseMs: 1000, random: () => 1 })).toBe(1250));
  it('honours Retry-After when larger', () => expect(computeBackoffDelay({ attempt: 0, baseMs: 1000, retryAfterSeconds: 7, random: noJitter })).toBe(7000));
  it('waits at least 30s for rate limits', () => expect(computeBackoffDelay({ attempt: 0, baseMs: 1000, rateLimited: true, random: noJitter })).toBe(30_000));
});

describe('pauseFromUsageHeaders', () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  it('does not pause at comfortable usage', () => {
    expect(pauseFromUsageHeaders(headers({ 'x-app-usage': '{"call_count":20,"total_time":10}' }))).toBe(0);
    expect(pauseFromUsageHeaders(headers({}))).toBe(0);
  });
  it('pauses 15s when app usage is at 90%', () => expect(pauseFromUsageHeaders(headers({ 'x-app-usage': '{"call_count":92}' }))).toBe(15_000));
  it('pauses on ad account utilisation', () => expect(pauseFromUsageHeaders(headers({ 'x-ad-account-usage': '{"acc_id_util_pct":95}' }))).toBe(15_000));
  it('uses the estimated time to regain access from business use case usage', () => {
    const usage = JSON.stringify({ '123': [{ call_count: 100, estimated_time_to_regain_access: 2 }] });
    expect(pauseFromUsageHeaders(headers({ 'x-business-use-case-usage': usage }))).toBe(120_000);
  });
  it('caps the pause at ten minutes', () => {
    const usage = JSON.stringify({ '123': [{ estimated_time_to_regain_access: 60 }] });
    expect(pauseFromUsageHeaders(headers({ 'x-business-use-case-usage': usage }))).toBe(600_000);
  });
  it('ignores malformed headers', () => expect(pauseFromUsageHeaders(headers({ 'x-app-usage': 'not json' }))).toBe(0));
});

describe('MetaApiClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const requestedUrl = (callIndex = 0) => new URL(String(fetchMock.mock.calls[callIndex][0]));

  describe('get / post', () => {
    it('builds versioned URLs against the configurable base and sends the token as a parameter', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: '1' })));
      await buildClient().get(context, '/me', { fields: 'id,name' });
      const url = requestedUrl();
      expect(url.origin + url.pathname).toBe('https://graph.example.test/v24.0/me');
      expect(url.searchParams.get('fields')).toBe('id,name');
      expect(url.searchParams.get('access_token')).toBe('EAAtesttoken123456');
      expect(url.searchParams.has('appsecret_proof')).toBe(false);
    });

    it('uses a per-connection Graph version override', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
      await buildClient().get({ ...context, version: 'v22.0' }, 'me');
      expect(requestedUrl().pathname).toBe('/v22.0/me');
    });

    it('adds appsecret_proof for user tokens but not for app tokens', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
      const client = buildClient({ metaAppSecret: 'shh' });
      await client.get(context, 'me');
      expect(requestedUrl(0).searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
      await client.get({ token: 'app|secret' }, 'debug_token');
      expect(requestedUrl(1).searchParams.has('appsecret_proof')).toBe(false);
    });

    it('serialises object parameters as JSON and skips undefined ones', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
      await buildClient().get(context, 'act_1/ads', { filtering: [{ field: 'name', operator: 'CONTAIN', value: 'x' }], skipped: undefined, nothing: null });
      const url = requestedUrl();
      expect(JSON.parse(url.searchParams.get('filtering') as string)).toEqual([{ field: 'name', operator: 'CONTAIN', value: 'x' }]);
      expect(url.searchParams.has('skipped')).toBe(false);
      expect(url.searchParams.has('nothing')).toBe(false);
    });

    it('posts form-encoded bodies', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ report_run_id: 'r1' })));
      const result = await buildClient().post(context, 'act_1/insights', { level: 'ad' });
      expect(result).toEqual({ report_run_id: 'r1' });
      const [, init] = fetchMock.mock.calls[0];
      expect(init?.method).toBe('POST');
      expect(new URLSearchParams(String(init?.body)).get('level')).toBe('ad');
    });
  });

  describe('pagination', () => {
    it('follows paging.next until exhausted', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: [1, 2], paging: { next: 'https://graph.example.test/v24.0/page2' } }))
        .mockResolvedValueOnce(jsonResponse({ data: [3] }));
      expect(await buildClient().getAll(context, 'act_1/ads')).toEqual([1, 2, 3]);
      expect(String(fetchMock.mock.calls[1][0])).toBe('https://graph.example.test/v24.0/page2');
    });

    it('stops at maxItems and trims the result', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [1, 2, 3], paging: { next: 'https://graph.example.test/next' } })));
      expect(await buildClient().getAll(context, 'act_1/ads', {}, 2)).toEqual([1, 2]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('tolerates a page without data', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
      expect(await buildClient().getAll(context, 'x')).toEqual([]);
    });
  });

  describe('error handling and retries', () => {
    const errorBody = (code: number, extra: Record<string, unknown> = {}) => ({ error: { message: 'failure', code, ...extra } });

    it('retries transient errors with backoff and then succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(errorBody(2, { is_transient: true }), { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ id: 'ok' }));
      const client = buildClient();
      expect(await client.get(context, 'me')).toEqual({ id: 'ok' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(client.waits).toHaveLength(1);
    });

    it('waits at least 30 seconds after a rate limit error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(errorBody(17), { status: 400 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const client = buildClient();
      await client.get(context, 'me');
      expect(Math.max(...client.waits)).toBeGreaterThanOrEqual(30_000);
    });

    it('never retries auth errors', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(errorBody(190, { message: 'Malformed access token EAAFAKEFAKEFAKE' }), { status: 400 })));
      const failure = await buildClient().get(context, 'me').catch((caught: MetaApiError) => caught);
      expect(failure).toBeInstanceOf(MetaApiError);
      expect((failure as MetaApiError).isAuth).toBe(true);
      expect((failure as MetaApiError).message).toBe('Malformed access token [redacted-token]');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never retries permission errors', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(errorBody(200), { status: 403 })));
      await expect(buildClient().get(context, 'me')).rejects.toMatchObject({ isPermission: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives up after the configured number of retries', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(errorBody(1), { status: 500 })));
      await expect(buildClient({ metaMaxRetries: 2 }).get(context, 'me')).rejects.toBeInstanceOf(MetaApiError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries network failures and redacts tokens in their messages', async () => {
      fetchMock.mockRejectedValueOnce(new Error('socket hang up for EAAsecretsecret1')).mockResolvedValueOnce(jsonResponse({ id: 'ok' }));
      expect(await buildClient().get(context, 'me')).toEqual({ id: 'ok' });
      fetchMock.mockReset();
      fetchMock.mockRejectedValue(new Error('down EAAsecretsecret1'));
      await expect(buildClient({ metaMaxRetries: 0 }).get(context, 'me')).rejects.toThrow('[redacted-token]');
    });

    it('falls back to the HTTP status when the error body is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));
      await expect(buildClient({ metaMaxRetries: 0 }).get(context, 'me')).rejects.toThrow('Meta API HTTP 502');
    });

    it('pauses before the next call when usage headers report high usage', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true }, { headers: { 'x-app-usage': '{"call_count":95}' } })));
      const client = buildClient();
      await client.get(context, 'me');
      expect(client.waits).toHaveLength(0);
      await client.get(context, 'me');
      expect(client.waits).toHaveLength(1);
    });
  });

  describe('endpoint helpers', () => {
    it('reads the profile and permissions', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: '1' })));
      await buildClient().me(context);
      await buildClient().permissions(context);
      expect(requestedUrl(0).pathname).toBe('/v24.0/me');
      expect(requestedUrl(1).pathname).toBe('/v24.0/me/permissions');
    });

    it('merges personal and business ad accounts without duplicates', async () => {
      fetchMock.mockImplementation((input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/me/adaccounts')) return Promise.resolve(jsonResponse({ data: [{ id: 'act_1', name: 'Personal' }] }));
        if (path.endsWith('/me/businesses')) return Promise.resolve(jsonResponse({ data: [{ id: 'b1', name: 'Biz' }] }));
        if (path.endsWith('/b1/owned_ad_accounts')) return Promise.resolve(jsonResponse({ data: [{ id: 'act_1', name: 'Personal' }, { id: 'act_2', name: 'Owned' }] }));
        return Promise.resolve(jsonResponse({ data: [] }));
      });
      const accounts = await buildClient().listAdAccounts(context);
      expect(accounts.map((account) => account.id).sort()).toEqual(['act_1', 'act_2']);
      expect(accounts.find((account) => account.id === 'act_2')?.business).toEqual({ id: 'b1', name: 'Biz' });
    });

    it('still returns personal accounts when business_management is not granted', async () => {
      fetchMock.mockImplementation((input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/me/adaccounts')) return Promise.resolve(jsonResponse({ data: [{ id: 'act_1' }] }));
        return Promise.resolve(jsonResponse({ error: { message: 'no permission', code: 200 } }, { status: 403 }));
      });
      expect(await buildClient().listAdAccounts(context)).toEqual([{ id: 'act_1' }]);
    });

    it('propagates unrelated business lookup failures', async () => {
      fetchMock.mockImplementation((input) => {
        if (new URL(String(input)).pathname.endsWith('/me/adaccounts')) return Promise.resolve(jsonResponse({ data: [] }));
        return Promise.resolve(jsonResponse({ error: { message: 'bad token', code: 190 } }, { status: 401 }));
      });
      await expect(buildClient().listAdAccounts(context)).rejects.toMatchObject({ isAuth: true });
    });

    it('requests objects with their documented field lists', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
      const client = buildClient();
      await client.listCampaigns(context, 'act_1');
      await client.listAdSets(context, 'act_1');
      await client.listAds(context, 'act_1');
      await client.listAdCreatives(context, 'act_1');
      await client.listAdImages(context, 'act_1', ['h1', 'h2']);
      await client.getAdAccount(context, 'act_1');
      await client.getVideo(context, 'v1');
      await client.getMany(context, ['1', '2'], 'id,name');
      const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
      expect(paths).toEqual([
        '/v24.0/act_1/campaigns', '/v24.0/act_1/adsets', '/v24.0/act_1/ads', '/v24.0/act_1/adcreatives',
        '/v24.0/act_1/adimages', '/v24.0/act_1', '/v24.0/v1', '/v24.0/',
      ]);
      expect(requestedUrl(2).searchParams.get('fields')).toBe(AD_FIELDS);
      expect(JSON.parse(requestedUrl(4).searchParams.get('hashes') as string)).toEqual(['h1', 'h2']);
      expect(requestedUrl(7).searchParams.get('ids')).toBe('1,2');
    });

    it('queries the Ad Library endpoint', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
      await buildClient().adLibrary(context, { search_terms: 'shoes' });
      expect(requestedUrl().pathname).toBe('/v24.0/ads_archive');
      expect(requestedUrl().searchParams.get('search_terms')).toBe('shoes');
    });
  });

  describe('listAdLibrary', () => {
    it('pages through Ad Library results up to the cap', async () => {
      fetchMock
        .mockImplementationOnce(() => Promise.resolve(jsonResponse({ data: [{ id: 'l1' }, { id: 'l2' }], paging: { next: 'https://graph.example.test/v24.0/ads_archive?after=2' } })))
        .mockImplementationOnce(() => Promise.resolve(jsonResponse({ data: [{ id: 'l3' }] })));
      expect((await buildClient().listAdLibrary(context, { search_terms: 'shoes' }, 10)).map((entry) => entry.id)).toEqual(['l1', 'l2', 'l3']);
      expect(requestedUrl().pathname).toBe('/v24.0/ads_archive');
      expect(requestedUrl().searchParams.get('search_terms')).toBe('shoes');
    });
  });

  describe('insights', () => {
    it('fetches synchronous insights', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [{ ad_id: '1' }] })));
      expect(await buildClient().insights(context, 'act_1', { level: 'ad' })).toEqual([{ ad_id: '1' }]);
      expect(requestedUrl().pathname).toBe('/v24.0/act_1/insights');
    });

    it('runs asynchronous reports: create, poll until completed, then page the results', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ report_run_id: 'run9' }))
        .mockResolvedValueOnce(jsonResponse({ async_status: 'Job Running' }))
        .mockResolvedValueOnce(jsonResponse({ async_status: 'Job Completed' }))
        .mockResolvedValueOnce(jsonResponse({ data: [{ ad_id: '1' }] }));
      const client = buildClient();
      expect(await client.insightsAsync(context, 'act_1', { level: 'ad' }, 10_000)).toEqual([{ ad_id: '1' }]);
      expect(fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
        '/v24.0/act_1/insights', '/v24.0/run9', '/v24.0/run9', '/v24.0/run9/insights',
      ]);
      expect(client.waits).toHaveLength(1);
    });

    it.each(['Job Failed', 'Job Skipped'])('fails when the report ends as %s', async (status) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ report_run_id: 'run9' })).mockResolvedValueOnce(jsonResponse({ async_status: status }));
      await expect(buildClient().insightsAsync(context, 'act_1', {}, 10_000)).rejects.toThrow(`ended as "${status}"`);
    });

    it('times out a report that never completes', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ report_run_id: 'run9' })).mockImplementation(() => Promise.resolve(jsonResponse({ async_status: 'Job Running' })));
      await expect(buildClient().insightsAsync(context, 'act_1', {}, -1)).rejects.toThrow('timed out');
    });
  });
});
