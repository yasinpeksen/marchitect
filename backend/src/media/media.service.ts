import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createWriteStream, openAsBlob } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { AppConfig } from '../common/app-config';
import { chunk, must, SupabaseService } from '../common/supabase.service';
import { CreativeRow, StorageAssetRow } from '../common/types';
import { QueueService } from '../jobs/queues';
import { MetaApiClient, MetaApiError } from '../meta/meta-api.client';
import { MetaConnectionsService } from '../meta/meta-connections.service';

/** Only fetch from Meta / TikTok CDN hosts (SSRF guard); never follow arbitrary URLs. */
export const ALLOWED_MEDIA_HOSTS = [
  /\.fbcdn\.net$/, /\.fbsbx\.com$/, /\.facebook\.com$/, /\.cdninstagram\.com$/, /^facebook\.com$/,
  /\.tiktokcdn\.com$/, /\.tiktokcdn-us\.com$/, /\.ibyteimg\.com$/, /\.byteimg\.com$/,
];

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

/** Permanent failure: the media cannot be fetched (restricted, expired, too large). Never retried. */
export class MediaUnavailableError extends Error {}

/** True when `urlText` is https and its host is a Meta CDN host or one of `extraHosts` (test environments). */
export function isAllowedMediaUrl(urlText: string, extraHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return false;
  }
  const hostAllowed = ALLOWED_MEDIA_HOSTS.some((pattern) => pattern.test(url.hostname)) || extraHosts.includes(url.hostname);
  const protocolAllowed = url.protocol === 'https:' || (extraHosts.includes(url.hostname) && url.protocol === 'http:');
  return hostAllowed && protocolAllowed;
}

/** File extension for a MIME type, `bin` when unknown. */
export const extensionForMime = (mimeType: string): string => EXTENSION_BY_MIME[mimeType] ?? 'bin';

export type WantedMedia = { adId: string; creativeId: string; kind: 'video' | 'image' | 'thumbnail'; dedupeKey: string; sourceRef: string };

/** Which media an ad's creative needs stored, with deduplication keys (same video/image hash = one file). */
export function planMediaForCreative(
  adId: string,
  creative: Pick<CreativeRow, 'id' | 'video_id' | 'image_hash' | 'image_url' | 'thumbnail_url'>,
): WantedMedia[] {
  const wanted: WantedMedia[] = [];
  if (creative.video_id) wanted.push({ adId, creativeId: creative.id, kind: 'video', dedupeKey: `video:${creative.video_id}`, sourceRef: creative.video_id });
  if (creative.image_hash) {
    wanted.push({ adId, creativeId: creative.id, kind: 'image', dedupeKey: `imagehash:${creative.image_hash}`, sourceRef: creative.image_hash });
  } else if (creative.image_url) {
    wanted.push({ adId, creativeId: creative.id, kind: 'image', dedupeKey: `imagecreative:${creative.id}`, sourceRef: creative.id });
  }
  if (creative.thumbnail_url) {
    wanted.push({ adId, creativeId: creative.id, kind: 'thumbnail', dedupeKey: `thumb:${creative.id}`, sourceRef: creative.id });
  }
  return wanted;
}

/** Pending assets, and failed ones that still have retries left, should be (re)queued. */
export const needsDownload = (asset: Pick<StorageAssetRow, 'status' | 'attempts'>): boolean =>
  asset.status === 'pending' || (asset.status === 'failed' && asset.attempts < 4);

