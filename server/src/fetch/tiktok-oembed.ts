/**
 * TikTok oEmbed (Tier 0, no creds): the free caption + thumbnail for a TikTok
 * URL. TikTok's public oEmbed endpoint returns the video's caption as `title` and
 * a `thumbnail_url`, so we can attempt a caption-first extract before spending an
 * Apify run. Returns `null` when the post is private/removed or the endpoint
 * declines — the caller falls back to a higher tier rather than failing the import.
 *
 * Docs: https://developers.tiktok.com/doc/embed-videos/
 */

const OEMBED_ENDPOINT = 'https://www.tiktok.com/oembed';

/** A TikTok post's free caption + thumbnail, as read from oEmbed. */
export interface TikTokOembedResult {
  caption: string;
  thumbnailUrl: string;
}

/** The oEmbed fields we read; other fields (author, html, sizes) are ignored. */
interface OembedPayload {
  title?: string;
  thumbnail_url?: string;
}

export class TikTokOembed {
  static create(): TikTokOembed {
    return new TikTokOembed();
  }

  /**
   * Fetch the caption + thumbnail for a TikTok post URL.
   *
   * @param url - The TikTok post URL
   * @returns The caption + thumbnail, or null when the post is unavailable
   */
  async fetch(url: string): Promise<TikTokOembedResult | null> {
    const response = await fetch(`${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}`);
    if (!response.ok) return null;

    const payload = (await response.json()) as OembedPayload;
    if (!payload.title && !payload.thumbnail_url) return null;
    return { caption: payload.title ?? '', thumbnailUrl: payload.thumbnail_url ?? '' };
  }
}

/** Dev/test double: returns a fixed payload, no network. */
export class StubTikTokOembed {
  static readonly PAYLOAD: TikTokOembedResult = {
    caption: 'Crockpot Chicken Teriyaki — full recipe below',
    thumbnailUrl: 'https://p16.tiktokcdn.com/stub-thumb.jpg',
  };

  async fetch(_url: string): Promise<TikTokOembedResult | null> {
    return StubTikTokOembed.PAYLOAD;
  }
}
