import type { Database } from '../db.js';
import { fdcFoodPrice } from '../schema.js';

/**
 * The price-catalog pure mapping + idempotent seed. Mirrors `allergen-catalog.ts`.
 * PP-NAP is keyed by 8-digit FNDDS `food_code`, but `fdc_food_price` is keyed by
 * `fdc_id` — so `toPriceRows` joins each PP-NAP row to an `fdc_id` via a
 * `foodCode → fdcId` Map the seed builds from the FNDDS Survey JSON. Rows whose
 * `food_code` has no seeded FNDDS food are skipped (never guessed).
 *
 * The RAW PP-NAP `price_100gm` is stored verbatim as `price_per_100g` (no CPI, no
 * cents rounding) — lowest-granularity storage, per design.
 */

const SOURCE_CYCLE = '2017-2018';

/** One row from the PP-NAP CSV (only the fields we read). */
export interface PpNapRow {
  foodCode: string;
  price100gm: string;
  method?: string;
}

/** A `fdc_food_price` row ready to insert. */
export interface PriceRow {
  fdcId: number;
  foodCode: string;
  pricePer100g: string;
  method: string | null;
  sourceCycle: string;
}

/** The result of the join: the rows to insert plus how many PP-NAP codes matched no food. */
export interface PriceMapping {
  rows: PriceRow[];
  skipped: number;
}

/**
 * Joins PP-NAP rows to seeded FNDDS foods via `foodCode → fdcId` (pure; offline-testable).
 * @param ppNapRows - the parsed PP-NAP CSV rows.
 * @param foodCodeToFdcId - the `food_code → fdc_id` map built from the FNDDS Survey JSON.
 * @returns the `fdc_food_price` rows (raw price preserved) + the count skipped for no match.
 */
export function toPriceRows(ppNapRows: PpNapRow[], foodCodeToFdcId: Map<string, number>): PriceMapping {
  const rows: PriceRow[] = [];
  let skipped = 0;
  for (const r of ppNapRows) {
    const fdcId = foodCodeToFdcId.get(r.foodCode);
    if (fdcId == null) {
      skipped++;
      continue;
    }
    rows.push({
      fdcId,
      foodCode: r.foodCode,
      pricePer100g: r.price100gm,
      method: r.method ?? null,
      sourceCycle: SOURCE_CYCLE,
    });
  }
  return { rows, skipped };
}

/**
 * Batch-inserts price rows into `fdc_food_price` (batches of 500, `.onConflictDoNothing()`
 * → idempotent). Injectable `db`. Mirrors `insertFdcFoods`.
 */
export async function insertPrices(db: Database, rows: PriceRow[]): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(fdcFoodPrice)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoNothing();
  }
}
