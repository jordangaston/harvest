import { env } from '../config/env.js';
import { selectTikTokOembed } from './tiktok-oembed.js';
import { str, strArray, type SourceFetcher, type FetchedPost, type ApifyPlatform } from './apify-fetcher.js';

/**
 * LamaTok (TikTok, by the HikerAPI makers): resolve a post URL to its numeric id,
 * then one call to TikTok's private media API returns the caption, video, and a
 * slideshow's ordered images. Uses `by/id` (not `by/url`) so photo/slideshow
 * posts work too — LamaTok's `by/url` errors on them. Coded to the LamaTok docs.
 */

const LAMATOK_BASE = 'https://api.lamatok.com';
const LAMATOK_TIMEOUT_MS = 30000;
const TIKTOK_ID_RE = /\/(?:video|photo)\/(\d+)/;
// A mobile UA so the short-link redirect resolves rather than hitting a wall.
const RESOLVE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/** The subset of TikTok's item shape LamaTok returns that we read. */
interface TikTokMedia {
  desc?: string;
  video?: { cover?: string; playAddr?: string };
  imagePost?: { images?: Array<{ imageURL?: { urlList?: string[] } }> };
}

export class LamatokFetcher implements SourceFetcher {
  /** @param apiKey - LamaTok access key (sent as `x-access-key`). */
  constructor(private readonly apiKey: string) {}

  /** Wire from LAMATOK_API_KEY. */
  static create(): LamatokFetcher {
    return new LamatokFetcher(env.LAMATOK_API_KEY!);
  }

  /**
   * Fetch a single TikTok post via LamaTok.
   * @param _platform - Always `tiktok` here.
   * @param url - The post URL (short link or canonical).
   * @returns The scraped post, normalized onto FetchedPost.
   * @throws Error - When the id can't be resolved or LamaTok returns non-2xx.
   */
  async fetchPost(_platform: ApifyPlatform, url: string): Promise<FetchedPost> {
    const id = await resolveTikTokId(url);
    const media = await this.mediaById(id);
    const images = strArray((media.imagePost?.images ?? []).map((image) => image?.imageURL?.urlList?.[0]));
    // A slideshow (has images) has no video. For a video post, TikTok's CDN
    // blocks bare ffmpeg, so resolve the download endpoint's URL + headers.
    // ponytail: eager per video post; skip it when a caption already yields a
    // recipe if the extra call ever matters.
    const video = images ? undefined : await this.videoDownload(id);
    return {
      caption: str(media.desc),
      thumbnailUrl: str(media.video?.cover),
      videoUrl: video?.url,
      videoHeaders: video?.headers,
      images,
    };
  }

  /** The post's media object (unwrapping LamaTok's optional `media` envelope). */
  private async mediaById(id: string): Promise<TikTokMedia> {
    const body = await this.get<{ media?: TikTokMedia } & TikTokMedia>(`/v1/media/by/id?id=${id}`);
    return body.media ?? body;
  }

  /** An ffmpeg-fetchable video URL + the headers TikTok requires, or undefined. */
  private async videoDownload(id: string): Promise<{ url: string; headers: Record<string, string> } | undefined> {
    try {
      const body = await this.get<{ download_url?: string; headers?: Record<string, string> }>(
        `/v1/media/video/download/by/id?id=${id}`,
      );
      return body.download_url ? { url: body.download_url, headers: body.headers ?? {} } : undefined;
    } catch {
      return undefined;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${LAMATOK_BASE}${path}`, {
      headers: { 'x-access-key': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(LAMATOK_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LamaTok ${path} — HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

/** Caption-only TikTok oEmbed wrapped as a SourceFetcher (the no-LamaTok path). */
class OembedTikTokFetcher implements SourceFetcher {
  async fetchPost(_platform: ApifyPlatform, url: string): Promise<FetchedPost> {
    const result = await selectTikTokOembed().fetch(url);
    return result ? { caption: result.caption, thumbnailUrl: result.thumbnailUrl } : {};
  }
}

/** LamaTok when keyed (full caption + video + slideshow), else caption-only
 * oEmbed (which is the offline stub under test). */
export function selectTikTokFetcher(): SourceFetcher {
  return env.LAMATOK_API_KEY ? LamatokFetcher.create() : new OembedTikTokFetcher();
}

/** Resolve a TikTok post URL to its numeric media id — directly from a canonical
 * `/video/{id}` or `/photo/{id}` URL, else by following a short link's redirect. */
async function resolveTikTokId(url: string): Promise<string> {
  const direct = url.match(TIKTOK_ID_RE);
  if (direct) return direct[1];
  const res = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    headers: { 'user-agent': RESOLVE_UA },
    signal: AbortSignal.timeout(15000),
  });
  const resolved = res.url.match(TIKTOK_ID_RE);
  if (!resolved) throw new Error(`Cannot resolve TikTok id from ${url}`);
  return resolved[1];
}
