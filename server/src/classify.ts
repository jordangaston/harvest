import type { SourceType } from './schema.js';

/** A submitted import source, classified into its platform + stored reference. */
export interface ClassifiedSource {
  sourceType: SourceType;
  ref: string;
}

/** The submitted source as the API receives it: a link, a share-sheet payload, or a photo. */
export interface SourceInput {
  url?: string;
  share_payload?: { url?: string; text?: string };
  image_ref?: string;
}

/**
 * The single entry the intake uses: classify a submitted source (a link or an
 * uploaded photo) into its platform + the reference we store, or `null` when it
 * isn't an importable recipe source. Keeps the link/photo branch here rather
 * than in the route.
 */
export function classifySource(input: SourceInput): ClassifiedSource | null {
  if (input.image_ref) return { sourceType: 'photo', ref: input.image_ref };
  const url = input.url ?? extractUrl(input.share_payload);
  const platform = detectSource(url);
  return platform && url ? { sourceType: platform, ref: normalizeUrl(url) } : null;
}

/**
 * Classifies a URL's source — the platform it's from (O-01). Pure and network-
 * free: short links are host-mapped without following the redirect. Returns the
 * platform enum for a supported social post or a plain web page, or `null` for
 * anything we can't import (a profile link, junk text, a non-http URL). The API
 * turns `null` into a 422 before any row is written; `null` is never persisted.
 *
 * @param rawUrl A pasted/shared URL, or undefined.
 * @returns The platform, or null when the URL isn't an importable recipe source.
 */
export function detectSource(rawUrl: string | undefined): SourceType | null {
  const url = rawUrl ? parseHttpUrl(rawUrl) : undefined;
  if (!url) return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const matched = HOST_PLATFORMS.find((h) => host === h.host || host.endsWith(`.${h.host}`));
  // A well-formed http(s) URL on an unknown host is treated as a recipe website.
  if (!matched) return 'website';
  return isPost(matched, url) ? matched.platform : null;
}

/** Pulls a URL out of a share-sheet payload's `url` field or free `text`. */
export function extractUrl(payload: { url?: string; text?: string } | undefined): string | undefined {
  if (!payload) return undefined;
  if (payload.url?.trim()) return payload.url.trim();
  const match = payload.text?.match(/https?:\/\/\S+/);
  return match ? match[0] : undefined;
}

/** Strips tracking params and the fragment, yielding a stable canonical URL. */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hash = '';
  url.hostname = url.hostname.replace(/^www\./, '');
  return url.toString().replace(/\?$/, '');
}

/** Tracking/query params stripped during URL normalization (AC-1). */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'igshid',
  'igsh',
  'fbclid',
  'gclid',
  'si',
  'ref',
  'ref_src',
  'ref_url',
  '_r',
  '_t',
  'is_from_webapp',
  'sender_device',
  'web_id',
  'source',
]);

/**
 * Host → platform map. A host matches when it equals the key or ends with
 * `.` + key, so `www.tiktok.com` and `vt.tiktok.com` both resolve to `tiktok`.
 * `fb.watch`/`fb.com`/`pin.it` are short-link hosts, mapped to their platform
 * without following the redirect (real expansion is deferred to WI-04).
 */
const HOST_PLATFORMS: Array<{ host: string; platform: SourceType; shortLink?: boolean }> = [
  { host: 'tiktok.com', platform: 'tiktok' },
  { host: 'instagram.com', platform: 'instagram' },
  { host: 'facebook.com', platform: 'facebook' },
  { host: 'fb.watch', platform: 'facebook', shortLink: true },
  { host: 'fb.com', platform: 'facebook', shortLink: true },
  { host: 'pinterest.com', platform: 'pinterest' },
  { host: 'pin.it', platform: 'pinterest', shortLink: true },
  { host: 'youtube.com', platform: 'youtube' },
  { host: 'youtu.be', platform: 'youtube', shortLink: true },
];

/** Path prefixes on a canonical platform host that carry a post (not a profile). */
const POST_PATH_PATTERNS: Partial<Record<SourceType, RegExp[]>> = {
  tiktok: [/\/@[^/]+\/(video|photo)\/\d+/, /^\/(v|t)\/[\w-]+/],
  instagram: [/^\/(p|reel|reels|tv)\/[\w-]+/],
  facebook: [/\/(videos|posts|reel|share|watch)\b/, /story_fbid=/, /^\/\d+$/],
  pinterest: [/^\/pin\/\d+/],
  youtube: [/^\/shorts\/[\w-]+/, /^\/live\/[\w-]+/, /^\/watch\b/, /[?&]v=[\w-]+/],
};

/**
 * Whether the URL is a post (vs. a profile/root). Short-link hosts count any
 * non-root path; canonical hosts require a known post path.
 *
 * @param matched - The host entry the URL resolved to
 * @param url - The parsed URL
 * @returns True when the URL points at an importable post.
 */
function isPost(matched: (typeof HOST_PLATFORMS)[number], url: URL): boolean {
  if (matched.shortLink) return url.pathname.replace(/\/+$/, '').length > 0;
  const patterns = POST_PATH_PATTERNS[matched.platform] ?? [];
  return patterns.some((re) => re.test(url.pathname + url.search));
}

/**
 * Parse `raw` as an http(s) URL.
 * @returns The URL, or undefined if malformed or not http(s).
 */
function parseHttpUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
