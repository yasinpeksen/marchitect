import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AppConfig } from '../common/app-config';
import {
  MetaAd, MetaAdAccount, MetaAdSet, MetaCampaign, MetaCreative, MetaImage, MetaInsightRow, MetaLibraryAd, MetaVideo,
} from '../common/types';

export interface MetaContext {
  token: string;
  /** Graph API version override (per connection); defaults to META_GRAPH_VERSION. */
  version?: string | null;
  /** Used to scope usage-based throttling. */
  connectionId?: string;
}

export type RequestParameters = Record<string, string | number | boolean | object | undefined | null>;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly transient = false,
    readonly fbtraceId?: string,
  ) {
    super(message);
  }

  /** Invalid/expired token or missing session. */
  get isAuth(): boolean {
    return this.code === 190 || this.code === 102;
  }

  /** Missing permission or restricted object. Not retryable. */
  get isPermission(): boolean {
    return this.code === 10 || (this.code !== undefined && this.code >= 200 && this.code < 300);
  }
}

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

export const isRateLimitCode = (code?: number): boolean =>
  code !== undefined && (code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80_000 && code <= 80_014));

/** Meta sometimes echoes the access token inside error messages; never let it reach logs, DB or UI. */
export const redactTokens = (message: string): string => message.replaceAll(/EAA[\w-]{6,}/g, '[redacted-token]');

/**
 * Exponential backoff with jitter. Rate-limit errors always wait at least 30s and a server
 * `Retry-After` is honoured when larger.
 */
export function computeBackoffDelay(options: {
  attempt: number;
  baseMs: number;
  retryAfterSeconds?: number;
  rateLimited?: boolean;
  random?: () => number;
}): number {
  const { attempt, baseMs, retryAfterSeconds = 0, rateLimited = false, random = Math.random } = options;
  let delay = Math.min(baseMs * 2 ** attempt, 60_000);
  delay += random() * delay * 0.25;
  if (retryAfterSeconds > 0) delay = Math.max(delay, retryAfterSeconds * 1000);
  if (rateLimited) delay = Math.max(delay, 30_000);
  return delay;
}

/**
 * Reads Meta usage headers (x-app-usage, x-ad-account-usage, x-business-use-case-usage) and returns
 * how long to pause (ms) before the next call, or 0 when usage is comfortable.
 */
export function pauseFromUsageHeaders(headers: Headers): number {
  try {
    let worstPercent = 0;
    let regainMinutes = 0;
    const appUsage = headers.get('x-app-usage');
    if (appUsage) {
      const usage = JSON.parse(appUsage) as Record<string, number>;
      worstPercent = Math.max(usage.call_count ?? 0, usage.total_cputime ?? 0, usage.total_time ?? 0);
    }
    const accountUsage = headers.get('x-ad-account-usage');
    if (accountUsage) {
      worstPercent = Math.max(worstPercent, (JSON.parse(accountUsage) as Record<string, number>).acc_id_util_pct ?? 0);
    }
    const businessUsage = headers.get('x-business-use-case-usage');
    if (businessUsage) {
      for (const entries of Object.values(JSON.parse(businessUsage) as Record<string, Record<string, number>[]>)) {
        for (const usage of entries) {
          worstPercent = Math.max(worstPercent, usage.call_count ?? 0, usage.total_cputime ?? 0, usage.total_time ?? 0);
          regainMinutes = Math.max(regainMinutes, usage.estimated_time_to_regain_access ?? 0);
        }
      }
    }
    if (worstPercent < 90 && regainMinutes === 0) return 0;
    const pauseMs = regainMinutes > 0 ? regainMinutes * 60_000 : 15_000;
    return Math.min(pauseMs, 10 * 60_000);
  } catch {
    return 0; // malformed usage header: ignore
  }
}

export const CAMPAIGN_FIELDS =
  'id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,start_time,stop_time';
export const ADSET_FIELDS =
  'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time,targeting';
export const CREATIVE_FIELDS =
  'id,name,title,body,call_to_action_type,object_type,image_url,image_hash,thumbnail_url,video_id,object_story_spec,asset_feed_spec,url_tags';
export const AD_FIELDS = `id,name,status,effective_status,created_time,updated_time,campaign_id,adset_id,creative{${CREATIVE_FIELDS}}`;

interface Page<Item> {
  data?: Item[];
  paging?: { next?: string };
}

@Injectable()
export class MetaApiClient {
  private readonly logger = new Logger('MetaApi');
  /** connection -> epoch ms until which we should not call (usage headers said we are near the cap). */
  private readonly pauseUntil = new Map<string, number>();

  constructor(private readonly config: AppConfig) {}

  baseUrl(context: MetaContext): string {
    return `${this.config.metaGraphBaseUrl}/${context.version || this.config.metaGraphVersion}`;
  }

