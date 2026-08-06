import { ApifyClient } from 'apify-client';
import { env } from '../config/env.js';
import type { SourceType } from '../db/schema/enums.js';

/**
 * Apify fetch (Tier 1/2, needs APIFY_TOKEN): scrape a social post's caption,
 * thumbnail, video URL, and outbound link. Each platform runs its own actor;
 * outputs map onto one flat shape so callers don't branch on the provider.
 * Coded to the apify-client docs; tests drive StubApifyFetcher (no runs, no spend).
 */

/** A scraped post, normalized across platforms. Every field is best-effort. */
export interface FetchedPost {
  caption?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  outboundLink?: string;
  /** Ordered slide image URLs of a carousel/sidecar post (Instagram); absent for
   * single-media posts. Drives the multi-recipe slideshow path. */
  images?: string[];
  /** Extra HTTP headers ffmpeg must send to fetch `videoUrl` (TikTok's CDN blocks
   * bare requests). Absent when the video URL needs no special headers. */
  videoHeaders?: Record<string, string>;
}

/** Platforms an Apify actor exists for. Website/photo never route here. */
export type ApifyPlatform = Extract<SourceType, 'instagram' | 'tiktok' | 'facebook' | 'pinterest'>;

export interface SourceFetcher {
  fetchPost(platform: ApifyPlatform, url: string): Promise<FetchedPost>;
}

/** Per-platform actor IDs (see docs/test-fixtures.md "Provider notes"). The
 * Instagram actor is the general post scraper (not the reel-only one) so a single
 * URL resolves whether it's a reel, a single photo, or a multi-image carousel. */
const ACTORS: Record<ApifyPlatform, string> = {
  instagram: 'apify/instagram-scraper',
  tiktok: 'clockworks/tiktok-video-scraper',
  facebook: 'apivault_labs/facebook-reels-video-scraper',
  pinterest: 'dltik/pinterest-scraper',
};

export class ApifyFetcher implements SourceFetcher {
  /** @param client - An authenticated Apify client (token already set). */
  constructor(private readonly client: ApifyClient) {}

  /**
   * Wire a fetcher against a client built from `APIFY_TOKEN`.
   * @returns A live fetcher.
   */
  static create(): ApifyFetcher {
    return new ApifyFetcher(new ApifyClient({ token: env.APIFY_TOKEN }));
  }

  /**
   * Run the platform's actor for a single post URL and map its first dataset
   * item onto `FetchedPost`.
   *
   * @param platform - The social platform (selects the actor)
   * @param url - The post URL to scrape
   * @returns The scraped post; empty fields when the actor returned nothing
   */
  async fetchPost(platform: ApifyPlatform, url: string): Promise<FetchedPost> {
    const run = await this.client.actor(ACTORS[platform]).call(buildInput(platform, url));
    const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
    return mapItem(platform, items[0] as Record<string, unknown> | undefined);
  }
}

/** Dev/test double: returns recorded fixtures keyed by platform, no runs/spend. */
export class StubApifyFetcher implements SourceFetcher {
  static readonly FIXTURES: Record<ApifyPlatform, FetchedPost> = {
    tiktok: {
      caption: 'Garlic butter fried rice — full recipe on my site',
      thumbnailUrl: 'https://p16.tiktokcdn.com/stub.jpg',
      videoUrl: 'https://v16.tiktokcdn.com/stub.mp4',
      outboundLink: 'https://iamneverfull.com/garlic-butter-fried-rice-recipe/',
    },
    instagram: {
      caption: 'Red potato salad — steps below',
      thumbnailUrl: 'https://instagram.fcdn.com/stub.jpg',
    },
    facebook: {
      caption: 'Creamy sausage pasta reel',
      thumbnailUrl: 'https://fb.cdn.com/stub.jpg',
      videoUrl: 'https://fb.cdn.com/stub.mp4',
    },
    pinterest: {
      caption: 'Garlic parmesan chicken and potatoes',
      thumbnailUrl: 'https://i.pinimg.com/stub.jpg',
      outboundLink: 'https://theferventmama.com/garlic-parmesan-chicken-and-potatoes/',
    },
  };

  /**
   * Return the recorded fixture for `platform` (url ignored).
   * @param platform - The social platform (selects the fixture)
   * @returns The fixture post.
   */
  async fetchPost(platform: ApifyPlatform, _url: string): Promise<FetchedPost> {
    return StubApifyFetcher.FIXTURES[platform];
  }
}

/**
 * HikerAPI (Instagram only): one authenticated call to Instagram's private media
 * API by post URL returns the caption, video URL, and a carousel's ordered slide
 * images in ~1-2s — versus a browser-scraping actor's 6-16s. Non-Instagram
 * platforms delegate to the Apify fallback. Coded to the HikerAPI v1 docs.
 */
