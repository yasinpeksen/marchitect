import { Injectable } from '@nestjs/common';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'TOKEN_ENCRYPTION_KEY',
] as const;

/** Reads a numeric environment value, falling back when unset, blank or not a number. */
export const readInteger = (rawValue: string | undefined, fallback: number): number => {
  const parsed = Number(rawValue);
  return rawValue !== undefined && rawValue !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

/** Typed view over process.env. Fails fast, listing every missing variable. */
@Injectable()
export class AppConfig {
  readonly nodeEnv = process.env.NODE_ENV ?? 'development';
  readonly port = readInteger(process.env.PORT, 3001);
  readonly frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  readonly corsOrigins = (process.env.CORS_ORIGINS ?? this.frontendUrl)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  readonly logLevel = process.env.LOG_LEVEL ?? 'info';
  readonly sentryDsn = process.env.SENTRY_DSN || undefined;

  readonly supabaseUrl = process.env.SUPABASE_URL as string;
  readonly supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  readonly mediaBucket = process.env.SUPABASE_MEDIA_BUCKET ?? 'ad-media';

  readonly redisUrl = process.env.REDIS_URL as string;
  /** 32 bytes, base64 or 64-char hex. */
  readonly tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY as string;

  readonly metaAppId = process.env.META_APP_ID || undefined;
  readonly metaAppSecret = process.env.META_APP_SECRET || undefined;
  /** Override to point at a mock Meta server in test/dev environments. */
  readonly metaGraphBaseUrl = (process.env.META_GRAPH_BASE_URL ?? 'https://graph.facebook.com').replace(/\/$/, '');
  /** Extra hostnames media may be downloaded from (test environments only). */
  readonly mediaExtraAllowedHosts = (process.env.MEDIA_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  /** Base of the Facebook login dialog (override together with the mock server in tests). */
  readonly metaDialogBaseUrl = (process.env.META_DIALOG_BASE_URL ?? 'https://www.facebook.com').replace(/\/$/, '');
  readonly metaGraphVersion = process.env.META_GRAPH_VERSION ?? 'v24.0';
  readonly metaRedirectUri =
    process.env.META_OAUTH_REDIRECT_URI ?? 'http://localhost:3001/api/v1/meta/oauth/callback';
  readonly metaMaxRetries = readInteger(process.env.META_MAX_RETRIES, 5);
  readonly metaRetryBaseMs = readInteger(process.env.META_RETRY_BASE_MS, 1000);
  readonly adLibraryEnabled = process.env.META_AD_LIBRARY_ENABLED === 'true';
  /** Countries the Ad Library search covers; "ALL" is valid. Commercial ads outside the EU / UK are only listed when political. */
  readonly adLibraryCountries = (process.env.META_AD_LIBRARY_COUNTRIES ?? 'ALL').split(',').map((country) => country.trim().toUpperCase()).filter(Boolean);
  /** TikTok Marketing API base (override to point at the mock server in test/dev). Retries reuse META_MAX_RETRIES / META_RETRY_BASE_MS. */
  readonly tiktokApiBaseUrl = (process.env.TIKTOK_API_BASE_URL ?? 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');

  readonly maxAdsPerRun = readInteger(process.env.MAX_ADS_PER_RUN, 2000);
  readonly defaultLookbackDays = readInteger(process.env.COLLECTION_DEFAULT_LOOKBACK_DAYS, 30);
  /** Ranges longer than this (days) or with many ads use Meta's async insights reports. */
  readonly asyncInsightsMinDays = readInteger(process.env.ASYNC_INSIGHTS_MIN_DAYS, 31);
  readonly asyncInsightsMinAds = readInteger(process.env.ASYNC_INSIGHTS_MIN_ADS, 100);
  readonly asyncInsightsTimeoutMs = readInteger(process.env.ASYNC_INSIGHTS_TIMEOUT_MS, 20 * 60_000);

  readonly mediaMaxBytes = readInteger(process.env.MEDIA_MAX_BYTES, 500 * 1024 * 1024);
  readonly mediaDownloadTimeoutMs = readInteger(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS, 10 * 60_000);
  readonly signedUrlTtlSeconds = readInteger(process.env.SIGNED_URL_TTL_SECONDS, 3600);

  readonly collectionConcurrency = readInteger(process.env.WORKER_COLLECTION_CONCURRENCY, 2);
  readonly mediaConcurrency = readInteger(process.env.WORKER_MEDIA_CONCURRENCY, 3);
  readonly schedulerTickMs = readInteger(process.env.SCHEDULER_TICK_MS, 60_000);
  readonly throttleLimit = readInteger(process.env.RATE_LIMIT_MAX, 120);
  readonly throttleTtlMs = readInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);

  constructor() {
    const missing = REQUIRED.filter((variableName) => !process.env[variableName]);
    if (missing.length) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}. See .env.example.`,
      );
    }
    const encryptionKey = this.tokenEncryptionKey;
    const keyByteLength = /^[0-9a-fA-F]{64}$/.test(encryptionKey) ? 32 : Buffer.from(encryptionKey, 'base64').length;
    if (keyByteLength !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).');
    }
  }
}
