import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import {
  AD_SETS, ADS, BUSINESS_ACCOUNT, CAMPAIGNS, IMAGES, MOCK_CODES, MOCK_TOKENS, MOCK_USER, MOCK_BUSINESS, MP4_BYTES, PERSONAL_ACCOUNT, PNG_BYTES, VIDEOS,
} from './fixtures';
import { buildInsightRows } from './insights';
import { createTikTokRoutes } from './tiktok-mock';

/**
 * A small fake of the Meta Graph / Marketing API for test and development environments.
 * It implements only the endpoints this app calls, with deterministic data, pagination,
 * asynchronous insight reports, OAuth, error injection and a request log. It also serves a fake TikTok
 * Marketing API under /open_api/v1.3/ (see tiktok-mock.ts).
 * Point the app at it with META_GRAPH_BASE_URL / META_DIALOG_BASE_URL / MEDIA_ALLOWED_HOSTS.
 */

export interface MockMetaOptions {
  /** Base URL clients use to reach this server (embedded in media and paging links). */
  publicUrl: string;
  /** Items per page for list endpoints, so pagination is exercised. */
  pageSize?: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

interface InjectedFailure {
  match: string;
  remaining: number;
  status: number;
  error: Record<string, unknown>;
}

interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
  contentType?: string;
}

interface Request {
  method: string;
  path: string;
  query: Record<string, string>;
  token?: string;
}

type Handler = (request: Request, match: RegExpMatchArray) => MockResponse;

const VERSION_PREFIX = /^\/v\d+\.\d+/;
const VALID_USER_TOKENS: string[] = [MOCK_TOKENS.valid, MOCK_TOKENS.longLived, MOCK_TOKENS.noPermission, MOCK_TOKENS.noAdsRead];

export const graphError = (status: number, code: number, message: string, extra: Record<string, unknown> = {}): MockResponse => ({
  status,
  body: { error: { message, type: 'OAuthException', code, fbtrace_id: 'MOCKTRACE', ...extra } },
});

const parseJson = <Value>(text: string | undefined, fallback: Value): Value => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as Value;
  } catch {
    return fallback;
  }
};

interface FilterClause {
  field: string;
  operator: string;
  value: string | string[];
}

/** Applies Meta-style `filtering` clauses to a list of records. */
export function applyFiltering<Item extends Record<string, unknown>>(
  items: Item[],
  clauses: FilterClause[],
  resolvers: Record<string, (item: Item) => string>,
): Item[] {
  return items.filter((item) =>
    clauses.every((clause) => {
      const resolve = resolvers[clause.field];
      if (!resolve) return true;
      const actual = resolve(item);
      if (clause.operator === 'CONTAIN') return actual.toLowerCase().includes(String(clause.value).toLowerCase());
      if (clause.operator === 'IN') return (clause.value as string[]).includes(actual);
      return true;
    }),
  );
}

