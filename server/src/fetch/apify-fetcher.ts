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
}

/** Platforms an Apify actor exists for. Website/photo never route here. */
export type ApifyPlatform = Extract<SourceType, 'instagram' | 'tiktok' | 'facebook' | 'pinterest'>;

export interface SourceFetcher {
  fetchPost(platform: ApifyPlatform, url: string): Promise<FetchedPost>;
}

/** Per-platform actor IDs (see docs/test-fixtures.md "Provider notes"). */
const ACTORS: Record<ApifyPlatform, string> = {
  instagram: 'apify/instagram-reel-scraper',
  tiktok: 'clockworks/tiktok-video-scraper',
  facebook: 'apivault_labs/facebook-reels-video-scraper',
  pinterest: 'dltik/pinterest-scraper',
};

export class ApifyFetcher implements SourceFetcher {
  constructor(private readonly client: ApifyClient) {}

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

  async fetchPost(platform: ApifyPlatform, _url: string): Promise<FetchedPost> {
    return StubApifyFetcher.FIXTURES[platform];
  }
}

/** Real when APIFY_TOKEN is set, else the offline stub. Going live is an env swap. */
export function selectSourceFetcher(): SourceFetcher {
  return env.APIFY_TOKEN ? ApifyFetcher.create() : new StubApifyFetcher();
}

/** Actor input shapes — each actor names its single-URL field differently. */
function buildInput(platform: ApifyPlatform, url: string): Record<string, unknown> {
  switch (platform) {
    case 'instagram':
      return { directUrls: [url], resultsLimit: 1 };
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
      return { caption: str(item.caption), thumbnailUrl: str(item.displayUrl), videoUrl: str(item.videoUrl) };
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nested(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}
