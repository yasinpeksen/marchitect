import { CreativeRow, MetaAssetFeedSpec, MetaCreative, MetaObjectStorySpec } from '../common/types';

/** Normalises a Graph API AdCreative (any of its shapes) into the columns we store/search. */
export type CreativeFormat = 'image' | 'video' | 'carousel' | 'dynamic' | 'other';

export interface MappedCreative {
  meta_creative_id: string;
  name: string | null;
  title: string | null;
  body: string | null;
  call_to_action_type: string | null;
  link_url: string | null;
  object_type: string | null;
  format: CreativeFormat;
  image_url: string | null;
  thumbnail_url: string | null;
  image_hash: string | null;
  video_id: string | null;
  object_story_spec: unknown;
  asset_feed_spec: unknown;
}

/** Creative format by precedence: dynamic > carousel > video > image. */
export function detectFormat(signals: {
  hasAssetFeed: boolean;
  hasCarousel: boolean;
  videoId: string | null;
  imageHash: string | null;
  imageUrl: string | null;
}): CreativeFormat {
  if (signals.hasAssetFeed) return 'dynamic';
  if (signals.hasCarousel) return 'carousel';
  if (signals.videoId) return 'video';
  if (signals.imageHash || signals.imageUrl) return 'image';
  return 'other';
}

/** First candidate that is neither `undefined` nor `null`, else `null`. */
export function firstPresent<Value>(...candidates: (Value | undefined | null)[]): Value | null {
  for (const candidate of candidates) if (candidate !== undefined && candidate !== null) return candidate;
  return null;
}

interface StorySpecs {
  linkData: NonNullable<MetaObjectStorySpec['link_data']>;
  videoData: NonNullable<MetaObjectStorySpec['video_data']>;
  photoData: NonNullable<MetaObjectStorySpec['photo_data']>;
  assetFeed: MetaAssetFeedSpec | null;
}

/** Media references (video id, image hash/url) from whichever creative shape carries them. */
function extractMedia(creative: MetaCreative, specs: StorySpecs) {
  const { linkData, videoData, photoData, assetFeed } = specs;
  return {
    videoId: firstPresent(creative.video_id, videoData.video_id, assetFeed?.videos?.[0]?.video_id),
    imageHash: firstPresent(creative.image_hash, linkData.image_hash, videoData.image_hash, photoData.image_hash, assetFeed?.images?.[0]?.hash),
    imageUrl: firstPresent(creative.image_url, linkData.picture, videoData.image_url, photoData.url),
  };
}

/** Headline, primary text, call to action and destination from whichever creative shape carries them. */
function extractCopy(creative: MetaCreative, specs: StorySpecs) {
  const { linkData, videoData, photoData, assetFeed } = specs;
  return {
    title: firstPresent(creative.title, videoData.title, linkData.name, assetFeed?.titles?.[0]?.text),
    body: firstPresent(creative.body, videoData.message, linkData.message, photoData.caption, assetFeed?.bodies?.[0]?.text),
    callToAction: firstPresent(
      creative.call_to_action_type, videoData.call_to_action?.type, linkData.call_to_action?.type, assetFeed?.call_to_action_types?.[0],
    ),
    linkUrl: firstPresent(linkData.link, videoData.call_to_action?.value?.link, assetFeed?.link_urls?.[0]?.website_url),
  };
}

export function mapCreative(creative: MetaCreative): MappedCreative {
  const storySpec = creative.object_story_spec ?? {};
  const specs: StorySpecs = {
    linkData: storySpec.link_data ?? {},
    videoData: storySpec.video_data ?? {},
    photoData: storySpec.photo_data ?? {},
    assetFeed: creative.asset_feed_spec ?? null,
  };
  const media = extractMedia(creative, specs);
  const copy = extractCopy(creative, specs);

  return {
    meta_creative_id: String(creative.id),
    name: creative.name ?? null,
    title: copy.title,
    body: copy.body,
    call_to_action_type: copy.callToAction,
    link_url: copy.linkUrl,
    object_type: creative.object_type ?? null,
    format: detectFormat({ hasAssetFeed: Boolean(specs.assetFeed), hasCarousel: (specs.linkData.child_attachments?.length ?? 0) > 0, ...media }),
    image_url: media.imageUrl,
    thumbnail_url: creative.thumbnail_url ?? null,
    image_hash: media.imageHash,
    video_id: media.videoId,
    object_story_spec: creative.object_story_spec ?? null,
    asset_feed_spec: specs.assetFeed,
  };
}

/** Creative variations: dynamic-creative asset lists and carousel cards, as stored in the raw spec. */
export function creativeVariations(creative: Pick<CreativeRow, 'object_story_spec' | 'asset_feed_spec'> | null) {
  if (!creative) return { dynamic: null, carousel: [] as unknown[] };
  const assetFeed = creative.asset_feed_spec;
  return {
    dynamic: assetFeed
      ? {
          bodies: (assetFeed.bodies ?? []).map((entry) => entry.text),
          titles: (assetFeed.titles ?? []).map((entry) => entry.text),
          descriptions: (assetFeed.descriptions ?? []).map((entry) => entry.text),
          images: (assetFeed.images ?? []).map((entry) => entry.hash ?? entry.url),
          videos: (assetFeed.videos ?? []).map((entry) => entry.video_id),
          call_to_actions: assetFeed.call_to_action_types ?? [],
          link_urls: (assetFeed.link_urls ?? []).map((entry) => entry.website_url),
        }
      : null,
    carousel: creative.object_story_spec?.link_data?.child_attachments ?? [],
  };
}
