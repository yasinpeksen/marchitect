import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import {
  TikTokAd, TikTokAdGroup, TikTokAdvertiser, TikTokCampaign, TikTokImageInfo, TikTokPage, TikTokReportRow, TikTokVideoInfo,
} from '../common/types';
import { computeBackoffDelay } from '../meta/meta-api.client';

export interface TikTokContext {
  /** Long-lived Marketing API access token (sent in the `Access-Token` header, never in the URL). */
  token: string;
  connectionId?: string;
}

export type TikTokParameters = Record<string, string | number | boolean | object | undefined | null>;

interface TikTokEnvelope<Data> {
  code: number;
  message?: string;
  request_id?: string;
  data?: Data;
}

const AUTH_CODES = new Set([40_102, 40_103, 40_104, 40_105]);
const RATE_LIMIT_CODES = new Set([40_100]);
const TRANSIENT_CODES = new Set([40_100, 50_000, 50_001, 50_002]);
export const TIKTOK_PAGE_SIZE = 1000;

export class TikTokApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly transient = false,
  ) {
    super(message);
  }

  /** Invalid, expired or missing access token. */
  get isAuth(): boolean {
    return this.status === 401 || (this.code !== undefined && AUTH_CODES.has(this.code));
  }

  /** The token has no access to the advertiser or object. Not retryable. */
  get isPermission(): boolean {
    return this.status === 403 || /permission|not authorized/i.test(this.message);
  }

  get isRateLimit(): boolean {
    return this.code !== undefined && RATE_LIMIT_CODES.has(this.code);
  }
}

/** Classifies a failed response (HTTP status and/or TikTok envelope code) as an error. */
export function toTikTokError(status: number, body: Partial<TikTokEnvelope<unknown>> | undefined): TikTokApiError {
  const code = body?.code;
  const transient = status === 429 || status >= 500 || (code !== undefined && TRANSIENT_CODES.has(code));
  return new TikTokApiError(body?.message || `TikTok API HTTP ${status}`, status, code, transient);
}

/** Request parameters as TikTok expects them: objects and arrays are JSON strings. */
export function encodeTikTokParameters(parameters: TikTokParameters): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value === undefined || value === null) continue;
    query.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return query;
}

const ADVERTISER_FIELDS = ['advertiser_id', 'name', 'currency', 'timezone', 'display_timezone', 'status', 'company'];

@Injectable()
export class TikTokApiClient {
  private readonly logger = new Logger('TikTokApi');

  constructor(private readonly config: AppConfig) {}

  protected wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  /** GET with retries; resolves to the envelope's `data`. TikTok reports failures as HTTP 200 + a non-zero `code`. */
  async get<Data>(context: TikTokContext, path: string, parameters: TikTokParameters = {}): Promise<Data> {
    const url = `${this.config.tiktokApiBaseUrl}/${path.replace(/^\//, '')}?${encodeTikTokParameters(parameters)}`;
    let attempt = 0;
    for (;;) {
      let failure: TikTokApiError;
      let retryAfterSeconds = 0;
      try {
        const response = await fetch(url, { headers: { 'Access-Token': context.token }, signal: AbortSignal.timeout(120_000) });
        retryAfterSeconds = Number(response.headers.get('retry-after'));
        const body = (await response.json().catch(() => undefined)) as TikTokEnvelope<Data> | undefined;
        if (response.ok && body?.code === 0) return body.data as Data;
        failure = toTikTokError(response.status, body);
      } catch (error) {
        failure = new TikTokApiError(`Network error: ${String(error)}`, 0, undefined, true);
      }
      const retryable = failure.transient && !failure.isAuth && !failure.isPermission;
      if (!retryable || attempt >= this.config.metaMaxRetries) throw failure;
      const delay = computeBackoffDelay({ attempt, baseMs: this.config.metaRetryBaseMs, retryAfterSeconds, rateLimited: failure.isRateLimit });
      attempt++;
      this.logger.warn(`TikTok call failed (code=${failure.code ?? failure.status}); retry ${attempt}/${this.config.metaMaxRetries} in ${Math.round(delay)}ms`);
      await this.wait(delay);
    }
  }

  /** Walks `page`/`page_size` pagination until the last page or `maxItems`. */
  async getAll<Item>(context: TikTokContext, path: string, parameters: TikTokParameters = {}, maxItems = Infinity): Promise<Item[]> {
    const collected: Item[] = [];
    for (let page = 1; collected.length < maxItems; page++) {
      const data = await this.get<TikTokPage<Item>>(context, path, { ...parameters, page, page_size: TIKTOK_PAGE_SIZE });
      collected.push(...(data.list ?? []));
      if (page >= (data.page_info?.total_page ?? 1)) break;
    }
    return Number.isFinite(maxItems) ? collected.slice(0, maxItems) : collected;
  }

  // ---------------------------------------------------------------- endpoints
  async advertiserInfo(context: TikTokContext, advertiserIds: string[]): Promise<TikTokAdvertiser[]> {
    const data = await this.get<{ list?: TikTokAdvertiser[] }>(context, 'advertiser/info/', { advertiser_ids: advertiserIds, fields: ADVERTISER_FIELDS });
    return data.list ?? [];
  }

  listCampaigns(context: TikTokContext, advertiserId: string, filtering: object, maxItems?: number) {
    return this.getAll<TikTokCampaign>(context, 'campaign/get/', { advertiser_id: advertiserId, filtering }, maxItems);
  }

  listAdGroups(context: TikTokContext, advertiserId: string, filtering: object, maxItems?: number) {
    return this.getAll<TikTokAdGroup>(context, 'adgroup/get/', { advertiser_id: advertiserId, filtering }, maxItems);
  }

  listAds(context: TikTokContext, advertiserId: string, filtering: object, maxItems?: number) {
    return this.getAll<TikTokAd>(context, 'ad/get/', { advertiser_id: advertiserId, filtering }, maxItems);
  }

  async videoInfo(context: TikTokContext, advertiserId: string, videoIds: string[]): Promise<TikTokVideoInfo[]> {
    const data = await this.get<{ list?: TikTokVideoInfo[] }>(context, 'file/video/ad/info/', { advertiser_id: advertiserId, video_ids: videoIds });
    return data.list ?? [];
  }

  async imageInfo(context: TikTokContext, advertiserId: string, imageIds: string[]): Promise<TikTokImageInfo[]> {
    const data = await this.get<{ list?: TikTokImageInfo[] }>(context, 'file/image/ad/info/', { advertiser_id: advertiserId, image_ids: imageIds });
    return data.list ?? [];
  }

  /** Synchronous ad-level report (BASIC, auction ads). */
  report(context: TikTokContext, parameters: TikTokParameters): Promise<TikTokReportRow[]> {
    return this.getAll<TikTokReportRow>(context, 'report/integrated/get/', { report_type: 'BASIC', data_level: 'AUCTION_AD', ...parameters });
  }
}
