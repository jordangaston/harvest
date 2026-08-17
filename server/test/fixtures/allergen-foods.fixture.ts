import type { Database } from '../../src/db.js';
import { fdcFoodAllergen } from '../../src/schema.js';
import { insertFdcFoods, toFdcFoodRow, type FdcFoodRow } from '../../scripts/build-fdc-catalog.js';
import type { Allergen, AllergenPresence } from '../../src/allergen/allergen.js';

/**
 * Allergen test data (WI-3). Two pieces:
 *  - `EXTRA_ALLERGEN_FOODS`: FDC foods the nutrition fixture lacks but the golden corpus
 *    needs (almond milk, soy sauce, cashews, peanut butter, coconut), so `FoodMatcher` can
 *    actually match them. Built through `toFdcFoodRow` (same normalization chokepoint).
 *  - `FIXTURE_ALLERGEN_ROWS` + `seedAllergens`: `fdc_food_allergen` annotations keyed to the
 *    real fixture fdcIds. Coconut is deliberately annotation-free (not a major allergen);
 *    almond milk maps to `tree_nut` (the classic trap), not `milk`; soy sauce → soybean+wheat.
 */

/** One `fdc_food_allergen` row a test seeds. */
export interface AllergenRow {
  fdcId: number;
  allergen: Allergen;
  presence: AllergenPresence;
  species?: string;
}

// --- Extra catalog foods the corpus needs (base fixture ids are 100001-100012) ---
// Multi-word descriptions are deliberate: the fixture's bare "Milk"/"Egg" foods normalize to a
// single short token, which `FoodMatcher` can only reach at `medium`/`low` — too weak for a clean
// `contains`. Buttermilk / scrambled eggs give a real `high` match to a milk/egg-bearing food.
const RAW_EXTRA: Array<{ fdcId: number; description: string; category: string }> = [
  { fdcId: 100013, description: 'Almond milk, unsweetened', category: 'Milk substitutes' },
  { fdcId: 100014, description: 'Soy sauce', category: 'Soy-based condiments' },
  { fdcId: 100015, description: 'Cashews, roasted', category: 'Nuts and seeds' },
  { fdcId: 100016, description: 'Peanut butter, smooth', category: 'Peanut butter' },
  { fdcId: 100017, description: 'Coconut, raw', category: 'Nuts and seeds' },
  { fdcId: 100018, description: 'Buttermilk, cultured', category: 'Milk' },
  { fdcId: 100019, description: 'Scrambled eggs', category: 'Eggs' },
];

/** Extra FDC foods (no nutrient panel needed — allergen detection only reads descriptions). */
export const EXTRA_ALLERGEN_FOODS: FdcFoodRow[] = RAW_EXTRA.map((f) =>
  toFdcFoodRow({ fdcId: f.fdcId, description: f.description, wweiaFoodCategory: { wweiaFoodCategoryDescription: f.category } }),
);

// Base-fixture fdcIds (from fdc-foods.fixture.ts).
const SALMON = 100002;
const EGG = 100006;
const BUTTER = 100007;
const FLOUR = 100008;
const MILK = 100010;
const CHEDDAR = 100012;
// Extra fdcIds.
const ALMOND_MILK = 100013;
const SOY_SAUCE = 100014;
const CASHEW = 100015;
const PEANUT_BUTTER = 100016;
// 100017 coconut: intentionally no rows — coconut is not a major allergen.
const BUTTERMILK = 100018;
const SCRAMBLED_EGGS = 100019;

/** Annotations for every allergen-carrying fixture food (matches the catalog rules by hand). */
export const FIXTURE_ALLERGEN_ROWS: AllergenRow[] = [
  { fdcId: MILK, allergen: 'milk', presence: 'contains' },
  { fdcId: BUTTER, allergen: 'milk', presence: 'contains' },
  { fdcId: CHEDDAR, allergen: 'milk', presence: 'contains' },
  { fdcId: EGG, allergen: 'egg', presence: 'contains' },
  { fdcId: SALMON, allergen: 'fish', presence: 'contains' },
  { fdcId: FLOUR, allergen: 'wheat', presence: 'contains' },
  { fdcId: ALMOND_MILK, allergen: 'tree_nut', presence: 'contains', species: 'almond' },
  { fdcId: CASHEW, allergen: 'tree_nut', presence: 'contains', species: 'cashew' },
  { fdcId: PEANUT_BUTTER, allergen: 'peanut', presence: 'contains' },
  { fdcId: SOY_SAUCE, allergen: 'soybean', presence: 'contains' },
  { fdcId: SOY_SAUCE, allergen: 'wheat', presence: 'contains' },
  { fdcId: BUTTERMILK, allergen: 'milk', presence: 'contains' },
  { fdcId: SCRAMBLED_EGGS, allergen: 'egg', presence: 'contains' },
];

/** Inserts the extra catalog foods; call after `seedFdcFixture`. */
export async function seedExtraAllergenFoods(db: Database): Promise<void> {
  await insertFdcFoods(db, EXTRA_ALLERGEN_FOODS);
}

/** Inserts `fdc_food_allergen` rows (mirror of `seedFdcFixture`). */
export async function seedAllergens(db: Database, rows: AllergenRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(fdcFoodAllergen)
    .values(rows.map((r) => ({ fdcId: r.fdcId, allergen: r.allergen, presence: r.presence, species: r.species ?? null })))
    .onConflictDoNothing();
}
