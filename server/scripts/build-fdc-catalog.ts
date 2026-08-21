import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createClient } from '@libsql/client';
import { makeDb, type Database } from '../src/db.js';
import { fdcFoods, fdcFoodNutrient, type FdcPortion } from '../src/schema.js';
import { normalize } from '../src/nutrition/normalize.js';

/**
 * Seeds the FNDDS (Survey) catalog into `fdc_foods` + `fdc_food_nutrient` (offline,
 * run once against the target Turso DB). The 66MB source JSON is NOT committed; point
 * `FNDDS_JSON` at it. Idempotent (`ON CONFLICT DO NOTHING`), so re-runs are no-ops.
 */

/** A catalog-ready food: the two rows-worth of data extracted from one Survey food. */
export interface FdcFoodRow {
  fdcId: number;
  description: string;
  descriptionNormalized: string;
  category: string | null;
  // FNDDS hierarchical keys (taste overhaul): the 8-digit food code drives base-ingredient
  // clustering; the WWEIA category code sections it. Null when the source omits them.
  foodCode: number | null;
  wweiaCategoryCode: number | null;
  portions: FdcPortion[];
  nutrients: { number: string; amount: number }[];
}

/** Shape of one food in the FNDDS `SurveyFoods` array (only the fields we read). */
interface SurveyFood {
  fdcId: number;
  description: string;
  foodCode?: number | string;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string; wweiaFoodCategoryCode?: number };
  foodPortions?: { portionDescription?: string; gramWeight?: number }[];
  foodNutrients?: { amount?: number; nutrient?: { number?: string } }[];
}

/** Coerces a foodCode (string or number in the source) to an int, or null. */
function toInt(value: number | string | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

const SOURCE =
  process.env.FNDDS_JSON ??
  join(homedir(), 'Desktop/Business/Harvest/FoodData_Central_survey_food_json_2024-10-31.json');

/** Turns one raw Survey food into the catalog row shape (the seed's single mapping). */
export function toFdcFoodRow(food: SurveyFood): FdcFoodRow {
  return {
    fdcId: food.fdcId,
    description: food.description,
    descriptionNormalized: normalize(food.description).join(' '),
    category: food.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? null,
    foodCode: toInt(food.foodCode),
    wweiaCategoryCode: food.wweiaFoodCategory?.wweiaFoodCategoryCode ?? null,
    portions: (food.foodPortions ?? [])
      .filter((p) => p.gramWeight != null)
      .map((p) => ({ description: p.portionDescription ?? '', gramWeight: p.gramWeight! })),
    nutrients: (food.foodNutrients ?? [])
      .filter((n) => n.nutrient?.number != null && n.amount != null)
      .map((n) => ({ number: n.nutrient!.number!, amount: n.amount! })),
  };
}

/** Inserts foods + their nutrient panels idempotently, in batches. Injectable `db`. */
export async function insertFdcFoods(db: Database, foods: FdcFoodRow[]): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < foods.length; i += BATCH) {
    const chunk = foods.slice(i, i + BATCH);
    await db
      .insert(fdcFoods)
      .values(
        chunk.map((f) => ({
          fdcId: f.fdcId,
          description: f.description,
          descriptionNormalized: f.descriptionNormalized,
          category: f.category,
          foodCode: f.foodCode,
          wweiaCategoryCode: f.wweiaCategoryCode,
          portions: f.portions,
        })),
      )
      .onConflictDoNothing();

    const nutrientRows = chunk.flatMap((f) =>
      f.nutrients.map((n) => ({ fdcId: f.fdcId, nutrientNumber: n.number, amountPer100g: String(n.amount) })),
    );
    for (let j = 0; j < nutrientRows.length; j += BATCH) {
      await db
        .insert(fdcFoodNutrient)
        .values(nutrientRows.slice(j, j + BATCH))
        .onConflictDoNothing();
    }
  }
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as { SurveyFoods: SurveyFood[] };
  const foods = raw.SurveyFoods.filter((f) => f?.fdcId && f.description).map(toFdcFoodRow);

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  await insertFdcFoods(makeDb(client), foods);
  process.stdout.write(`seeded ${foods.length} FNDDS foods → fdc_foods / fdc_food_nutrient\n`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) await main();
