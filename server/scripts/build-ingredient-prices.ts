import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { toPriceRows, insertPrices, type PpNapRow } from '../src/price/price-catalog.js';

/**
 * Seeds `fdc_food_price` from USDA ERS Purchase to Plate National Average Prices
 * (PP-NAP) + the FNDDS Survey JSON (offline, run once against the target Turso DB
 * *after* `build-fdc-catalog.ts`). Idempotent (`ON CONFLICT DO NOTHING`).
 *
 * PP-NAP is keyed by `food_code`; `fdc_food_price` is keyed by `fdc_id`. So this
 * reads BOTH the PP-NAP CSV (`PP_NAP_CSV`) AND the same FNDDS Survey JSON the
 * catalog seed uses (`FNDDS_JSON`) — the Survey JSON carries both `fdcId` and
 * `foodCode` per food — builds a `foodCode → fdcId` map, and joins. Unmatched
 * codes are skipped and counted.
 *
 * [ASSUMPTION: `foodCode` is present on FDC Survey foods] — Q-01. Not verified
 * against the real 66MB JSON (file not present at build). If absent, fall back to
 * the FNDDS "At A Glance" ingredient files or the FDC API to build the
 * `fdc_id ↔ food_code` map. Operator must confirm before the real seed run.
 */

/** Shape of one FNDDS Survey food (only the two fields the join needs). */
interface SurveyFood {
  fdcId: number;
  foodCode?: string | number;
}

const FNDDS_SOURCE =
  process.env.FNDDS_JSON ??
  join(homedir(), 'Desktop/Business/Harvest/FoodData_Central_survey_food_json_2024-10-31.json');

const PP_NAP_SOURCE =
  process.env.PP_NAP_CSV ??
  join(homedir(), 'Desktop/Business/Harvest/pp_national_average_prices.csv');

/** Builds the `food_code → fdc_id` map from the FNDDS Survey foods. */
export function foodCodeToFdcId(foods: SurveyFood[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of foods) {
    if (f.fdcId != null && f.foodCode != null) map.set(String(f.foodCode), f.fdcId);
  }
  return map;
}

/**
 * Parses the PP-NAP CSV into rows. Assumes a header row with `food_code`,
 * `price_100gm`, and (optional) `method` columns. A minimal RFC-4180-ish split —
 * PP-NAP has no embedded commas/quotes in these columns.
 */
export function parsePpNap(csv: string): PpNapRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const foodCodeIdx = header.indexOf('food_code');
  const priceIdx = header.indexOf('price_100gm');
  const methodIdx = header.indexOf('method');
  if (foodCodeIdx < 0 || priceIdx < 0) {
    throw new Error(`PP-NAP CSV missing food_code/price_100gm columns; got: ${header.join(', ')}`);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return {
      foodCode: cols[foodCodeIdx].trim(),
      price100gm: cols[priceIdx].trim(),
      method: methodIdx >= 0 ? cols[methodIdx].trim() : undefined,
    };
  });
}

async function main(): Promise<void> {
  const surveyFoods = (JSON.parse(readFileSync(FNDDS_SOURCE, 'utf8')) as { SurveyFoods: SurveyFood[] }).SurveyFoods;
  const ppNapRows = parsePpNap(readFileSync(PP_NAP_SOURCE, 'utf8'));

  const { rows, skipped } = toPriceRows(ppNapRows, foodCodeToFdcId(surveyFoods));

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  await insertPrices(makeDb(client), rows);
  process.stdout.write(`seeded ${rows.length} price rows → fdc_food_price (${skipped} PP-NAP codes had no FNDDS match)\n`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) await main();
