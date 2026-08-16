import { str } from './apify-fetcher.js';
import type { ExtractedRecipe } from '../parse/website.js';

/**
 * Pinterest fetch (Tier 0/1, no creds): Pinterest isn't locked down like IG/TikTok,
 * so its own public pidgets pin-info endpoint returns everything — description, the
 * outbound recipe link, a video's HLS URL, and structured recipe metadata — in
 * ~150ms. Resolve the pin id from a `pin.it` short link or a `/pin/{id}` URL first.
 */

const PIDGETS = 'https://widgets.pinterest.com/v3/pidgets/pins/info/';
const PIN_ID_RE = /\/pin\/(\d+)/;
const PIN_TIMEOUT_MS = 8000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
/** Pinterest's video CDN wants a browser UA; ffmpeg sends these to read the HLS. */
export const PIN_VIDEO_HEADERS: Record<string, string> = { 'User-Agent': UA };

/** A parsed pin: whatever the recipe can be built from, best-effort. */
export interface PinterestPin {
  description?: string;
  /** Outbound link (usually a recipe blog) — followed for a full JSON-LD recipe. */
  link?: string;
  /** Structured recipe from Pinterest's rich metadata (ingredients; often no steps). */
  recipe?: ExtractedRecipe;
  videoUrl?: string;
  videoHeaders?: Record<string, string>;
  thumbnailUrl?: string;
}

export class PinterestFetcher {
  /** @returns A live fetcher (pidgets is public, no key). */
  static create(): PinterestFetcher {
    return new PinterestFetcher();
  }

  /**
   * Fetch and parse a pin.
   * @param url - A `pin.it` short link or a `pinterest.com/pin/{id}` URL.
   * @returns The parsed pin.
   * @throws Error - When the id can't be resolved or pidgets returns non-2xx.
   */
  async fetchPin(url: string): Promise<PinterestPin> {
    const id = await resolvePinId(url);
    const res = await fetch(`${PIDGETS}?pin_ids=${id}`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Pinterest pidgets — HTTP ${res.status}`);
    const pin = ((await res.json()) as { data?: RawPin[] }).data?.[0];
    if (!pin) throw new Error(`Pinterest pin ${id} not found`);

    const videoUrl = pinVideoUrl(pin);
    return {
      description: str(pin.description),
      link: str(pin.link),
      recipe: mapRichRecipe(pin.rich_metadata?.recipe),
      videoUrl,
      videoHeaders: videoUrl ? PIN_VIDEO_HEADERS : undefined,
      thumbnailUrl: bestImage(pin.images),
    };
  }
}

/** The pidgets fields we read. */
interface RawPin {
  description?: string;
  link?: string;
  images?: Record<string, { url?: string }>;
  videos?: { video_list?: VideoList };
  story_pin_data?: { pages?: Array<{ blocks?: Array<{ video?: { video_list?: VideoList } }> }> };
  rich_metadata?: { recipe?: RawRecipe };
}
type VideoList = Record<string, { url?: string }>;
interface RawRecipe {
  name?: string;
  categorized_ingredients?: Array<{ ingredients?: Array<{ amt?: string; name?: string }> }>;
  instructions?: string[];
  steps?: Array<{ text?: string } | string>;
}

/** Resolve a pin URL to its numeric id — directly from a `/pin/{id}` URL, else
 * by following a short link's redirect. */
async function resolvePinId(url: string): Promise<string> {
  const direct = url.match(PIN_ID_RE);
  if (direct) return direct[1];
  const res = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(PIN_TIMEOUT_MS),
  });
  const resolved = res.url.match(PIN_ID_RE);
  if (!resolved) throw new Error(`Cannot resolve Pinterest id from ${url}`);
  return resolved[1];
}

/** A video's HLS URL, from a plain video pin or a story/idea pin's video block. */
function pinVideoUrl(pin: RawPin): string | undefined {
  const fromList = (list?: VideoList): string | undefined => {
    if (!list) return undefined;
    for (const key of ['V_HLSV4', 'V_HLSV3_MOBILE', 'V_720P', 'V_EXP7']) {
      if (list[key]?.url) return list[key].url;
    }
    return Object.values(list).find((v) => v?.url)?.url;
  };
  const block = pin.story_pin_data?.pages?.[0]?.blocks?.find((b) => b.video?.video_list);
  return fromList(pin.videos?.video_list) ?? fromList(block?.video?.video_list);
}

/** Map Pinterest's structured recipe metadata onto an ExtractedRecipe (ingredients
 * are always present; steps often aren't — those live on the outbound link). */
function mapRichRecipe(recipe?: RawRecipe): ExtractedRecipe | undefined {
  if (!recipe?.name) return undefined;
  const ingredients = (recipe.categorized_ingredients ?? []).flatMap((category) =>
    (category.ingredients ?? [])
      .map((ingredient) => [ingredient.amt, ingredient.name].filter(Boolean).join(' ').trim())
      .filter((line) => line.length > 0),
  );
  if (ingredients.length === 0) return undefined;
  const steps = (recipe.steps ?? [])
    .map((step) => (typeof step === 'string' ? step : (step.text ?? '')))
    .filter((text) => text.length > 0);
  return { title: recipe.name, ingredients, steps: steps.length > 0 ? steps : (recipe.instructions ?? []) };
}

/** The largest available pin image. */
function bestImage(images?: Record<string, { url?: string }>): string | undefined {
  if (!images) return undefined;
  const preferred = ['orig', '736x', '564x', '474x', '237x', '236x'];
  for (const key of preferred) if (images[key]?.url) return images[key].url;
  return Object.values(images).find((image) => image?.url)?.url;
}