export interface MediaListing {
  kind: string;
  status: string;
  error: string | null;
  url: string | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
    private readonly meta: MetaApiClient,
    private readonly connections: MetaConnectionsService,
    private readonly queues: QueueService,
  ) {}

  /**
   * Registers (deduplicated) storage assets + ad_asset links for ads and enqueues downloads
   * for anything not already stored. Safe to call repeatedly.
   */
  async planForAds(userId: string, adAccountId: string, adIds: string[]): Promise<number> {
    let queued = 0;
    for (const idGroup of chunk(adIds, 100)) {
      const ads = must<{ id: string; ad_creatives: CreativeRow | null }[]>(
        await this.supabase
          .from('ads')
          .select('id,creative_id,ad_creatives(id,meta_creative_id,video_id,image_hash,image_url,thumbnail_url)')
          .eq('user_id', userId)
          .in('id', idGroup),
        'load ads for media',
      );
      const wanted = ads.flatMap((ad) => (ad.ad_creatives ? planMediaForCreative(ad.id, ad.ad_creatives) : []));
      if (wanted.length === 0) continue;

      const uniqueByKey = new Map(wanted.map((entry) => [entry.dedupeKey, entry]));
      must(
        await this.supabase.from('storage_assets').upsert(
          [...uniqueByKey.values()].map((entry) => ({
            user_id: userId, bucket: this.config.mediaBucket, kind: entry.kind, dedupe_key: entry.dedupeKey, source_ref: entry.sourceRef,
          })),
          { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
        ),
        'register storage assets',
      );
      const assets = must<StorageAssetRow[]>(
        await this.supabase.from('storage_assets').select('id,dedupe_key,status,attempts').eq('user_id', userId).in('dedupe_key', [...uniqueByKey.keys()]),
        'load storage assets',
      );
      const assetByKey = new Map(assets.map((asset) => [asset.dedupe_key, asset]));

      must(
        await this.supabase.from('ad_assets').upsert(
          wanted.map((entry) => ({
            user_id: userId, ad_id: entry.adId, creative_id: entry.creativeId, kind: entry.kind, meta_ref: entry.sourceRef,
            storage_asset_id: assetByKey.get(entry.dedupeKey)?.id ?? null,
          })),
          { onConflict: 'ad_id,kind,meta_ref' },
        ),
        'link ad assets',
      );

      for (const asset of assets) {
        if (!needsDownload(asset)) continue;
        await this.queues.enqueueMedia({ userId, storageAssetId: asset.id, adAccountId }).catch(() => undefined); // duplicate job id = already queued
        queued++;
      }
    }
    return queued;
  }

  /** Download one asset and store it in Supabase Storage. Idempotent. */
  async process(userId: string, storageAssetId: string, adAccountId: string): Promise<'stored' | 'unavailable' | 'skipped'> {
    const asset = must<StorageAssetRow | null>(
      await this.supabase.from('storage_assets').select('*').eq('id', storageAssetId).eq('user_id', userId).maybeSingle(),
      'load asset',
    );
    if (!asset || asset.status === 'stored' || asset.status === 'unavailable') return 'skipped';

    await this.supabase.from('storage_assets').update({ status: 'downloading', attempts: asset.attempts + 1, error: null }).eq('id', asset.id);
    let workingDirectory: string | undefined;
    try {
      const sourceUrl = await this.resolveSource(userId, adAccountId, asset);
      if (!isAllowedMediaUrl(sourceUrl, this.config.mediaExtraAllowedHosts)) {
        throw new MediaUnavailableError(`Refusing to download from untrusted host ${new URL(sourceUrl).hostname}`);
      }

      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(this.config.mediaDownloadTimeoutMs) });
      if ([401, 403, 404, 410].includes(response.status)) {
        throw new MediaUnavailableError(`Media not accessible (HTTP ${response.status}); URL expired or restricted`);
      }
      if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`);
      const declaredBytes = Number(response.headers.get('content-length') ?? 0);
      if (declaredBytes > this.config.mediaMaxBytes) throw new MediaUnavailableError(`File too large (${declaredBytes} bytes > MEDIA_MAX_BYTES)`);

      workingDirectory = await mkdtemp(join(tmpdir(), 'media-'));
      const filePath = join(workingDirectory, 'asset');
      const hash = createHash('sha256');
      let receivedBytes = 0;
      const byteLimit = this.config.mediaMaxBytes;
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        new Transform({
          transform(chunkBuffer: Buffer, _encoding, callback) {
            receivedBytes += chunkBuffer.length;
            if (receivedBytes > byteLimit) return callback(new MediaUnavailableError('File exceeds MEDIA_MAX_BYTES'));
            hash.update(chunkBuffer);
            callback(null, chunkBuffer);
          },
        }),
        createWriteStream(filePath),
      );

      const mimeType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
      const sha256 = hash.digest('hex');
      // Content-addressed path: identical bytes map to one object even across assets.
      const storagePath = `${userId}/${asset.kind}/${sha256}.${extensionForMime(mimeType)}`;

      // ponytail: single multipart upload from a file-backed Blob (no full buffering);
      // switch to Supabase TUS resumable uploads if files regularly exceed ~100MB.
      const blob = await openAsBlob(filePath, { type: mimeType });
      const upload = await this.supabase.storage.upload(storagePath, blob, { contentType: mimeType, upsert: true });
      if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

      await this.supabase
        .from('storage_assets')
        .update({
          status: 'stored', path: storagePath, mime_type: mimeType, size_bytes: (await stat(filePath)).size, sha256,
          source_url: sourceUrl.split('?')[0], error: null,
        })
        .eq('id', asset.id);
      return 'stored';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof MediaUnavailableError || (error instanceof MetaApiError && (error.isPermission || error.isAuth));
      await this.supabase
        .from('storage_assets')
        .update({ status: permanent ? 'unavailable' : 'failed', error: message.slice(0, 500) })
        .eq('id', asset.id);
      if (permanent) return 'unavailable';
      throw error; // let BullMQ retry
    } finally {
      if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Resolve a fresh download URL through authorised Meta endpoints only. */
  async resolveSource(userId: string, adAccountId: string, asset: Pick<StorageAssetRow, 'dedupe_key' | 'source_ref'>): Promise<string> {
    const key = asset.dedupe_key;
    if (key.startsWith('video:') || key.startsWith('imagehash:')) return this.resolveMetaSource(userId, adAccountId, asset);
    // Creative image / thumbnail URLs are stored on the creative row (Meta and TikTok alike).
    const creative = must<Pick<CreativeRow, 'image_url' | 'thumbnail_url'> | null>(
      await this.supabase.from('ad_creatives').select('image_url,thumbnail_url').eq('id', asset.source_ref).eq('user_id', userId).maybeSingle(),
      'load creative',
    );
    const url = key.startsWith('thumb:') ? creative?.thumbnail_url : creative?.image_url;
    if (!url) throw new MediaUnavailableError('Creative has no media URL');
    return url;
  }

  /** Meta videos and image-library hashes need a fresh URL from the Graph API. */
  private async resolveMetaSource(userId: string, adAccountId: string, asset: Pick<StorageAssetRow, 'dedupe_key' | 'source_ref'>): Promise<string> {
    const { context, account } = await this.connections.contextForAccount(userId, adAccountId);
    const key = asset.dedupe_key;
    if (key.startsWith('video:')) {
      const video = await this.meta.getVideo(context, asset.source_ref as string);
      if (!video.source) throw new MediaUnavailableError('Meta did not return a downloadable source for this video (permissions or ownership)');
      return video.source;
    }
    const images = await this.meta.listAdImages(context, account.meta_account_id, [asset.source_ref as string]);
    const url = images[0]?.url;
    if (!url) throw new MediaUnavailableError('Image hash not found in the ad account image library');
    return url;
  }

  async signedUrls(paths: string[]): Promise<Map<string, string>> {
    const urlByPath = new Map<string, string>();
    for (const group of chunk([...new Set(paths)], 100)) {
      const { data } = await this.supabase.storage.createSignedUrls(group, this.config.signedUrlTtlSeconds);
      for (const entry of data ?? []) if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
    }
    return urlByPath;
  }

  /** ad id -> media list with signed URLs (private bucket, short-lived links). */
  async mediaForAds(userId: string, adIds: string[]): Promise<Map<string, MediaListing[]>> {
    const listingsByAd = new Map<string, MediaListing[]>();
    if (adIds.length === 0) return listingsByAd;
    const rows: { ad_id: string; kind: string; storage_assets: { path: string | null; status: string; error: string | null } | null }[] = [];
    for (const group of chunk(adIds, 100)) {
      rows.push(
        ...must<typeof rows>(
          await this.supabase.from('ad_assets').select('ad_id,kind,storage_assets(path,status,error)').eq('user_id', userId).in('ad_id', group),
          'load media',
        ),
      );
    }
    const urlByPath = await this.signedUrls(rows.map((row) => row.storage_assets?.path).filter((path): path is string => Boolean(path)));
    for (const row of rows) {
      const asset = row.storage_assets;
      const listings = listingsByAd.get(row.ad_id) ?? [];
      listings.push({ kind: row.kind, status: asset?.status ?? 'pending', error: asset?.error ?? null, url: asset?.path ? urlByPath.get(asset.path) ?? null : null });
      listingsByAd.set(row.ad_id, listings);
    }
    return listingsByAd;
  }
}
