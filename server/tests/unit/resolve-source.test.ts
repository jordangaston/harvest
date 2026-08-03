import { describe, it, expect } from 'vitest';
import { resolveSource } from '../../src/util/resolve-source.js';

// Inputs drawn from docs/test-fixtures.md, one per pipeline branch (TC-1).
describe('resolveSource (O-01 / AC-1)', () => {
  it('classifies a TikTok video URL', () => {
    const r = resolveSource({ url: 'https://www.tiktok.com/@caitlynskitchen/video/7663645567339334943' });
    expect(r).toMatchObject({ platform: 'tiktok', sourceType: 'tiktok' });
    expect(r.normalizedUrl).toBe('https://tiktok.com/@caitlynskitchen/video/7663645567339334943');
  });

  it('classifies Instagram /p/ and /reel/ posts', () => {
    expect(resolveSource({ url: 'https://www.instagram.com/p/Dbi_HX7RZBN/' })).toMatchObject({
      platform: 'instagram',
      sourceType: 'instagram',
    });
    expect(resolveSource({ url: 'https://www.instagram.com/reel/Dbi_VuygdfS/' }).platform).toBe('instagram');
  });

  it('maps an fb.watch short link to facebook without following it', () => {
    expect(resolveSource({ url: 'https://fb.watch/abc123/' })).toMatchObject({
      platform: 'facebook',
      sourceType: 'facebook',
      normalizedUrl: 'https://fb.watch/abc123/',
    });
    expect(resolveSource({ url: 'https://www.facebook.com/reel/123456' }).platform).toBe('facebook');
  });

  it('classifies a Pinterest pin', () => {
    expect(resolveSource({ url: 'https://www.pinterest.com/pin/68750145082/' })).toMatchObject({
      platform: 'pinterest',
      sourceType: 'pinterest',
    });
  });

  it('classifies an unknown host as a recipe website', () => {
    expect(resolveSource({ url: 'https://thecozycook.com/creamy-garlic-chicken/' })).toMatchObject({
      platform: 'website',
      sourceType: 'website',
      normalizedUrl: 'https://thecozycook.com/creamy-garlic-chicken/',
    });
  });

  it('classifies a picked photo as an image source', () => {
    expect(resolveSource({ imageRef: 'uploads/abc.jpg' })).toEqual({
      platform: 'photo',
      sourceType: 'photo',
      imageRef: 'uploads/abc.jpg',
    });
  });

  it('strips tracking params during normalization', () => {
    const r = resolveSource({
      url: 'https://www.tiktok.com/@x/video/1?is_from_webapp=1&sender_device=pc&_r=1&utm_source=ig',
    });
    expect(r.normalizedUrl).toBe('https://tiktok.com/@x/video/1');
  });

  it('reads a URL out of a share payload text', () => {
    const r = resolveSource({ sharePayload: { text: 'look at this https://www.tiktok.com/@x/video/9 yum' } });
    expect(r).toMatchObject({ platform: 'tiktok', normalizedUrl: 'https://tiktok.com/@x/video/9' });
  });

  it('rejects a profile URL, junk text, and a non-http URL as unsupported', () => {
    expect(resolveSource({ url: 'https://instagram.com/someprofile' }).platform).toBe('unsupported');
    expect(resolveSource({ sharePayload: { text: 'hello' } }).platform).toBe('unsupported');
    expect(resolveSource({ url: 'ftp://example.com/x' }).platform).toBe('unsupported');
  });
});
