import { str } from './apify-fetcher.js';

/**
 * YouTube fetch (Tier 0/1, no creds): read a video's description, its pinned
 * comment, and the first recipe link in the description via YouTube's own
 * InnerTube API (the same JSON API the site uses) — no API key, ~150ms–1s. A
 * recipe lives in one of those three: the description, the pinned comment, or a
 * blog the description links to (transcript-style videos).
 */

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const PLAYER = 'https://www.youtube.com/youtubei/v1/player';
const NEXT = 'https://www.youtube.com/youtubei/v1/next';
const CLIENT = { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en' };
const YT_TIMEOUT_MS = 8000;
const VIDEO_ID_RE = /(?:youtu\.be\/|\/shorts\/|\/live\/|[?&]v=)([\w-]{6,})/;

/** What a video yields for recipe extraction. */
export interface YouTubeVideo {
  description?: string;
  pinnedComment?: string;
  /** The video's spoken content (timed-text captions), when it has a caption track.
   * Carries cooking steps that live in the video, not the description. */
  transcript?: string;
  /** First non-YouTube link in the description — usually the printable recipe. */
  outboundLink?: string;
  thumbnailUrl?: string;
}

export class YouTubeFetcher {
  /** @returns A live fetcher (InnerTube is public, no key of ours). */
  static create(): YouTubeFetcher {
    return new YouTubeFetcher();
  }

  /**
   * Fetch a video's description, pinned comment, and outbound recipe link.
   * @param url - A `youtu.be/{id}`, `/shorts/{id}`, or `/watch?v={id}` URL.
   * @returns The extracted text sources.
   * @throws Error - When the id can't be resolved.
   */
  async fetch(url: string): Promise<YouTubeVideo> {
    const id = resolveVideoId(url);
    const [player, pinnedComment] = await Promise.all([
      this.player(id),
      this.pinnedComment(id).catch(() => undefined),
    ]);
    const transcript = await this.transcript(player.captionBaseUrl);
    return {
      description: player.description,
      pinnedComment,
      transcript,
      outboundLink: firstOutboundLink(player.description),
      // videoDetails.thumbnail is often absent under the WEB context; derive a valid
      // thumbnail from the id so every video/Short gets a hero image.
      thumbnailUrl: player.thumbnailUrl ?? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    };
  }

  private async player(id: string): Promise<{ description?: string; thumbnailUrl?: string; captionBaseUrl?: string }> {
    const body = await this.post<PlayerResponse>(PLAYER, { videoId: id });
    const thumbs = body.videoDetails?.thumbnail?.thumbnails ?? [];
    const tracks = body.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
    return {
      description: str(body.videoDetails?.shortDescription),
      thumbnailUrl: thumbs[thumbs.length - 1]?.url,
      captionBaseUrl: track?.baseUrl,
    };
  }

  /**
   * Fetch and flatten the video's timed-text transcript (json3). Best-effort — the
   * caller falls back to the caption when a video has no caption track.
   * @param baseUrl - The caption track's baseUrl from the player response.
   * @returns The transcript text, or undefined when absent/unreadable.
   */
  private async transcript(baseUrl?: string): Promise<string | undefined> {
    if (!baseUrl) return undefined;
    try {
      const res = await fetch(`${baseUrl}&fmt=json3`, { signal: AbortSignal.timeout(YT_TIMEOUT_MS) });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
      const text = (body.events ?? [])
        .flatMap((event) => (event.segs ?? []).map((seg) => seg.utf8 ?? ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      return text || undefined;
    } catch {
      return undefined;
    }
  }

  /** The pinned comment's text, or undefined when the video has none. */
  private async pinnedComment(id: string): Promise<string | undefined> {
    const watch = await this.post<InnerTubeResponse>(NEXT, { videoId: id });
    const token = commentsContinuation(watch);
    if (!token) return undefined;
    const comments = await this.post<InnerTubeResponse>(NEXT, { continuation: token });
    // The pinned comment sorts first — only take it when a "Pinned by" marker is
    // present, so a video without one doesn't feed a random top comment in.
    if (deepFind(comments, 'pinnedText').length === 0) return undefined;
    return str(deepFind(comments, 'commentEntityPayload')[0]?.properties?.content?.content);
  }

  private async post<T>(endpoint: string, extra: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${endpoint}?key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: CLIENT }, ...extra }),
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`YouTube InnerTube — HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

interface PlayerResponse {
  videoDetails?: { shortDescription?: string; thumbnail?: { thumbnails?: Array<{ url?: string }> } };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string; languageCode?: string }> };
  };
}
type InnerTubeResponse = Record<string, unknown>;

/** Resolve a video id from any YouTube URL form (short link, shorts, watch). */
function resolveVideoId(url: string): string {
  const match = url.match(VIDEO_ID_RE);
  if (!match) throw new Error(`Cannot resolve YouTube id from ${url}`);
  return match[1];
}

/** The comments section's continuation token — the section flagged `comment-item-section`. */
function commentsContinuation(watch: InnerTubeResponse): string | undefined {
  const sections = deepFind(watch, 'itemSectionRenderer').filter(
    (section) => section?.sectionIdentifier === 'comment-item-section',
  );
  const fromSection = deepFind(sections, 'continuationCommand')[0]?.token;
  // Fallback: the comments continuation is the last one on the watch page.
  return fromSection ?? deepFind(watch, 'continuationCommand').at(-1)?.token;
}

/** Collect every value stored under `key` anywhere in `node` (bounded depth). */
function deepFind(node: unknown, key: string, out: any[] = [], depth = 0): any[] {
  if (!node || depth > 30) return out;
  if (Array.isArray(node)) {
    for (const child of node) deepFind(child, key, out, depth + 1);
  } else if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record[key] !== undefined) out.push(record[key]);
    for (const value of Object.values(record)) deepFind(value, key, out, depth + 1);
  }
  return out;
}

/** The first non-YouTube http(s) link in the text (a linked recipe page). */
function firstOutboundLink(description?: string): string | undefined {
  const urls = description?.match(/https?:\/\/[^\s)]+/g) ?? [];
  return urls.find((url) => !/youtube\.com|youtu\.be/.test(url));
}
