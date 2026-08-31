import { GROCERY_STORES, MAJOR_ALLERGENS, EQUIPMENT_TYPES } from '../../schema.js';
import { DIET_RULES } from '../../diet/diet-rules.js';

/** A grounded catalog candidate: the canonical id and a display label. */
export interface Candidate {
  value: string;
  label: string;
}

/** slug → display label (`pressure_cooker` → `Pressure Cooker`). */
export function labelFor(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A few common phrasings the model emits that don't slug straight onto a catalog id
 * (an id its label/prefix score wouldn't reach). Everything else is matched
 * generically. Keys are the raw-input slug (lowercased, non-alphanumerics → `_`).
 */
const ALIASES: Record<string, string> = {
  shrimp: 'crustacean_shellfish',
  prawn: 'crustacean_shellfish',
  prawns: 'crustacean_shellfish',
  shellfish: 'crustacean_shellfish',
  crab: 'crustacean_shellfish',
  lobster: 'crustacean_shellfish',
  peanuts: 'peanut',
  dairy: 'milk',
  eggs: 'egg',
  gluten: 'wheat',
  soy: 'soybean',
  tree_nuts: 'tree_nut',
  nuts: 'tree_nut',
  veggie: 'vegetarian',
  veg: 'vegetarian',
};

/** The five catalog kinds `search_catalog` grounds against. */
export type CatalogKind = 'taste' | 'store' | 'equipment' | 'diet' | 'allergen';

/** The code-tuple catalogs (taste is DB-backed, handled by the tool). */
const CODE_CATALOG: Record<Exclude<CatalogKind, 'taste'>, readonly string[]> = {
  store: GROCERY_STORES,
  equipment: EQUIPMENT_TYPES,
  diet: DIET_RULES.map((r) => r.id),
  allergen: MAJOR_ALLERGENS,
};

/** The candidate list for a code-backed kind, ids with derived labels. */
export function codeCandidates(kind: Exclude<CatalogKind, 'taste'>): Candidate[] {
  return CODE_CATALOG[kind].map((value) => ({ value, label: labelFor(value) }));
}

/** Lowercase, collapse non-alphanumerics to single `_`, trim (a comparable slug). */
export function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * A 0–1 similarity of a raw input to a candidate id/label: 1 for an exact/alias hit,
 * else the max shared-prefix ratio across the id, its label, and their tokens. Enough
 * to rank `krog`→`kroger` and `veggie`→`vegetarian` first without a fuzzy-match dep.
 */
function score(inputSlug: string, cand: Candidate): number {
  const id = cand.value;
  if (inputSlug === id || ALIASES[inputSlug] === id) return 1;
  const labelSlug = slugify(cand.label);
  const targets = [id, labelSlug, ...id.split('_'), ...labelSlug.split('_')];
  let best = 0;
  for (const t of targets) {
    if (!t) continue;
    if (t === inputSlug || t.startsWith(inputSlug) || inputSlug.startsWith(t)) {
      const n = Math.min(t.length, inputSlug.length);
      best = Math.max(best, n / Math.max(t.length, inputSlug.length));
    }
  }
  return best;
}

/** Candidates ranked by descending score to `query` (empty query → full catalog, input order). */
export function rank(query: string, candidates: Candidate[]): Candidate[] {
  const slug = slugify(query);
  if (!slug) return candidates;
  return candidates
    .map((c) => ({ c, s: score(slug, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/**
 * Coerces one raw value to a catalog id, enum-or-nothing: returns the matched id, or the
 * nearest ids as `closest` when nothing matches strongly enough (score `1` = exact/alias,
 * `≥ MATCH_FLOOR` = accepted, below = rejected).
 */
export function coerce(raw: string, candidates: Candidate[]): { value?: string; closest: string[] } {
  const slug = slugify(raw);
  const scored = candidates
    .map((c) => ({ value: c.value, s: score(slug, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (scored.length && scored[0].s >= MATCH_FLOOR) return { value: scored[0].value, closest: [] };
  return { closest: scored.slice(0, 3).map((x) => x.value) };
}

// ponytail: prefix-overlap floor tuned so `kroger`/`veggie` accept and
// `piggly wiggly's little cousin` (prefix-matches `piggly_wiggly`) rejects with it as closest.
const MATCH_FLOOR = 0.6;

/** Parses a fuzzy money phrase (`"$150ish"`, `"150"`, `"$1,500"`) to whole cents, or null. */
export function parseBudgetCents(raw: string | number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  const dollars = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}
