import type { Database } from '../db.js';
import { fdcFoods, fdcFoodAllergen } from '../schema.js';
import { normalize } from '../nutrition/normalize.js';
import { mergePresence, type Allergen, type AllergenPresence } from './allergen.js';

/**
 * The allergen-catalog config + pure mapping. `toAllergenRows` annotates one FDC food
 * with its major allergens; `seedAllergenCatalog` runs it over every `fdc_foods` row and
 * batch-inserts into `fdc_food_allergen` (offline seed, mirrors `build-fdc-catalog.ts`).
 * Correctness of this config is the safety surface tracked by design Q-01.
 */

type AllergenRule = { allergen: Allergen; presence: AllergenPresence };

/**
 * FDC WWEIA `wweiaFoodCategoryDescription` → the allergen(s) a food in that category carries.
 * The blunt first pass, refined per-food by the species scans and overrides below.
 *
 * [ASSUMPTION: WWEIA category names — verify against seeded catalog] (design Q-01 QA surface):
 * these keys are the real WWEIA category descriptions to my best knowledge; spot-check them
 * against the seeded `fdc_foods.category` values and add/rename keys as coverage gaps surface.
 */
export const ALLERGEN_BY_CATEGORY: Record<string, AllergenRule[]> = {
  'Milk, whole': [{ allergen: 'milk', presence: 'contains' }],
  'Milk, reduced fat': [{ allergen: 'milk', presence: 'contains' }],
  'Milk, lowfat': [{ allergen: 'milk', presence: 'contains' }],
  'Milk, nonfat': [{ allergen: 'milk', presence: 'contains' }],
  Milk: [{ allergen: 'milk', presence: 'contains' }],
  Cheese: [{ allergen: 'milk', presence: 'contains' }],
  Yogurt: [{ allergen: 'milk', presence: 'contains' }],
  'Ice cream and frozen dairy desserts': [{ allergen: 'milk', presence: 'contains' }],
  Butter: [{ allergen: 'milk', presence: 'contains' }],
  'Eggs and omelets': [{ allergen: 'egg', presence: 'contains' }],
  Eggs: [{ allergen: 'egg', presence: 'contains' }],
  Fish: [{ allergen: 'fish', presence: 'contains' }],
  Shellfish: [{ allergen: 'crustacean_shellfish', presence: 'contains' }],
  'Nuts and seeds': [{ allergen: 'tree_nut', presence: 'may_contain' }],
  'Peanut butter': [{ allergen: 'peanut', presence: 'contains' }],
  'Peanuts': [{ allergen: 'peanut', presence: 'contains' }],
  'Yeast breads': [
    { allergen: 'wheat', presence: 'contains' },
    { allergen: 'milk', presence: 'may_contain' },
    { allergen: 'egg', presence: 'may_contain' },
  ],
  'Soy-based condiments': [
    { allergen: 'soybean', presence: 'contains' },
    { allergen: 'wheat', presence: 'may_contain' },
  ],
};

/** Normalizes a term into its content tokens (the same chokepoint the catalog was built with). */
const terms = (raw: string[]): string[][] => raw.map((t) => normalize(t));

/**
 * The exact 12 tree-nut species from the design taxonomy (some spelled several ways).
 * Scanned against `description_normalized` to refine a coarse "Nuts and seeds" row into a
 * `tree_nut` row carrying `species`.
 */
export const TREE_NUT_SPECIES = terms([
  'almond',
  'black walnut',
  'brazil nut',
  'california walnut',
  'cashew',
  'filbert',
  'hazelnut',
  'heartnut',
  'japanese walnut',
  'macadamia',
  'bush nut',
  'pecan',
  'pine nut',
  'pinon nut',
  'pistachio',
  'walnut',
]);

/** Fish common names scanned against `description_normalized` to confirm/add a `fish` row. */
export const FISH_TERMS = terms([
  'anchovy',
  'bass',
  'catfish',
  'cod',
  'flounder',
  'haddock',
  'halibut',
  'herring',
  'mackerel',
  'pollock',
  'salmon',
  'sardine',
  'snapper',
  'sole',
  'tilapia',
  'trout',
  'tuna',
]);

/** Crustacean common names → a `crustacean_shellfish` row. */
export const CRUSTACEAN_TERMS = terms(['crab', 'crawfish', 'crayfish', 'lobster', 'prawn', 'shrimp']);

/** Sesame terms → a `sesame` row (sesame has no dedicated WWEIA category, so the scan carries it). */
export const SESAME_TERMS = terms(['sesame', 'tahini']);

/** Peanut terms → a `peanut` row, catching peanut outside the peanut-specific categories. */
export const PEANUT_TERMS = terms(['peanut', 'groundnut']);

