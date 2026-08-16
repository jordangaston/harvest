import type { SourceType } from "../schema.js";

/**
 * Apify fetch (needs APIFY_TOKEN): scrape a social post's caption, thumbnail,
 * video URL, carousel slides, and outbound link. One authenticated call to the
 * REST `run-sync-get-dataset-items` endpoint per platform (no apify-client dep).
 * Outputs map onto one flat `FetchedPost` so callers don't branch on the provider.
 *
 * Ported from server/src/fetch/apify-fetcher.ts (the `mapItem`/`buildInput`
 * shapes), swapping the SDK for the REST endpoint the S2 stub already used.
 */

/** A scraped post, normalized across platforms. Every field is best-effort. */
export interface FetchedPost {
  caption?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  outboundLink?: string;
  /** Ordered slide image URLs of a carousel/sidecar post; absent for single-media. */
  images?: string[];
  /** Extra HTTP headers ffmpeg must send to fetch `videoUrl`; absent when none. */
  videoHeaders?: Record<string, string>;
}

/** Platforms an Apify actor exists for. Website/photo/youtube never route here. */
export type ApifyPlatform = Extract<SourceType, "instagram" | "tiktok" | "facebook" | "pinterest">;

/** Per-platform actor IDs (`user~actor` form for the REST path). */
const ACTORS: Record<ApifyPlatform, string> = {
  instagram: "apify~instagram-scraper",
  tiktok: "clockworks~tiktok-video-scraper",
  facebook: "apivault_labs~facebook-reels-video-scraper",
  pinterest: "dltik~pinterest-scraper",
};

export interface SourceFetcher {
  fetchPost(platform: ApifyPlatform, url: string): Promise<FetchedPost>;
}

/** Live Apify fetcher over the REST run-sync endpoint. */
export class ApifyFetcher implements SourceFetcher {
  constructor(private readonly token: string) {}

  static create(): ApifyFetcher {
    return new ApifyFetcher(process.env.APIFY_TOKEN!);
  }

  async fetchPost(platform: ApifyPlatform, url: string): Promise<FetchedPost> {
    const endpoint = `https://api.apify.com/v2/acts/${ACTORS[platform]}/run-sync-get-dataset-items?token=${this.token}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInput(platform, url)),
    });
    if (!res.ok) throw new Error(`Apify ${platform} scrape failed — HTTP ${res.status}`);
    const items = (await res.json()) as Array<Record<string, unknown>>;
    return authorizeApifyMedia(mapItem(platform, items[0]), this.token);
  }
}

/**
 * Apify mirrors downloaded media to its key-value store, whose record URLs are
 * private (403 without the token). ffmpeg fetches these URLs directly, so append
 * the token to any Apify-hosted media URL — otherwise ffmpeg gets a 403 and the
 * media path fails. Non-Apify URLs (a TikTok/IG CDN) are left untouched.
 */
function authorizeApifyMedia(post: FetchedPost, token: string): FetchedPost {
  const auth = (u?: string): string | undefined =>
    u && u.startsWith("https://api.apify.com/") ? `${u}${u.includes("?") ? "&" : "?"}token=${token}` : u;
  return {
    ...post,
    videoUrl: auth(post.videoUrl),
    images: post.images?.map((u) => auth(u)!),
  };
}

/** Dev/test double: recorded fixtures keyed by platform, no runs/spend. */
export class StubApifyFetcher implements SourceFetcher {
  static readonly FIXTURES: Record<ApifyPlatform, FetchedPost> = {
    tiktok: { caption: "Garlic butter fried rice — full recipe on my site", videoUrl: "https://v16.tiktokcdn.com/stub.mp4" },
    instagram: { caption: "Red potato salad — steps below" },
    facebook: { caption: "Creamy sausage pasta reel", videoUrl: "https://fb.cdn.com/stub.mp4" },
    pinterest: { caption: "Garlic parmesan chicken", outboundLink: "https://theferventmama.com/x/" },
  };

  async fetchPost(platform: ApifyPlatform, _url: string): Promise<FetchedPost> {
    return StubApifyFetcher.FIXTURES[platform];
  }
}

/** Apify when keyed, else the offline stub. */
export function selectSourceFetcher(): SourceFetcher {
  return process.env.APIFY_TOKEN ? ApifyFetcher.create() : new StubApifyFetcher();
}

/** Actor input shapes — each actor names its single-URL field differently. */
export function buildInput(platform: ApifyPlatform, url: string): Record<string, unknown> {
  switch (platform) {
    case "instagram":
      return { directUrls: [url], resultsType: "posts", resultsLimit: 1, addParentData: false };
    case "tiktok":
      // shouldDownloadVideos:true makes the actor mirror the clip to its own
      // key-value store and return a direct, ffmpeg-readable MP4 in `mediaUrls`.
      // Without it clockworks returns only the (un-decodable) page URL.
      return { postURLs: [url], resultsPerPage: 1, shouldDownloadVideos: true };
    case "facebook":
      return { startUrls: [{ url }] };
    case "pinterest":
      return { startUrls: [{ url }], proxyConfig: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] } };
  }
}

/** Map a raw actor item onto FetchedPost using each provider's field names. */
export function mapItem(platform: ApifyPlatform, item: Record<string, unknown> | undefined): FetchedPost {
  if (!item) return {};
  switch (platform) {
    case "tiktok": {
      // `mediaUrls[0]` (with shouldDownloadVideos) is a direct MP4 on Apify's KV
      // store — ffmpeg-readable, no headers. `webVideoUrl` is only a page URL, so
      // it is NOT used for the video: it would fail ffmpeg. A slideshow post's
      // ordered slide images arrive in `slideshowImageLinks[].downloadLink` (the
      // clockworks actor leaves `mediaUrls` empty for photo-mode posts).
      const media = strArray(item.mediaUrls) ?? [];
      const isSlideshow = item.isSlideshow === true;
      return {
        caption: str(item.text),
        thumbnailUrl: str(nested(item.videoMeta, "coverUrl")),
        videoUrl: isSlideshow ? undefined : str(media[0] ?? nested(item.videoMeta, "downloadAddr")),
        images: isSlideshow ? (slideshowImages(item.slideshowImageLinks) ?? strArray(media)) : undefined,
      };
    }
    case "instagram":
      return {
        caption: str(item.caption),
        thumbnailUrl: str(item.displayUrl),
        videoUrl: str(item.videoUrl),
        images: strArray(item.images),
      };
    case "facebook":
      return {
        caption: str(item.text ?? item.caption),
        thumbnailUrl: str(item.thumbnailUrl ?? item.previewImageUrl),
        videoUrl: str(item.videoUrl ?? item.url),
      };
    case "pinterest":
      // Pinterest exposes no video_url — image + outbound link → website path.
      return { caption: str(item.title ?? item.description), thumbnailUrl: str(item.image_url), outboundLink: str(item.link) };
  }
}

/** The value if it's a non-empty string, else undefined. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The non-empty string elements of an array, or undefined when there are none. */
export function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return urls.length > 0 ? urls : undefined;
}

/** Read `key` off `value` when it's an object, else undefined. */
function nested(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * The ordered slide image URLs from clockworks' `slideshowImageLinks` — an array
 * of `{ tiktokLink, downloadLink }`. Prefer `downloadLink`, fall back to
 * `tiktokLink`, drop blanks. Undefined when there are no usable links.
 */
function slideshowImages(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value
    .map((link) => str(nested(link, "downloadLink")) ?? str(nested(link, "tiktokLink")))
    .filter((u): u is string => !!u);
  return urls.length > 0 ? urls : undefined;
}