const HIKER_BASE = 'https://api.hikerapi.com';

export class HikerFetcher implements SourceFetcher {
  /**
   * @param apiKey - HikerAPI access key (sent as `x-access-key`).
   * @param fallback - Fetcher for non-Instagram platforms.
   */
  constructor(
    private readonly apiKey: string,
    private readonly fallback: SourceFetcher,
  ) {}

  /** Wire from HIKER_API_KEY; other platforms fall back to Apify (or the stub). */
  static create(): HikerFetcher {
    const fallback = env.APIFY_TOKEN ? ApifyFetcher.create() : new StubApifyFetcher();
    return new HikerFetcher(env.HIKER_API_KEY!, fallback);
  }

  /**
   * Fetch a single Instagram post via HikerAPI; delegate other platforms.
   * @param platform - Only `instagram` uses HikerAPI.
   * @param url - The post URL to fetch.
   * @returns The scraped post, normalized onto FetchedPost.
   * @throws Error - On a non-2xx HikerAPI response.
   */
  async fetchPost(platform: ApifyPlatform, url: string): Promise<FetchedPost> {
    if (platform !== 'instagram') return this.fallback.fetchPost(platform, url);
    const endpoint = `${HIKER_BASE}/v1/media/by/url?url=${encodeURIComponent(url)}`;
    // Bounded + one retry: a bare fetch has no timeout, so a stalled connection
    // (e.g. HikerAPI throttling under load) would hang the workflow step forever.
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          headers: { 'x-access-key': this.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(HIKER_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HikerAPI failed — HTTP ${res.status}`);
        const body = (await res.json()) as Record<string, unknown>;
        return mapHikerMedia((body.media as Record<string, unknown>) ?? body);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('HikerAPI request failed');
  }
}

/** HikerAPI per-request timeout (~1-2s typical; a stall past this is retried once). */
const HIKER_TIMEOUT_MS = 20000;

/** Map HikerAPI's instagrapi Media object onto FetchedPost (album children →
 * ordered slide images via each resource's `thumbnail_url`). */
function mapHikerMedia(media: Record<string, unknown>): FetchedPost {
  const resources = Array.isArray(media.resources) ? (media.resources as Record<string, unknown>[]) : [];
  return {
    caption: str(media.caption_text),
    thumbnailUrl: str(media.thumbnail_url),
    videoUrl: str(media.video_url),
    images: strArray(resources.map((resource) => resource.thumbnail_url)),
  };
}

/**
 * Instagram via HikerAPI when keyed (fast private-media API); else the Apify
 * actor when APIFY_TOKEN is set; else the offline stub. Going live is an env swap.
 */
export function selectSourceFetcher(): SourceFetcher {
  if (env.HIKER_API_KEY) return HikerFetcher.create();
  return env.APIFY_TOKEN ? ApifyFetcher.create() : new StubApifyFetcher();
}

/** Actor input shapes — each actor names its single-URL field differently. */
function buildInput(platform: ApifyPlatform, url: string): Record<string, unknown> {
  switch (platform) {
    case 'instagram':
      return { directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false };
    case 'tiktok':
      return { postURLs: [url], resultsPerPage: 1, shouldDownloadVideos: false };
    case 'facebook':
      return { startUrls: [{ url }] };
    case 'pinterest':
      return { startUrls: [{ url }], proxyConfig: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } };
  }
}

/** Map a raw actor item onto FetchedPost using each provider's field names. */
function mapItem(platform: ApifyPlatform, item: Record<string, unknown> | undefined): FetchedPost {
  if (!item) return {};
  switch (platform) {
    case 'tiktok':
      return { caption: str(item.text), thumbnailUrl: str(nested(item.videoMeta, 'coverUrl')), videoUrl: str(item.webVideoUrl) };
    case 'instagram':
      return {
        caption: str(item.caption),
        thumbnailUrl: str(item.displayUrl),
        videoUrl: str(item.videoUrl),
        images: strArray(item.images),
      };
    case 'facebook':
      return {
        caption: str(item.text ?? item.caption),
        thumbnailUrl: str(item.thumbnailUrl ?? item.previewImageUrl),
        videoUrl: str(item.videoUrl ?? item.url),
      };
    case 'pinterest':
      // Pinterest exposes no video_url — image + outbound link → website path (Q-01).
      return { caption: str(item.title ?? item.description), thumbnailUrl: str(item.image_url), outboundLink: str(item.link) };
  }
}

/** The value if it's a non-empty string, else undefined. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The non-empty string elements of an array, or undefined when there are none. */
export function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return urls.length > 0 ? urls : undefined;
}

/** Read `key` off `value` when it's an object, else undefined. */
function nested(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}
