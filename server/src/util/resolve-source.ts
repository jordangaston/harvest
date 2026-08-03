import type { SourceType } from '../db/schema/enums.js';

/**
 * The classified platform of an import source (O-01). It is the DB `source_type`
 * enum plus `unsupported` — the terminal classification for input we can't
 * import (a profile link, junk text, an unknown host). `unsupported` is never
 * persisted; the API rejects it with a 422 before any row is written (AC-4).
 */
export type Platform = SourceType | 'unsupported';

/**
 * A resolved import source. `platform` is the discriminator: for a supported
 * source, `sourceType` is the persistable DB enum value and exactly one of
 * `normalizedUrl` (URL sources) or `imageRef` (a picked photo) is set; for
 * `unsupported`, `sourceType` is undefined and both refs are absent.
 */
export interface ResolvedSource {
  platform: Platform;
  sourceType?: SourceType;
  normalizedUrl?: string;
  imageRef?: string;
}

/**
 * The intake payload O-01 classifies: a pasted/shared URL, a share-sheet
 * payload (which may carry a URL in `url` or free `text`), or a picked photo's
 * object-storage ref. Exactly one field is meaningful per call; the API schema
 * enforces that.
 */
export interface SourceInput {
  url?: string;
  sharePayload?: { url?: string; text?: string };
  imageRef?: string;
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
 * `fb.watch`/`fb.com`/`pin.it` are short-link hosts, canonicalized to their
 * platform without following the redirect (real expansion is deferred to WI-04).
 */
const HOST_PLATFORMS: Array<{ host: string; platform: SourceType; shortLink?: boolean }> = [
  { host: 'tiktok.com', platform: 'tiktok' },
  { host: 'instagram.com', platform: 'instagram' },
  { host: 'facebook.com', platform: 'facebook' },
  { host: 'fb.watch', platform: 'facebook', shortLink: true },
  { host: 'fb.com', platform: 'facebook', shortLink: true },
  { host: 'pinterest.com', platform: 'pinterest' },
  { host: 'pin.it', platform: 'pinterest', shortLink: true },
];

/** Path prefixes on a canonical platform host that carry a post (not a profile). */
const POST_PATH_PATTERNS: Partial<Record<SourceType, RegExp[]>> = {
  tiktok: [/\/@[^/]+\/(video|photo)\/\d+/, /^\/(v|t)\/[\w-]+/],
  instagram: [/^\/(p|reel|reels|tv)\/[\w-]+/],
  facebook: [/\/(videos|posts|reel|share|watch)\b/, /story_fbid=/, /^\/\d+$/],
  pinterest: [/^\/pin\/\d+/],
};

/**
 * Resolves an import source into a platform + normalized reference (O-01). Pure:
 * no network — short links are host-mapped without following the redirect.
 * Classifies a picked photo as `photo`, a supported social post URL as its
 * platform, a plain web page as `website`, and everything else (junk text,
 * profile links, non-http URLs) as `unsupported`.
 *
 * @param input Exactly one of `url`, `sharePayload`, or `imageRef`.
 * @returns The resolved source; `platform === 'unsupported'` for unimportable input.
 */
export function resolveSource(input: SourceInput): ResolvedSource {
  const imageRef = input.imageRef?.trim();
  if (imageRef) return { platform: 'photo', sourceType: 'photo', imageRef };

  const raw = input.url ?? extractUrl(input.sharePayload);
  const url = raw ? parseHttpUrl(raw) : undefined;
  if (!url) return { platform: 'unsupported' };

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const matched = HOST_PLATFORMS.find((h) => host === h.host || host.endsWith(`.${h.host}`));
  if (!matched) {
    // A well-formed http(s) URL on an unknown host is a recipe website (the
    // website path follows the link and looks for JSON-LD in a later ticket).
    return { platform: 'website', sourceType: 'website', normalizedUrl: normalizeUrl(url) };
  }

  if (!isPost(matched, url)) return { platform: 'unsupported' };
  return { platform: matched.platform, sourceType: matched.platform, normalizedUrl: normalizeUrl(url) };
}

/** Short-link hosts point at a shared post for any non-root path; canonical
 * hosts require a known post path so a bare host or profile URL is unsupported. */
function isPost(matched: (typeof HOST_PLATFORMS)[number], url: URL): boolean {
  if (matched.shortLink) return url.pathname.replace(/\/+$/, '').length > 0;
  const patterns = POST_PATH_PATTERNS[matched.platform] ?? [];
  return patterns.some((re) => re.test(url.pathname + url.search));
}

/** Pulls a URL out of a share-sheet payload's `url` field or free `text`. */
function extractUrl(payload: SourceInput['sharePayload']): string | undefined {
  if (!payload) return undefined;
  if (payload.url?.trim()) return payload.url.trim();
  const match = payload.text?.match(/https?:\/\/\S+/);
  return match ? match[0] : undefined;
}

/** Parses a string as an http(s) URL, or undefined if it isn't one. */
function parseHttpUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Strips tracking params and the fragment, yielding a stable canonical URL. */
function normalizeUrl(url: URL): string {
  const clean = new URL(url.toString());
  for (const key of [...clean.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) clean.searchParams.delete(key);
  }
  clean.hash = '';
  clean.hostname = clean.hostname.replace(/^www\./, '');
  return clean.toString().replace(/\?$/, '');
}
