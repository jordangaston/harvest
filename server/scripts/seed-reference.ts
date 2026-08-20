import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createClient } from '@libsql/client';
import { makeDb, type Database } from '../src/db.js';
import { toFdcFoodRow, insertFdcFoods } from './build-fdc-catalog.js';
import { parsePpNap, foodCodeToFdcId } from './build-ingredient-prices.js';
import { toPriceRows, insertPrices } from '../src/price/price-catalog.js';
import { seedAllergenCatalog } from '../src/allergen/allergen-catalog.js';

/**
 * One reusable command to seed every ranking-engine SIGNAL reference table the
 * enrichers read — FNDDS foods + nutrient panels (nutrition/NRF), USDA prices
 * (cost), and allergens — in dependency order against the DB in `TURSO_DATABASE_URL`.
 *
 * Idempotent (each insert is `ON CONFLICT DO NOTHING`), so re-runs are no-ops.
 * Sources default to `~/Desktop/Business/Harvest/…`; override with `FNDDS_JSON` /
 * `PP_NAP_CSV`. A missing source is skipped with a warning (prices need a CSV that
 * isn't shipped) so the rest still seeds. `TURSO_DATABASE_URL` is required — point it
 * at the `turso dev` URL for local, or the Turso DB for a real seed.
 */

const HARVEST = join(homedir(), 'Desktop/Business/Harvest');
const FNDDS_JSON = process.env.FNDDS_JSON ?? join(HARVEST, 'FoodData_Central_survey_food_json_2024-10-31.json');
// PP-NAP is published as an .xlsx (USDA ERS Purchase to Plate):
//   https://ers.usda.gov/sites/default/files/_laserfiche/DataFiles/105537/pp_national_average_prices.xlsx
// Export its most recent sheet (PP-NAP1718) to CSV with `food_code,price_100gm,method`.
const PP_NAP_CSV = process.env.PP_NAP_CSV ?? join(HARVEST, 'pp_national_average_prices.csv');

// The reused parse helpers each read their own subset of a raw Survey food, so the
// orchestrator parses the JSON once and hands the raw records to both.
type RawSurveyFood = Parameters<typeof toFdcFoodRow>[0] & Parameters<typeof foodCodeToFdcId>[0][number];

/** Foods + nutrient panels — must run first; prices and allergens FK to `fdc_foods`. */
async function seedFoods(db: Database, survey: RawSurveyFood[]): Promise<void> {
  const foods = survey.filter((f) => f?.fdcId && f.description).map(toFdcFoodRow);
  await insertFdcFoods(db, foods);
  console.log(`✓ foods    → ${foods.length} FNDDS foods (fdc_foods + fdc_food_nutrient)`);
}

/** Cost signal — needs the PP-NAP CSV joined to FNDDS by food_code. Skips if the CSV is absent. */
async function seedPrices(db: Database, survey: RawSurveyFood[]): Promise<void> {
  if (!existsSync(PP_NAP_CSV)) {
    console.log(`— prices   → skipped (no PP-NAP CSV at ${PP_NAP_CSV}; set PP_NAP_CSV to seed cost)`);
    return;
  }
  const { rows, skipped } = toPriceRows(parsePpNap(readFileSync(PP_NAP_CSV, 'utf8')), foodCodeToFdcId(survey));
  await insertPrices(db, rows);
  console.log(`✓ prices   → ${rows.length} price rows (fdc_food_price; ${skipped} codes unmatched)`);
}

/** Allergen signal — derived from the already-seeded foods + the curated catalog config. */
async function seedAllergens(db: Database): Promise<void> {
  const n = await seedAllergenCatalog(db);
  console.log(`✓ allergens → ${n} allergen rows (fdc_food_allergen)`);
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL is required (e.g. the `turso dev` URL, or the Turso DB).');
    process.exit(1);
  }
  if (!existsSync(FNDDS_JSON)) {
    console.error(`FNDDS source not found at ${FNDDS_JSON}. Set FNDDS_JSON to the FoodData Central Survey JSON.`);
    process.exit(1);
  }

  const db = makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  const survey = (JSON.parse(readFileSync(FNDDS_JSON, 'utf8')) as { SurveyFoods: RawSurveyFood[] }).SurveyFoods;

  console.log(`Seeding ranking signals from ${FNDDS_JSON}\n`);
  await seedFoods(db, survey);
  await seedPrices(db, survey);
  await seedAllergens(db);
  console.log('\nDone.');
}

await main();
