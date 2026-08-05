/**
 * TikTok oEmbed (Tier 0, no creds): the free caption + thumbnail for a TikTok URL
 * from TikTok's public oEmbed endpoint. Returns `null` when the post is
 * private/removed so the caller can fall back to a higher tier.
 * Docs: https://developers.tiktok.com/doc/embed-videos/
 */
import { env } from '../config/env.js';

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
  /** @returns A live oEmbed client. */
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

  /** @returns The fixed stub payload (no network). */
  async fetch(_url: string): Promise<TikTokOembedResult | null> {
    return StubTikTokOembed.PAYLOAD;
  }
}

/**
 * The stub under `NODE_ENV=test`, else the live client.
 * @returns The oEmbed client for the current environment.
 */
// ponytail: no creds to gate on, so tests run the stub, everything else is live.
export function selectTikTokOembed(): TikTokOembed | StubTikTokOembed {
  return env.NODE_ENV === 'test' ? new StubTikTokOembed() : TikTokOembed.create();
}