  protected wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private encodeParameters(context: MetaContext, parameters: RequestParameters): URLSearchParams {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(parameters)) {
      if (value === undefined || value === null) continue;
      query.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    query.set('access_token', context.token);
    if (this.config.metaAppSecret && !context.token.includes('|')) {
      query.set('appsecret_proof', createHmac('sha256', this.config.metaAppSecret).update(context.token).digest('hex'));
    }
    return query;
  }

  async get<Result = unknown>(context: MetaContext, path: string, parameters: RequestParameters = {}): Promise<Result> {
    const url = `${this.baseUrl(context)}/${path.replace(/^\//, '')}?${this.encodeParameters(context, parameters)}`;
    return this.request<Result>(context, url, { method: 'GET' });
  }

  async post<Result = unknown>(context: MetaContext, path: string, parameters: RequestParameters = {}): Promise<Result> {
    const url = `${this.baseUrl(context)}/${path.replace(/^\//, '')}`;
    return this.request<Result>(context, url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: this.encodeParameters(context, parameters).toString(),
    });
  }

  /** Follows `paging.next` until exhausted or `maxItems` reached. */
  async *pages<Item = unknown>(
    context: MetaContext,
    path: string,
    parameters: RequestParameters = {},
    maxItems = Infinity,
  ): AsyncGenerator<Item[]> {
    let url: string | undefined = `${this.baseUrl(context)}/${path.replace(/^\//, '')}?${this.encodeParameters(context, { limit: 200, ...parameters })}`;
    let itemsSeen = 0;
    while (url && itemsSeen < maxItems) {
      const page: Page<Item> = await this.request(context, url, { method: 'GET' });
      const items = page.data ?? [];
      itemsSeen += items.length;
      yield items;
      url = page.paging?.next;
    }
  }

  async getAll<Item = unknown>(context: MetaContext, path: string, parameters: RequestParameters = {}, maxItems = Infinity): Promise<Item[]> {
    const collected: Item[] = [];
    for await (const page of this.pages<Item>(context, path, parameters, maxItems)) collected.push(...page);
    return Number.isFinite(maxItems) ? collected.slice(0, maxItems) : collected;
  }

  private async request<Result>(context: MetaContext, url: string, init: RequestInit): Promise<Result> {
    const throttleKey = context.connectionId ?? 'default';
    let attempt = 0;
    for (;;) {
      const waitMs = (this.pauseUntil.get(throttleKey) ?? 0) - Date.now();
      if (waitMs > 0) await this.wait(Math.min(waitMs, 10 * 60_000));

      let response: Response | undefined;
      let networkError: unknown;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
      } catch (error) {
        networkError = error;
      }

      if (response) {
        const pauseMs = pauseFromUsageHeaders(response.headers);
        if (pauseMs > 0) {
          this.pauseUntil.set(throttleKey, Date.now() + pauseMs);
          this.logger.warn(`Meta usage high; pausing ${Math.round(pauseMs / 1000)}s`);
        }
        if (response.ok) return (await response.json()) as Result;
      }

      const apiError = response
        ? await this.toError(response)
        : new MetaApiError(redactTokens(`Network error: ${String(networkError)}`), 0, undefined, undefined, true);
      const retryable = (apiError.transient || apiError.status === 429 || apiError.status >= 500 || apiError.status === 0)
        && !apiError.isAuth && !apiError.isPermission;
      if (!retryable || attempt >= this.config.metaMaxRetries) throw apiError;

      const rateLimited = isRateLimitCode(apiError.code);
      const delay = computeBackoffDelay({
        attempt,
        baseMs: this.config.metaRetryBaseMs,
        retryAfterSeconds: Number(response?.headers.get('retry-after')),
        rateLimited,
      });
      if (rateLimited) this.pauseUntil.set(throttleKey, Date.now() + delay);
      attempt++;
      this.logger.warn(`Meta call failed (code=${apiError.code ?? apiError.status}); retry ${attempt}/${this.config.metaMaxRetries} in ${Math.round(delay)}ms`);
      await this.wait(delay);
    }
  }

  private async toError(response: Response): Promise<MetaApiError> {
    let body: { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number; is_transient?: boolean; fbtrace_id?: string } } | undefined;
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* non-json body */
    }
    const detail = body?.error;
    const code = detail?.code;
    return new MetaApiError(
      redactTokens(detail?.error_user_msg || detail?.message || `Meta API HTTP ${response.status}`),
      response.status,
      code,
      detail?.error_subcode,
      Boolean(detail?.is_transient) || (code !== undefined && TRANSIENT_CODES.has(code)) || (code !== undefined && code >= 80_000 && code <= 80_014),
      detail?.fbtrace_id,
    );
  }

  // ---------------------------------------------------------------- endpoints
  me(context: MetaContext) {
    return this.get<{ id: string; name?: string }>(context, 'me', { fields: 'id,name' });
  }

  permissions(context: MetaContext) {
    return this.get<{ data: { permission: string; status: string }[] }>(context, 'me/permissions');
  }

  /** Ad accounts the token can see directly and via owned/client businesses. */
  async listAdAccounts(context: MetaContext): Promise<MetaAdAccount[]> {
    const fields = 'id,account_id,name,currency,timezone_name,account_status,business{id,name}';
    const accountsById = new Map<string, MetaAdAccount>();
    for (const account of await this.getAll<MetaAdAccount>(context, 'me/adaccounts', { fields })) accountsById.set(account.id, account);
    try {
      for (const business of await this.getAll<{ id: string; name: string }>(context, 'me/businesses', { fields: 'id,name' })) {
        for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
          for (const account of await this.getAll<MetaAdAccount>(context, `${business.id}/${edge}`, { fields })) {
            accountsById.set(account.id, { business: { id: business.id, name: business.name }, ...account });
          }
        }
      }
    } catch (error) {
      if (!(error instanceof MetaApiError) || !(error.isPermission || error.status === 400)) throw error; // business_management not granted
      this.logger.warn(`Business ad accounts unavailable: ${error.message}`);
    }
    return [...accountsById.values()];
  }

  getAdAccount(context: MetaContext, accountId: string) {
    return this.get<MetaAdAccount>(context, accountId, { fields: 'id,account_id,name,currency,timezone_name,account_status,business{id,name}' });
  }

  listCampaigns(context: MetaContext, accountId: string, parameters: RequestParameters = {}, maxItems?: number) {
    return this.getAll<MetaCampaign>(context, `${accountId}/campaigns`, { fields: CAMPAIGN_FIELDS, ...parameters }, maxItems);
  }

  listAdSets(context: MetaContext, accountId: string, parameters: RequestParameters = {}, maxItems?: number) {
    return this.getAll<MetaAdSet>(context, `${accountId}/adsets`, { fields: ADSET_FIELDS, ...parameters }, maxItems);
  }

  listAds(context: MetaContext, accountId: string, parameters: RequestParameters = {}, maxItems?: number) {
    return this.getAll<MetaAd>(context, `${accountId}/ads`, { fields: AD_FIELDS, ...parameters }, maxItems);
  }

  listAdCreatives(context: MetaContext, accountId: string, parameters: RequestParameters = {}, maxItems?: number) {
    return this.getAll<MetaCreative>(context, `${accountId}/adcreatives`, { fields: CREATIVE_FIELDS, ...parameters }, maxItems);
  }

  listAdImages(context: MetaContext, accountId: string, hashes: string[]) {
    return this.getAll<MetaImage>(context, `${accountId}/adimages`, { hashes, fields: 'hash,url,url_128,width,height,name,status' });
  }

  getVideo(context: MetaContext, videoId: string) {
    return this.get<MetaVideo>(context, videoId, { fields: 'id,source,picture,length,permalink_url,title,format' });
  }

  /** Graph multi-id read: GET /?ids=a,b,c (max 50). */
  getMany<Item>(context: MetaContext, ids: string[], fields: string) {
    return this.get<Record<string, Item>>(context, '', { ids: ids.join(','), fields });
  }

  // ----------------------------------------------------------------- insights
  insights(context: MetaContext, accountId: string, parameters: RequestParameters): Promise<MetaInsightRow[]> {
    return this.getAll<MetaInsightRow>(context, `${accountId}/insights`, parameters);
  }

  /** Asynchronous report run: POST -> poll -> page the results. Required for large ranges. */
  async insightsAsync(context: MetaContext, accountId: string, parameters: RequestParameters, timeoutMs: number): Promise<MetaInsightRow[]> {
    const started = await this.post<{ report_run_id: string }>(context, `${accountId}/insights`, parameters);
    const reportId = started.report_run_id;
    const deadline = Date.now() + timeoutMs;
    let pollDelay = 2000;
    for (;;) {
      const status = await this.get<{ async_status: string }>(context, reportId, { fields: 'async_status,async_percent_completion' });
      if (status.async_status === 'Job Completed') break;
      if (status.async_status === 'Job Failed' || status.async_status === 'Job Skipped') {
        throw new MetaApiError(`Async insights report ${reportId} ended as "${status.async_status}"`, 400, undefined, undefined, false);
      }
      if (Date.now() > deadline) throw new MetaApiError(`Async insights report ${reportId} timed out`, 504, undefined, undefined, true);
      await this.wait(pollDelay);
      pollDelay = Math.min(pollDelay * 1.5, 15_000);
    }
    return this.getAll<MetaInsightRow>(context, `${reportId}/insights`, {});
  }

  // --------------------------------------------------------------- ad library
  adLibrary(context: MetaContext, parameters: RequestParameters) {
    return this.get(context, 'ads_archive', parameters);
  }

  /** All pages of an Ad Library search, up to `maxItems`. */
  listAdLibrary(context: MetaContext, parameters: RequestParameters, maxItems?: number) {
    return this.getAll<MetaLibraryAd>(context, 'ads_archive', parameters, maxItems);
  }
}