export function createMockMetaServer(options: MockMetaOptions) {
  const publicUrl = options.publicUrl.replace(/\/$/, '');
  const pageSize = options.pageSize ?? 2;
  const tiktokRoutes = createTikTokRoutes({ publicUrl, pageSize });
  const requests: RecordedRequest[] = [];
  let failures: InjectedFailure[] = [];
  let latencyMs = 0;
  const reports = new Map<string, { parameters: Record<string, string>; polls: number }>();

  const withMediaUrls = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value).replaceAll('MEDIA_URL', `${publicUrl}/media`)) as Value;

  /** Slices `items` into a Graph-style page with `paging.next` when more remain. */
  const paginate = (request: Request, items: unknown[], defaultLimit = pageSize): MockResponse => {
    const limit = Math.min(Number(request.query.limit) || defaultLimit, defaultLimit);
    const offset = Number(request.query.after) || 0;
    const data = items.slice(offset, offset + limit);
    const body: Record<string, unknown> = { data };
    if (offset + limit < items.length) {
      const next = new URLSearchParams({ ...request.query, after: String(offset + limit), access_token: request.token ?? '' });
      body.paging = { next: `${publicUrl}/v24.0/${request.path}?${next}` };
    }
    return { status: 200, body, headers: { 'x-app-usage': '{"call_count":3,"total_cputime":1,"total_time":2}' } };
  };

  const filteringOf = (request: Request): FilterClause[] => parseJson<FilterClause[]>(request.query.filtering, []);

  // ------------------------------------------------------------------ auth
  const tokenProblem = (request: Request, requiresAdAccess: boolean): MockResponse | null => {
    const { token } = request;
    if (!token) return graphError(400, 2500, 'An active access token must be used to query information about the current user.');
    if (token === MOCK_TOKENS.expired) return graphError(401, 190, 'Error validating access token: Session has expired.');
    if (!VALID_USER_TOKENS.includes(token) && !token.includes('|')) return graphError(400, 190, `Malformed access token ${token}`);
    if (requiresAdAccess && token === MOCK_TOKENS.noPermission) return graphError(403, 200, '(#200) Requires ads_read permission to access this endpoint.');
    return null;
  };

  // -------------------------------------------------------------- handlers
  const accountsFor = (token: string | undefined): unknown[] => (token === MOCK_TOKENS.noPermission ? [] : [PERSONAL_ACCOUNT]);

  const handlers: [string, RegExp, Handler][] = [
    ['GET', /^me$/, () => ({ status: 200, body: MOCK_USER })],
    [
      'GET',
      /^me\/permissions$/,
      (request) => ({
        status: 200,
        body: {
          data:
            request.token === MOCK_TOKENS.noAdsRead
              ? [{ permission: 'email', status: 'granted' }]
              : [{ permission: 'ads_read', status: 'granted' }, { permission: 'business_management', status: 'granted' }],
        },
      }),
    ],
    ['GET', /^me\/adaccounts$/, (request) => paginate(request, accountsFor(request.token))],
    ['GET', /^me\/businesses$/, (request) => paginate(request, [MOCK_BUSINESS])],
    ['GET', /^biz1\/owned_ad_accounts$/, (request) => paginate(request, [BUSINESS_ACCOUNT])],
    ['GET', /^biz1\/client_ad_accounts$/, (request) => paginate(request, [])],
    ['GET', /^act_\d+$/, (_request, match) => ({ status: 200, body: [PERSONAL_ACCOUNT, BUSINESS_ACCOUNT].find((account) => account.id === match[0]) ?? PERSONAL_ACCOUNT })],
    ['GET', /^act_\d+\/campaigns$/, (request) => paginate(request, applyFiltering(CAMPAIGNS, filteringOf(request), { name: (item) => item.name }))],
    ['GET', /^act_\d+\/adsets$/, (request) => paginate(request, applyFiltering(AD_SETS, filteringOf(request), { name: (item) => item.name }))],
    [
      'GET',
      /^act_\d+\/ads$/,
      (request) =>
        paginate(
          request,
          withMediaUrls(
            applyFiltering(ADS, filteringOf(request), {
              name: (item) => item.name,
              'campaign.id': (item) => item.campaign_id,
              'adset.id': (item) => item.adset_id,
            }),
          ),
        ),
    ],
    ['GET', /^act_\d+\/adcreatives$/, (request) => paginate(request, withMediaUrls(ADS.map((ad) => ad.creative)))],
    [
      'GET',
      /^act_\d+\/adimages$/,
      (request) => {
        const hashes = parseJson<string[]>(request.query.hashes, []);
        return paginate(request, hashes.filter((hash) => hash in IMAGES).map((hash) => ({ ...IMAGES[hash], url: `${publicUrl}/media/image.jpg?sig=1` })));
      },
    ],
    [
      'GET',
      /^act_\d+\/insights$/,
      (request) => paginate(request, insightRowsFor(request.query), 500),
    ],
    [
      'POST',
      /^act_\d+\/insights$/,
      (request) => {
        const reportId = `report-${reports.size + 1}`;
        reports.set(reportId, { parameters: request.query, polls: 0 });
        return { status: 200, body: { report_run_id: reportId } };
      },
    ],
    [
      'GET',
      /^(report-\d+)$/,
      (_request, match) => {
        const report = reports.get(match[1]);
        if (!report) return graphError(400, 100, 'Unsupported get request. Object does not exist.');
        report.polls++;
        return { status: 200, body: { async_status: report.polls < 2 ? 'Job Running' : 'Job Completed', async_percent_completion: report.polls < 2 ? 50 : 100 } };
      },
    ],
    [
      'GET',
      /^(report-\d+)\/insights$/,
      (request, match) => {
        const report = reports.get(match[1]);
        return report ? paginate(request, insightRowsFor(report.parameters), 500) : graphError(400, 100, 'Unknown report');
      },
    ],
    ['GET', /^debug_token$/, () => ({ status: 200, body: { data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 60 * 86_400 } } })],
    ['GET', /^oauth\/access_token$/, (request) => oauthExchange(request)],
    [
      'GET',
      /^ads_archive$/,
      (request) => {
        const term = (request.query.search_terms ?? '').toLowerCase();
        const library = [{
          id: 'lib1', page_id: 'p1', page_name: 'Competitor Shoes', ad_creation_time: '2026-02-10', ad_creative_bodies: ['Buy running shoes now'], ad_creative_link_titles: ['Run faster'],
          ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=lib1', publisher_platforms: ['FACEBOOK', 'INSTAGRAM'],
        }];
        return paginate(request, library.filter((entry) => JSON.stringify(entry).toLowerCase().includes(term)));
      },
    ],
    ['GET', /^(v\d+)$/, (_request, match) => videoResponse(match[1])],
    ['GET', /^$/, (request) => idsResponse(request)],
  ];

  function insightRowsFor(parameters: Record<string, string>) {
    const range = parseJson<{ since: string; until: string }>(parameters.time_range, { since: '2026-01-01', until: '2026-01-01' });
    const adFilter = parseJson<FilterClause[]>(parameters.filtering, []).find((clause) => clause.field === 'ad.id');
    return buildInsightRows({
      adIds: (adFilter?.value as string[] | undefined) ?? ADS.map((ad) => ad.id),
      since: range.since,
      until: range.until,
      timeIncrement: parameters.time_increment ? Number(parameters.time_increment) : undefined,
      breakdowns: parameters.breakdowns,
    });
  }

  function oauthExchange(request: Request): MockResponse {
    if (request.query.grant_type === 'fb_exchange_token') {
      return request.query.fb_exchange_token === MOCK_TOKENS.valid
        ? { status: 200, body: { access_token: MOCK_TOKENS.longLived, token_type: 'bearer', expires_in: 5_184_000 } }
        : graphError(400, 190, 'Invalid token to exchange');
    }
    return request.query.code === MOCK_CODES.validOAuthCode
      ? { status: 200, body: { access_token: MOCK_TOKENS.valid, token_type: 'bearer', expires_in: 3600 } }
      : graphError(400, 100, 'Invalid verification code format.');
  }

  function videoResponse(videoId: string): MockResponse {
    const video = VIDEOS[videoId];
    if (!video) return graphError(400, 100, `Unsupported get request. Object with ID '${videoId}' does not exist.`);
    return { status: 200, body: { ...video, source: `${publicUrl}/media/video.mp4?sig=1`, picture: `${publicUrl}/media/thumb.jpg` } };
  }

  function idsResponse(request: Request): MockResponse {
    const ids = (request.query.ids ?? '').split(',').filter(Boolean);
    const known = new Map<string, unknown>([...CAMPAIGNS, ...AD_SETS].map((item) => [item.id, item]));
    return { status: 200, body: Object.fromEntries(ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)])) };
  }

  // ---------------------------------------------------------------- admin
  const adminRoutes = (request: Request, body: Record<string, unknown>): MockResponse | null => {
    if (request.path === '__admin/reset') {
      requests.length = 0;
      failures = [];
      latencyMs = 0;
      reports.clear();
      return { status: 200, body: { ok: true } };
    }
    if (request.path === '__admin/fail') {
      failures.push({ match: String(body.match), remaining: Number(body.times ?? 1), status: Number(body.status ?? 500), error: (body.error as Record<string, unknown>) ?? { code: 2, is_transient: true, message: 'Injected failure' } });
      return { status: 200, body: { ok: true } };
    }
    if (request.path === '__admin/latency') {
      latencyMs = Number(body.ms ?? 0);
      return { status: 200, body: { ok: true } };
    }
    if (request.path === '__admin/requests') return { status: 200, body: requests };
    return null;
  };

  const mediaRoutes = (path: string): MockResponse | null => {
    if (path === 'media/video.mp4') return { status: 200, raw: MP4_BYTES, contentType: 'video/mp4' };
    if (path === 'media/image.jpg' || path === 'media/thumb.jpg') return { status: 200, raw: PNG_BYTES, contentType: 'image/png' };
    if (path === 'media/forbidden.mp4') return { status: 403, body: { error: 'forbidden' } };
    return null;
  };

  /** Core routing: injected failures, token checks, then the endpoint table. */
  function route(request: Request, body: Record<string, unknown>): MockResponse {
    const admin = adminRoutes(request, body);
    if (admin) return admin;
    const media = mediaRoutes(request.path);
    if (media) return media;

    const { access_token: _token, ...visibleQuery } = request.query;
    const signature = `${request.path}?${new URLSearchParams(visibleQuery)}`;
    const injected = failures.find((failure) => failure.remaining > 0 && signature.includes(failure.match));
    if (injected) {
      injected.remaining--;
      if (request.path.startsWith('open_api/')) {
        return { status: injected.status, body: { code: Number(injected.error.code ?? 50_002), message: String(injected.error.message ?? 'Injected failure'), request_id: 'mock-request' } };
      }
      return { status: injected.status, body: { error: { type: 'OAuthException', fbtrace_id: 'MOCKTRACE', ...injected.error } } };
    }

    const tiktok = request.method === 'GET' ? tiktokRoutes(request) : null;
    if (tiktok) return tiktok;

    if (request.method === 'GET' && request.path.endsWith('dialog/oauth')) {
      const redirect = new URL(request.query.redirect_uri);
      redirect.searchParams.set('code', MOCK_CODES.validOAuthCode);
      redirect.searchParams.set('state', request.query.state ?? '');
      return { status: 302, headers: { location: redirect.toString() } };
    }

    const isOAuthStep = request.path.startsWith('oauth/') || request.path === 'debug_token';
    const problem = isOAuthStep ? null : tokenProblem(request, /^(act_|report-|\d)/.test(request.path) || request.path === '');
    if (problem) return problem;

    for (const [method, pattern, handler] of handlers) {
      const match = request.path.match(pattern);
      if (method === request.method && match) return handler(request, match);
    }
    return graphError(404, 803, `Unsupported ${request.method} request: ${request.path}`);
  }

  const readBody = (incoming: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunkBuffer: Buffer) => chunks.push(chunkBuffer));
      incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

  const respond = (response: ServerResponse, result: MockResponse) => {
    const headers: Record<string, string | number> = { ...result.headers };
    if (result.raw) {
      headers['content-type'] = result.contentType ?? 'application/octet-stream';
      headers['content-length'] = result.raw.length;
      response.writeHead(result.status, headers).end(result.raw);
      return;
    }
    headers['content-type'] = 'application/json';
    response.writeHead(result.status, headers).end(result.body === undefined ? '' : JSON.stringify(result.body));
  };

  const server: Server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', publicUrl);
      const bodyText = await readBody(incoming);
      const formFields = Object.fromEntries(new URLSearchParams(bodyText));
      const jsonFields = incoming.headers['content-type']?.includes('json') ? parseJson<Record<string, unknown>>(bodyText, {}) : {};
      const query: Record<string, string> = { ...Object.fromEntries(url.searchParams), ...formFields };
      const path = url.pathname.replace(VERSION_PREFIX, '').replace(/^\//, '');
      const request: Request = { method: incoming.method ?? 'GET', path, query, token: query.access_token ?? incoming.headers['access-token']?.toString() };
      if (!path.startsWith('__admin')) requests.push({ method: request.method, path, query: { ...query, access_token: query.access_token ? '[redacted]' : '' } });
      const result = route(request, { ...formFields, ...jsonFields });
      if (latencyMs > 0 && !path.startsWith('__admin')) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      respond(response, result);
    })();
  });

  return {
    server,
    requests,
    start: (port: number): Promise<number> =>
      new Promise((resolve) => {
        server.listen(port, '0.0.0.0', () => resolve((server.address() as { port: number }).port));
      }),
    stop: (): Promise<void> => new Promise((resolve) => server.close(() => resolve())),
  };
}
