/**
 * Tier-0 website fetch: read a recipe's schema.org JSON-LD from the page — exact
 * and free (it's what Google reads for rich results), no LLM, no DOM walking.
 * Adapted from heb-bot; the `parse` half is pure so it unit-tests offline.
 */
import { env } from '../config/env.js';

/** A recipe extracted from a page's JSON-LD. `title`/`ingredients`/`steps` are
 * always present (possibly empty); the rest appear only when the source carried
 * them — we never invent a value. */
export interface ExtractedRecipe {
  title: string;
  ingredients: string[];
  steps: string[];
  servings?: string;
  totalMinutes?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  imageUrl?: string;
  rating?: { value: string; count?: string };
}

export class WebsiteFetcher {
  /** @returns A live fetcher. */
  static create(): WebsiteFetcher {
    return new WebsiteFetcher();
  }

  /**
   * Fetch a recipe page and extract its schema.org JSON-LD recipe.
   *
   * @param url - The recipe page URL
   * @returns The extracted recipe
   * @throws If the page is unreachable (non-2xx) or has no `Recipe` block
   */
  async fetch(url: string): Promise<ExtractedRecipe> {
    // Browser-ish UA — some recipe hosts 403 an unadorned fetch client.
    const response = await fetch(url, { headers: { 'user-agent': FETCH_USER_AGENT } });
    if (!response.ok) throw new Error(`Cannot fetch ${url} — HTTP ${response.status} ${response.statusText}`);
    return WebsiteFetcher.parse(await response.text(), url);
  }

  /**
   * Extract a recipe from page HTML — pure (no network), for tests and reuse.
   * Scans every `application/ld+json` block for a `Recipe` (incl. inside a
   * `@graph` or array) and maps the first found.
   *
   * @throws If no block parses into a `Recipe` object
   */
  static parse(html: string, sourceUrl = ''): ExtractedRecipe {
    for (const match of html.matchAll(LD_JSON_RE)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        continue;
      }
      const node = findRecipeNode(parsed);
      if (node) return mapRecipe(node);
    }
    throw new Error(`No schema.org Recipe found${sourceUrl ? ` on ${sourceUrl}` : ''}`);
  }
}

/** Dev/test double: a fixed recipe, no network. */
export class StubWebsiteFetcher {
  static readonly FIXTURE: ExtractedRecipe = {
    title: 'Creamy Garlic Chicken',
    ingredients: ['2 chicken breasts', '4 cloves garlic, minced', '1 cup heavy cream'],
    steps: ['Sear the chicken until golden.', 'Add garlic and cream.', 'Simmer until thickened.'],
    servings: '4',
    totalMinutes: 30,
  };

  /** @returns The fixed stub recipe (no network). */
  async fetch(_url: string): Promise<ExtractedRecipe> {
    return StubWebsiteFetcher.FIXTURE;
  }
}

/**
 * The stub under `NODE_ENV=test`, else the live fetcher.
 * @returns The fetcher for the current environment.
 */
// ponytail: NODE_ENV is the only offline signal for a credential-free fetch —
// there's no token to gate on, so tests run the stub and everything else is live.
export function selectWebsiteFetcher(): WebsiteFetcher | StubWebsiteFetcher {
  return env.NODE_ENV === 'test' ? new StubWebsiteFetcher() : WebsiteFetcher.create();
}

const LD_JSON_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** DFS for a `Recipe` node — handles a bare object, an array, and a `@graph`. */
function findRecipeNode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipeNode(child);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (hasType(record['@type'], 'Recipe')) return record;
    if ('@graph' in record) return findRecipeNode(record['@graph']);
  }
  return null;
}

/** Whether a JSON-LD `@type` (string or array) is, or includes, `wanted`. */
function hasType(type: unknown, wanted: string): boolean {
  if (type === wanted) return true;
  return Array.isArray(type) && type.includes(wanted);
}

