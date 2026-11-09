import { AppConfig } from '../common/app-config';
import { SupabaseService } from '../common/supabase.service';
import { QueueService } from '../jobs/queues';
import { MetaApiClient, MetaApiError } from '../meta/meta-api.client';
import { MetaConnectionsService } from '../meta/meta-connections.service';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import { extensionForMime, isAllowedMediaUrl, MediaService, needsDownload, planMediaForCreative } from './media.service';

describe('isAllowedMediaUrl', () => {
  it.each([
    'https://scontent.xx.fbcdn.net/v/t1/image.jpg', 'https://video.xx.fbcdn.net/v/video.mp4', 'https://cdn.fbsbx.com/x', 'https://www.facebook.com/x',
    'https://facebook.com/x', 'https://scontent.cdninstagram.com/x',
  ])('allows Meta CDN host %s', (url) => expect(isAllowedMediaUrl(url)).toBe(true));

  it.each([
    'http://scontent.xx.fbcdn.net/image.jpg', 'https://evil.example.com/x', 'https://fbcdn.net.evil.com/x', 'https://169.254.169.254/latest/meta-data',
    'http://localhost:3001/health', 'file:///etc/passwd', 'not a url',
  ])('blocks %s (SSRF guard)', (url) => expect(isAllowedMediaUrl(url)).toBe(false));

  it('allows configured extra hosts (test environments) over http or https', () => {
    expect(isAllowedMediaUrl('http://mock-meta:4010/media/video.mp4', ['mock-meta'])).toBe(true);
    expect(isAllowedMediaUrl('http://other:4010/media/video.mp4', ['mock-meta'])).toBe(false);
  });
});

describe('extensionForMime', () => {
  it.each([['image/jpeg', 'jpg'], ['image/png', 'png'], ['video/mp4', 'mp4'], ['video/webm', 'webm']])('%s -> %s', (mime, extension) => {
    expect(extensionForMime(mime)).toBe(extension);
  });
  it('falls back to bin', () => expect(extensionForMime('application/x-unknown')).toBe('bin'));
});

describe('planMediaForCreative', () => {
  const creative = { id: 'cr1', video_id: null, image_hash: null, image_url: null, thumbnail_url: null };
  it('plans a video plus its thumbnail', () => {
    expect(planMediaForCreative('ad1', { ...creative, video_id: 'v1', thumbnail_url: 'http://t' })).toEqual([
      { adId: 'ad1', creativeId: 'cr1', kind: 'video', dedupeKey: 'video:v1', sourceRef: 'v1' },
      { adId: 'ad1', creativeId: 'cr1', kind: 'thumbnail', dedupeKey: 'thumb:cr1', sourceRef: 'cr1' },
    ]);
  });
  it('deduplicates images by hash, falling back to the creative id', () => {
    expect(planMediaForCreative('ad1', { ...creative, image_hash: 'abc', image_url: 'http://i' })[0].dedupeKey).toBe('imagehash:abc');
    expect(planMediaForCreative('ad1', { ...creative, image_url: 'http://i' })[0]).toMatchObject({ kind: 'image', dedupeKey: 'imagecreative:cr1' });
  });
  it('plans nothing for a creative without media', () => expect(planMediaForCreative('ad1', creative)).toEqual([]));
});

describe('needsDownload', () => {
  it.each([[{ status: 'pending', attempts: 0 }, true], [{ status: 'failed', attempts: 3 }, true], [{ status: 'failed', attempts: 4 }, false],
    [{ status: 'stored', attempts: 1 }, false], [{ status: 'unavailable', attempts: 1 }, false], [{ status: 'downloading', attempts: 1 }, false]])('%j -> %s', (asset, expected) => {
    expect(needsDownload(asset as never)).toBe(expected);
  });
});

