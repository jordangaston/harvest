/**
 * Website recipe extractor (Tier 0, no creds): pull a recipe's structured data
 * from a page's schema.org JSON-LD. Adapted from `heb-bot/src/recipe.ts`, kept
 * dependency-free and deterministic so the extractor is unit-testable offline.
 *
 * Why JSON-LD (no LLM, no DOM walking): virtually every recipe site embeds a
 * `<script type="application/ld+json">` `Recipe` object — it's what Google reads
 * for rich results, so sites keep it accurate. Reading it is exact and free. A
 * page with no `Recipe` block throws, distinctly.
 *
 * Two halves kept apart: `parseRecipeFromHtml` is a pure `string → ExtractedRecipe`
 * function (testable with a fixture, no network); `fetchWebsiteHtml` GETs the page
 * with a browser-ish User-Agent (some hosts 403 an unadorned client). WI-05 wires
 * them together and runs the LLM ingredient normalization.
 */

/** The `application/ld+json` block(s), pulled from the page for `Recipe` discovery. */
const LD_JSON_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** A browser-like UA; some recipe hosts 403 an unadorned fetch client. */
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * A recipe extracted from a page's JSON-LD. Only `title` and `ingredients` are
 * guaranteed (possibly empty); every other field appears when the source's
 * `Recipe` object carried it — we never invent a value. `ingredients` are the raw
 * `recipeIngredient` lines (entities decoded); structuring them is the LLM's job
 * in WI-05.
 */
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

/**
 * Fetch a recipe page's HTML with a browser User-Agent.
 *
 * @param url - The recipe page URL
 * @returns The page HTML
 * @throws If the response is non-2xx
 */
export async function fetchWebsiteHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': FETCH_USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Cannot fetch page — HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

/**
 * Extract an `ExtractedRecipe` from a page's HTML. Pure (no network, no LLM), so
 * it can be tested against a saved fixture. Scans every `application/ld+json`
 * block, walks each for a `Recipe` object (including inside a `@graph` or array),
 * and maps the first found.
 *
 * @param html - The full page HTML
 * @param sourceUrl - The page URL, used only in the not-found error message
 * @returns The extracted recipe
 * @throws If no block parses into a `Recipe` object
 */
export function parseRecipeFromHtml(html: string, sourceUrl = ''): ExtractedRecipe {
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

/**
 * Convert an ISO-8601 duration (e.g. `PT1H15M`) to whole minutes.
 *
 * @param iso - The ISO-8601 duration, or undefined
 * @returns Whole minutes, or undefined when absent/unparseable/zero
 */
export function isoDurationToMinutes(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!match) return undefined;
  const [, days, hours, minutes, seconds] = match.map((part) => (part ? parseInt(part, 10) : 0));
  const total = days * 1440 + hours * 60 + minutes + Math.round(seconds / 60);
  return total > 0 ? total : undefined;
}

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

/**
 * Flatten `recipeInstructions` to step texts. Steps come as strings, `HowToStep`
 * objects (a `text` field), or `HowToSection`s nesting an `itemListElement` array.
 */
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
  return steps;
}

/** First usable image URL from a `string | string[] | ImageObject` value. */
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

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [];
}

/** Named HTML entities common in recipe text; numeric entities are generic. */
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

function safeCodePoint(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}