/**
 * Hand-curated per-`fdc_id` fixes, applied LAST (they win): add a row a rule misses, or
 * remove one a rule gets wrong. This is the QA surface Q-01 tracks. Start minimal — grow it as
 * spot-checks against the seeded catalog surface mis-mappings.
 *
 * Example (an almond-milk fdc_id would map to `milk` by name, but it is a tree-nut beverage):
 *   167755: [
 *     { allergen: 'tree_nut', presence: 'contains', species: 'almond' },
 *     { allergen: 'milk', presence: 'contains', remove: true },
 *   ],
 */
export const ALLERGEN_OVERRIDES: Record<
  number,
  { allergen: Allergen; presence: AllergenPresence; species?: string; remove?: boolean }[]
> = {};

export interface AllergenRow {
  fdcId: number;
  allergen: Allergen;
  presence: AllergenPresence;
  species?: string;
}

/** True when `term` (token array) appears as a contiguous run inside `tokens`. */
function tokensContain(tokens: string[], term: string[]): boolean {
  if (term.length === 0) return false;
  for (let i = 0; i + term.length <= tokens.length; i++) {
    if (term.every((t, j) => tokens[i + j] === t)) return true;
  }
  return false;
}

/**
 * The tree-nut species matched in `tokens`, if any — the longest match wins, so
 * "black walnut" beats a bare "walnut". Returns the human species (space-joined tokens).
 */
function matchTreeNut(tokens: string[]): string | undefined {
  let best: string[] | undefined;
  for (const term of TREE_NUT_SPECIES) {
    if (tokensContain(tokens, term) && (!best || term.length > best.length)) best = term;
  }
  return best?.join(' ');
}

/**
 * Annotates one FDC food with its major allergens (pure; offline-testable).
 * @param food - `{ fdcId, category, descriptionNormalized }` from `fdc_foods`.
 * @returns one row per distinct allergen (stronger `presence` kept on collision); `[]` if none.
 */
export function toAllergenRows(food: {
  fdcId: number;
  category: string | null;
  descriptionNormalized: string;
}): AllergenRow[] {
  const byAllergen = new Map<Allergen, AllergenRow>();
  const add = (r: AllergenRow) => {
    const prev = byAllergen.get(r.allergen);
    byAllergen.set(r.allergen, {
      fdcId: food.fdcId,
      allergen: r.allergen,
      presence: prev ? mergePresence(prev.presence, r.presence) : r.presence,
      species: r.species ?? prev?.species,
    });
  };

  for (const rule of ALLERGEN_BY_CATEGORY[food.category ?? ''] ?? []) add({ fdcId: food.fdcId, ...rule });

  const tokens = food.descriptionNormalized.split(' ').filter(Boolean);
  const species = matchTreeNut(tokens);
  if (species) add({ fdcId: food.fdcId, allergen: 'tree_nut', presence: 'contains', species });
  if (FISH_TERMS.some((t) => tokensContain(tokens, t))) add({ fdcId: food.fdcId, allergen: 'fish', presence: 'contains' });
  if (CRUSTACEAN_TERMS.some((t) => tokensContain(tokens, t)))
    add({ fdcId: food.fdcId, allergen: 'crustacean_shellfish', presence: 'contains' });
  if (SESAME_TERMS.some((t) => tokensContain(tokens, t))) add({ fdcId: food.fdcId, allergen: 'sesame', presence: 'contains' });
  if (PEANUT_TERMS.some((t) => tokensContain(tokens, t))) add({ fdcId: food.fdcId, allergen: 'peanut', presence: 'contains' });

  for (const o of ALLERGEN_OVERRIDES[food.fdcId] ?? []) {
    if (o.remove) byAllergen.delete(o.allergen);
    else add({ fdcId: food.fdcId, allergen: o.allergen, presence: o.presence, species: o.species });
  }

  return [...byAllergen.values()];
}

/**
 * Reads every `fdc_foods` row, maps it via `toAllergenRows`, and batch-inserts the resulting
 * allergen rows into `fdc_food_allergen` (batches of 500, `.onConflictDoNothing()` → idempotent).
 * @param db - a Drizzle db (test file: url or Turso).
 * @returns the number of allergen rows inserted/attempted.
 */
export async function seedAllergenCatalog(db: Database): Promise<number> {
  const foods = await db
    .select({
      fdcId: fdcFoods.fdcId,
      category: fdcFoods.category,
      descriptionNormalized: fdcFoods.descriptionNormalized,
    })
    .from(fdcFoods);

  const rows = foods.flatMap(toAllergenRows);
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(fdcFoodAllergen)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoNothing();
  }
  return rows.length;
}