const buildService = (configOverrides: Record<string, unknown> = {}) => {
  const fake = new FakeSupabase();
  const meta = {
    getVideo: jest.fn().mockResolvedValue({ id: 'v1', source: 'https://video.xx.fbcdn.net/v/video.mp4?sig=1' }),
    listAdImages: jest.fn().mockResolvedValue([{ hash: 'h1', url: 'https://scontent.xx.fbcdn.net/img.jpg?sig=1' }]),
  };
  const connections = {
    contextForAccount: jest.fn().mockResolvedValue({ account: { id: 'acc-1', meta_account_id: 'act_1' }, context: { token: 'EAAx' } }),
  };
  const queues = { enqueueMedia: jest.fn().mockResolvedValue({}) };
  const service = new MediaService(
    fake as unknown as SupabaseService, buildTestConfig(configOverrides) as unknown as AppConfig, meta as unknown as MetaApiClient,
    connections as unknown as MetaConnectionsService, queues as unknown as QueueService,
  );
  return { fake, meta, connections, queues, service };
};

describe('MediaService', () => {
  describe('planForAds', () => {
    const arrange = (statuses: Record<string, string> = {}) => {
      const context = buildService();
      context.fake.respond('ads', {
        data: [{ id: 'ad1', ad_creatives: { id: 'cr1', video_id: 'v1', image_hash: null, image_url: null, thumbnail_url: 'http://t' } }, { id: 'ad2', ad_creatives: null }],
      });
      context.fake.respond('storage_assets', {
        data: [
          { id: 'asset-video', dedupe_key: 'video:v1', status: statuses.video ?? 'pending', attempts: 0 },
          { id: 'asset-thumb', dedupe_key: 'thumb:cr1', status: statuses.thumb ?? 'stored', attempts: 1 },
        ],
      });
      return context;
    };

    it('registers deduplicated assets, links them to ads and queues only what needs downloading', async () => {
      const { fake, queues, service } = arrange();
      expect(await service.planForAds('u1', 'acc-1', ['ad1', 'ad2'])).toBe(1);
      const [assets, options] = fake.callsTo('storage_assets')[0].operations.find((operation) => operation.name === 'upsert')?.args as [Record<string, unknown>[], Record<string, unknown>];
      expect(assets.map((asset) => asset.dedupe_key)).toEqual(['video:v1', 'thumb:cr1']);
      expect(options).toEqual({ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
      const links = fake.argumentsOf('ad_assets', 'upsert')?.[0] as Record<string, unknown>[];
      expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ ad_id: 'ad1', kind: 'video', meta_ref: 'v1', storage_asset_id: 'asset-video' })]));
      expect(queues.enqueueMedia).toHaveBeenCalledTimes(1);
      expect(queues.enqueueMedia).toHaveBeenCalledWith({ userId: 'u1', storageAssetId: 'asset-video', adAccountId: 'acc-1' });
    });

    it('requeues failed assets with attempts left and ignores a duplicate-job error', async () => {
      const { queues, service } = arrange({ video: 'failed' });
      queues.enqueueMedia.mockRejectedValue(new Error('job exists'));
      await expect(service.planForAds('u1', 'acc-1', ['ad1'])).resolves.toBe(1);
    });

    it('does nothing for ads without media', async () => {
      const { fake, queues, service } = buildService();
      fake.respond('ads', { data: [{ id: 'ad1', ad_creatives: null }] });
      expect(await service.planForAds('u1', 'acc-1', ['ad1'])).toBe(0);
      expect(queues.enqueueMedia).not.toHaveBeenCalled();
    });
  });

  describe('resolveSource', () => {
    it('resolves a video through the Graph video endpoint', async () => {
      const { service, meta } = buildService();
      expect(await service.resolveSource('u1', 'acc-1', { dedupe_key: 'video:v1', source_ref: 'v1' })).toBe('https://video.xx.fbcdn.net/v/video.mp4?sig=1');
      expect(meta.getVideo).toHaveBeenCalledWith({ token: 'EAAx' }, 'v1');
    });
    it('treats a video without a source as permanently unavailable (never bypassed)', async () => {
      const { service, meta } = buildService();
      meta.getVideo.mockResolvedValue({ id: 'v1' });
      await expect(service.resolveSource('u1', 'acc-1', { dedupe_key: 'video:v1', source_ref: 'v1' })).rejects.toThrow('did not return a downloadable source');
    });
    it('resolves an image by hash from the ad account library', async () => {
      const { service, meta } = buildService();
      expect(await service.resolveSource('u1', 'acc-1', { dedupe_key: 'imagehash:h1', source_ref: 'h1' })).toContain('img.jpg');
      expect(meta.listAdImages).toHaveBeenCalledWith({ token: 'EAAx' }, 'act_1', ['h1']);
    });
    it('reports an unknown image hash', async () => {
      const { service, meta } = buildService();
      meta.listAdImages.mockResolvedValue([]);
      await expect(service.resolveSource('u1', 'acc-1', { dedupe_key: 'imagehash:zz', source_ref: 'zz' })).rejects.toThrow('Image hash not found');
    });
    it('reads creative image and thumbnail URLs from the database', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_creatives', { data: { image_url: 'https://i', thumbnail_url: 'https://t' } });
      expect(await service.resolveSource('u1', 'acc-1', { dedupe_key: 'thumb:cr1', source_ref: 'cr1' })).toBe('https://t');
      expect(await service.resolveSource('u1', 'acc-1', { dedupe_key: 'imagecreative:cr1', source_ref: 'cr1' })).toBe('https://i');
    });
    it('fails when the creative has no media URL', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_creatives', { data: null });
      await expect(service.resolveSource('u1', 'acc-1', { dedupe_key: 'thumb:cr1', source_ref: 'cr1' })).rejects.toThrow('no media URL');
    });
  });

  describe('process', () => {
    let fetchMock: jest.SpiedFunction<typeof fetch>;
    beforeEach(() => {
      fetchMock = jest.spyOn(globalThis, 'fetch');
    });
    afterEach(() => fetchMock.mockRestore());

    const pendingAsset = (overrides: Record<string, unknown> = {}) => ({ id: 'asset-1', kind: 'video', dedupe_key: 'video:v1', source_ref: 'v1', status: 'pending', attempts: 0, ...overrides });
    const statusPatches = (fake: FakeSupabase) => fake.callsTo('storage_assets').flatMap((call) => call.operations).filter((operation) => operation.name === 'update').map((operation) => operation.args[0] as Record<string, unknown>);

    it('downloads, hashes and stores the file in the private bucket under a content-addressed path', async () => {
      const { fake, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset() });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('video-bytes', { headers: { 'content-type': 'video/mp4', 'content-length': '11' } })));
      expect(await service.process('u1', 'asset-1', 'acc-1')).toBe('stored');
      const [path, , options] = fake.storageUpload.mock.calls[0];
      expect(path).toMatch(/^u1\/video\/[0-9a-f]{64}\.mp4$/);
      expect(options).toEqual({ contentType: 'video/mp4', upsert: true });
      const patches = statusPatches(fake);
      expect(patches[0]).toMatchObject({ status: 'downloading', attempts: 1 });
      expect(patches.at(-1)).toMatchObject({ status: 'stored', mime_type: 'video/mp4', size_bytes: 11, path, source_url: 'https://video.xx.fbcdn.net/v/video.mp4' });
    });

    it('skips assets that are already stored or unavailable', async () => {
      const { fake, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset({ status: 'stored' }) });
      expect(await service.process('u1', 'asset-1', 'acc-1')).toBe('skipped');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips unknown assets', async () => {
      const { fake, service } = buildService();
      fake.respond('storage_assets', { data: null });
      expect(await service.process('u1', 'x', 'acc-1')).toBe('skipped');
    });

    it('refuses untrusted hosts without fetching', async () => {
      const { fake, meta, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset() });
      meta.getVideo.mockResolvedValue({ id: 'v1', source: 'https://evil.example.com/v.mp4' });
      expect(await service.process('u1', 'asset-1', 'acc-1')).toBe('unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(statusPatches(fake).at(-1)).toMatchObject({ status: 'unavailable', error: expect.stringContaining('untrusted host') });
    });

    it('can download from a configured test-environment host', async () => {
      const { fake, meta, service } = buildService({ mediaExtraAllowedHosts: ['mock-meta'] });
      fake.respond('storage_assets', { data: pendingAsset() });
      meta.getVideo.mockResolvedValue({ id: 'v1', source: 'http://mock-meta:4010/media/video.mp4' });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('bytes', { headers: { 'content-type': 'video/mp4' } })));
      expect(await service.process('u1', 'asset-1', 'acc-1')).toBe('stored');
    });

    it.each([401, 403, 404, 410])('marks HTTP %s as permanently unavailable', async (status) => {
      const { fake, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset() });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('no', { status })));
      expect(await service.process('u1', 'asset-1', 'acc-1')).toBe('unavailable');
    });

    it('marks oversized files (declared or actual) unavailable', async () => {
      const declared = buildService({ mediaMaxBytes: 4 });
      declared.fake.respond('storage_assets', { data: pendingAsset() });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('12345678', { headers: { 'content-length': '8', 'content-type': 'video/mp4' } })));
      expect(await declared.service.process('u1', 'asset-1', 'acc-1')).toBe('unavailable');

      const streamed = buildService({ mediaMaxBytes: 4 });
      streamed.fake.respond('storage_assets', { data: pendingAsset() });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('12345678', { headers: { 'content-type': 'video/mp4' } })));
      expect(await streamed.service.process('u1', 'asset-1', 'acc-1')).toBe('unavailable');
      expect(streamed.fake.storageUpload).not.toHaveBeenCalled();
    });

    it('treats Meta permission errors as permanent', async () => {
      const { fake, meta, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset() });
      meta.getVideo.mockRejectedValue(new MetaApiError('no access', 403, 10));
      expect(await service.process('u1', 'asset-1', 'acc-1')).toBe('unavailable');
    });

    it('marks transient failures as failed and rethrows so the queue retries', async () => {
      const { fake, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset() });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('oops', { status: 500 })));
      await expect(service.process('u1', 'asset-1', 'acc-1')).rejects.toThrow('Download failed (HTTP 500)');
      expect(statusPatches(fake).at(-1)).toMatchObject({ status: 'failed', error: 'Download failed (HTTP 500)' });
    });

    it('fails (retryable) when the storage upload fails', async () => {
      const { fake, service } = buildService();
      fake.respond('storage_assets', { data: pendingAsset() });
      fetchMock.mockImplementation(() => Promise.resolve(new Response('bytes', { headers: { 'content-type': 'video/mp4' } })));
      fake.storageUpload.mockResolvedValueOnce({ data: null, error: { message: 'bucket full' } });
      await expect(service.process('u1', 'asset-1', 'acc-1')).rejects.toThrow('Storage upload failed: bucket full');
    });
  });

  describe('signed URLs and media listing', () => {
    it('signs unique paths in batches', async () => {
      const { fake, service } = buildService();
      fake.storageSignedUrls.mockResolvedValue({ data: [{ path: 'a', signedUrl: 'https://s/a' }, { path: 'b', signedUrl: null }], error: null });
      const urls = await service.signedUrls(['a', 'a', 'b']);
      expect(fake.storageSignedUrls).toHaveBeenCalledWith(['a', 'b'], 60);
      expect([...urls.entries()]).toEqual([['a', 'https://s/a']]);
    });

    it('lists media per ad with signed URLs, pending placeholders and errors', async () => {
      const { fake, service } = buildService();
      fake.respond('ad_assets', {
        data: [
          { ad_id: 'ad1', kind: 'video', storage_assets: { path: 'p1', status: 'stored', error: null } },
          { ad_id: 'ad1', kind: 'thumbnail', storage_assets: { path: null, status: 'unavailable', error: 'restricted' } },
          { ad_id: 'ad2', kind: 'image', storage_assets: null },
        ],
      });
      fake.storageSignedUrls.mockResolvedValue({ data: [{ path: 'p1', signedUrl: 'https://s/p1' }], error: null });
      const listing = await service.mediaForAds('u1', ['ad1', 'ad2']);
      expect(listing.get('ad1')).toEqual([
        { kind: 'video', status: 'stored', error: null, url: 'https://s/p1' },
        { kind: 'thumbnail', status: 'unavailable', error: 'restricted', url: null },
      ]);
      expect(listing.get('ad2')).toEqual([{ kind: 'image', status: 'pending', error: null, url: null }]);
    });

    it('returns an empty map without querying when there are no ads', async () => {
      const { fake, service } = buildService();
      expect((await service.mediaForAds('u1', [])).size).toBe(0);
      expect(fake.calls).toHaveLength(0);
    });
  });
});
