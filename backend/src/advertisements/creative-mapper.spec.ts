import { creativeVariations, detectFormat, firstPresent, mapCreative } from './creative-mapper';

describe('firstPresent', () => {
  it('returns the first non-nullish candidate', () => expect(firstPresent(undefined, null, 'a', 'b')).toBe('a'));
  it('keeps falsy but present values', () => expect(firstPresent(undefined, '', 'x')).toBe(''));
  it('returns null when nothing is present', () => expect(firstPresent(undefined, null)).toBeNull());
});

describe('detectFormat', () => {
  const none = { hasAssetFeed: false, hasCarousel: false, videoId: null, imageHash: null, imageUrl: null };
  it('prefers dynamic, then carousel, video, image', () => {
    expect(detectFormat({ ...none, hasAssetFeed: true, hasCarousel: true, videoId: 'v' })).toBe('dynamic');
    expect(detectFormat({ ...none, hasCarousel: true, videoId: 'v' })).toBe('carousel');
    expect(detectFormat({ ...none, videoId: 'v', imageUrl: 'u' })).toBe('video');
    expect(detectFormat({ ...none, imageHash: 'h' })).toBe('image');
    expect(detectFormat({ ...none, imageUrl: 'u' })).toBe('image');
  });
  it('falls back to other', () => expect(detectFormat(none)).toBe('other'));
});

describe('mapCreative', () => {
  it('maps a simple image creative', () => {
    expect(mapCreative({ id: '1', name: 'N', title: 'T', body: 'B', call_to_action_type: 'SHOP_NOW', image_hash: 'abc', thumbnail_url: 'http://t' })).toMatchObject({
      meta_creative_id: '1', title: 'T', body: 'B', call_to_action_type: 'SHOP_NOW', image_hash: 'abc', format: 'image', thumbnail_url: 'http://t', video_id: null,
    });
  });

  it('reads copy, media and CTA from a link-data story spec', () => {
    const mapped = mapCreative({
      id: '2',
      object_story_spec: {
        link_data: { name: 'Headline', message: 'Primary', link: 'https://shop.test', picture: 'http://img', call_to_action: { type: 'LEARN_MORE' } },
      },
    });
    expect(mapped).toMatchObject({ title: 'Headline', body: 'Primary', link_url: 'https://shop.test', image_url: 'http://img', call_to_action_type: 'LEARN_MORE', format: 'image' });
  });

  it('reads a video creative from video_data', () => {
    const mapped = mapCreative({
      id: '3',
      object_story_spec: { video_data: { video_id: 'vid-1', title: 'V title', message: 'V text', call_to_action: { type: 'WATCH_MORE', value: { link: 'https://v.test' } } } },
    });
    expect(mapped).toMatchObject({ format: 'video', video_id: 'vid-1', title: 'V title', body: 'V text', link_url: 'https://v.test', call_to_action_type: 'WATCH_MORE' });
  });

  it('detects carousels', () => {
    expect(mapCreative({ id: '4', object_story_spec: { link_data: { child_attachments: [{ name: 'a' }, { name: 'b' }] } } }).format).toBe('carousel');
  });

  it('detects dynamic creatives and takes the first asset values', () => {
    const mapped = mapCreative({
      id: '5',
      asset_feed_spec: {
        titles: [{ text: 'T1' }, { text: 'T2' }], bodies: [{ text: 'B1' }], images: [{ hash: 'h1' }], videos: [{ video_id: 'v1' }],
        call_to_action_types: ['SIGN_UP'], link_urls: [{ website_url: 'https://dyn.test' }],
      },
    });
    expect(mapped).toMatchObject({ format: 'dynamic', title: 'T1', body: 'B1', image_hash: 'h1', video_id: 'v1', call_to_action_type: 'SIGN_UP', link_url: 'https://dyn.test' });
  });

  it('maps an empty creative to the other format', () => {
    expect(mapCreative({ id: '6' })).toMatchObject({ format: 'other', title: null, body: null, image_hash: null });
  });

  it('prefers top-level fields over story spec fields', () => {
    expect(mapCreative({ id: '7', title: 'Top', object_story_spec: { link_data: { name: 'Nested' } } }).title).toBe('Top');
  });
});

describe('creativeVariations', () => {
  it('returns an empty shape without a creative', () => expect(creativeVariations(null)).toEqual({ dynamic: null, carousel: [] }));

  it('lists dynamic creative assets', () => {
    const variations = creativeVariations({
      object_story_spec: null,
      asset_feed_spec: {
        bodies: [{ text: 'b' }], titles: [{ text: 't' }], descriptions: [{ text: 'd' }], images: [{ hash: 'h' }, { url: 'u' }],
        videos: [{ video_id: 'v' }], call_to_action_types: ['SHOP_NOW'], link_urls: [{ website_url: 'w' }],
      },
    });
    expect(variations.dynamic).toEqual({
      bodies: ['b'], titles: ['t'], descriptions: ['d'], images: ['h', 'u'], videos: ['v'], call_to_actions: ['SHOP_NOW'], link_urls: ['w'],
    });
  });

  it('returns carousel cards', () => {
    const variations = creativeVariations({ asset_feed_spec: null, object_story_spec: { link_data: { child_attachments: [{ name: 'card' }] } } });
    expect(variations.dynamic).toBeNull();
    expect(variations.carousel).toEqual([{ name: 'card' }]);
  });
});