/** Map a JSON-LD `Recipe` node onto `ExtractedRecipe`; optional fields are set only when present. */
function mapRecipe(node: Record<string, unknown>): ExtractedRecipe {
  const recipe: ExtractedRecipe = {
    title: decode(asString(node.name)),
    ingredients: asStringArray(node.recipeIngredient).map(decode),
    steps: mapInstructions(node.recipeInstructions),
  };

  const servings = decode(asString(firstOf(node.recipeYield)));
  if (servings) recipe.servings = servings;

  const totalMinutes = isoDurationToMinutes(asString(node.totalTime) || undefined);
  if (totalMinutes) recipe.totalMinutes = totalMinutes;
  const prepMinutes = isoDurationToMinutes(asString(node.prepTime) || undefined);
  if (prepMinutes) recipe.prepMinutes = prepMinutes;
  const cookMinutes = isoDurationToMinutes(asString(node.cookTime) || undefined);
  if (cookMinutes) recipe.cookMinutes = cookMinutes;

  const imageUrl = firstImageUrl(node.image);
  if (imageUrl) recipe.imageUrl = imageUrl;

  const rating = node.aggregateRating;
  if (rating && typeof rating === 'object') {
    const value = asString((rating as Record<string, unknown>).ratingValue);
    if (value) {
      recipe.rating = { value };
      const count = asString((rating as Record<string, unknown>).ratingCount);
      if (count) recipe.rating.count = count;
    }
  }

  return recipe;
}

/** Flatten `recipeInstructions` — strings, `HowToStep` objects, or `HowToSection`s
 * nesting an `itemListElement` array — to step texts. Some sites (e.g. WP Recipe
 * Maker themes) collapse the whole method into ONE `HowToStep` whose text is a
 * numbered blob ("1. … 2. … 3. …") — explode that into discrete ordered steps. */
function mapInstructions(raw: unknown): string[] {
  const steps: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'string') {
      const text = decode(value);
      if (text) steps.push(text);
      return;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.itemListElement)) {
        visit(record.itemListElement);
        return;
      }
      const text = decode(asString(record.text) || asString(record.name));
      if (text) steps.push(text);
    }
  };
  visit(raw);

  // A single collapsed blob → explode it. Multiple steps are already segmented,
  // but still split any one that embeds its own numbered list.
  if (steps.length === 1) return explodeStep(steps[0]);
  return steps.flatMap((step) => numberedSplit(step) ?? [step]);
}

/** Split a numbered blob ("1. A 2. B 3. C") into its steps, or null if it has
 * fewer than two numbered markers. `\d+\.\s` matches list markers only — not
 * "2 tablespoons" (no dot), "375° F" (no dot after the digit), or "1.5 cups".
 * Sources sometimes glue a marker to the previous sentence ("…crisp.7. Toss…"),
 * so first insert a space after a period that directly precedes a marker. */
function numberedSplit(text: string): string[] | null {
  const normalized = text.replace(/\.(?=\d+\.\s)/g, '. ');
  if ((normalized.match(/(?:^|\s)\d+\.\s/g) ?? []).length < 2) return null;
  return normalized
    .split(/\s+(?=\d+\.\s)/)
    .map((part) => part.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

/** Explode one collapsed method blob into ordered steps: numbered markers first,
 * else sentence boundaries when it's clearly multi-sentence; otherwise leave it. */
function explodeStep(text: string): string[] {
  const numbered = numberedSplit(text);
  if (numbered) return numbered;
  if (text.length > 200) {
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length >= 2) return sentences;
  }
  return [text];
}

/** Convert an ISO-8601 duration (`PT1H15M`) to whole minutes, or undefined. */
function isoDurationToMinutes(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!match) return undefined;
  const [, days, hours, minutes, seconds] = match.map((part) => (part ? parseInt(part, 10) : 0));
  const total = days * 1440 + hours * 60 + minutes + Math.round(seconds / 60);
  return total > 0 ? total : undefined;
}

/** First usable image URL from a `string | string[] | ImageObject`. */
function firstImageUrl(image: unknown): string | undefined {
  const first = firstOf(image);
  if (typeof first === 'string') return first || undefined;
  if (first && typeof first === 'object') {
    return asString((first as Record<string, unknown>).url) || undefined;
  }
  return undefined;
}

/** First element of an array, or the value itself — some fields are scalar-or-array. */
function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** A string/number coerced to a string, else `''`. */
function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/** A string (wrapped) or array's non-empty strings; anything else yields `[]`. */
function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  deg: '°',
  frac12: '½',
  frac13: '⅓',
  frac14: '¼',
  frac34: '¾',
};

/** Decode numeric + common named HTML entities and collapse whitespace. */
function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (whole, name) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The code point as a string, or `''` if it's out of the Unicode range. */
function safeCodePoint(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}
