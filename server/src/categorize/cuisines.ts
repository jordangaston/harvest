import { CUISINES_DATA } from './cuisines-data.js';

/** One authored cuisine: a slug (stored on `recipe_categories.value`), a display label,
 * and an optional parent slug for parent-fallback ranking. */
export interface CuisineNode {
  slug: string;
  label: string;
  parent_slug: string | null;
}

/**
 * The authored cuisine hierarchy — the SINGLE source of truth (`cuisines-data.ts`)
 * that drives both `VOCAB.cuisine` (the classifier's allowed set) and the seeded
 * `cuisines` table (`seed:cuisines`). Two-level parent→child tree; a sparse leaf falls
 * back to its parent for affinity (see `parentCuisine`). Authored as a TS module rather
 * than a JSON import so it survives the WDK per-step bundler (a `with { type: 'json' }`
 * import is externalized by rolldown and then rejected by Node's import-attributes loader).
 */
export const CUISINES: CuisineNode[] = CUISINES_DATA;

/** Every cuisine slug — the expanded `VOCAB.cuisine` allow-list. */
export const CUISINE_SLUGS: string[] = CUISINES.map((c) => c.slug);

/** slug → display label (e.g. `tex_mex` → `Tex-Mex`), for the taste-options catalog. */
export const CUISINE_LABEL: Record<string, string> = Object.fromEntries(CUISINES.map((c) => [c.slug, c.label]));

/** slug → parent slug (null for a top-level cuisine), for parent-fallback ranking. */
export const CUISINE_PARENT: Record<string, string | null> = Object.fromEntries(
  CUISINES.map((c) => [c.slug, c.parent_slug]),
);

/** The parent cuisine of a slug, or null when it is top-level / unknown. */
export function parentCuisine(slug: string): string | null {
  return CUISINE_PARENT[slug] ?? null;
}
