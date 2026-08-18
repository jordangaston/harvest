import type { Database } from '../../src/db.js';
import { toPriceRows, insertPrices, type PpNapRow } from '../../src/price/price-catalog.js';

/**
 * A small PP-NAP price fixture for offline tests (WI-CS-1/2), reusing the
 * `fdc-foods.fixture.ts` foods. Assigns each priced fixture food a synthetic
 * 8-digit `food_code` (the real FNDDS codes aren't in the FDC fixture), so tests
 * exercise the real `food_code → fdc_id` join. Prices are plausible raw 2017–18
 * USD-per-100-edible-gram values — NOT exact PP-NAP figures (tests must not assert
 * third-party data).
 *
 * Covers flour, chicken, and olive oil (butter stands in for olive oil — the FDC
 * fixture has no oil, and both are "Fats and oils"), plus one deliberately UNPRICED
 * PP-NAP code (99999999) that matches no fixture food — it must be skipped.
 */

/** Synthetic FNDDS food_codes for the priced fixture foods (test-only). */
export const FIXTURE_FOOD_CODES: Record<number, string> = {
  100008: '20010001', // Flour, wheat, all-purpose
  100004: '24020001', // Chicken, breast, roasted
  100007: '81030001', // Butter, unsalted (stands in for olive oil)
};

/** The `food_code → fdc_id` map for the fixture (the join key the seed builds from FNDDS). */
export const FIXTURE_FOOD_CODE_TO_FDC_ID = new Map<string, number>(
  Object.entries(FIXTURE_FOOD_CODES).map(([fdcId, code]) => [code, Number(fdcId)]),
);

/** PP-NAP rows: 3 that match fixture foods + 1 (99999999) that matches none → skipped. */
export const PP_NAP_FIXTURE: PpNapRow[] = [
  { foodCode: '20010001', price100gm: '0.089', method: 'direct' },
  { foodCode: '24020001', price100gm: '0.612', method: 'direct' },
  { foodCode: '81030001', price100gm: '1.734', method: 'fndds recipe' },
  { foodCode: '99999999', price100gm: '0.500', method: 'direct' },
];

/** The fdc_id of the fixture food left UNPRICED (has no PP-NAP row): Rice. */
export const UNPRICED_FDC_ID = 100005;

/** Seeds `fdc_food_price` from the fixture into a migrated db (FDC foods must be seeded first). */
export async function seedPriceFixture(db: Database): Promise<void> {
  const { rows } = toPriceRows(PP_NAP_FIXTURE, FIXTURE_FOOD_CODE_TO_FDC_ID);
  await insertPrices(db, rows);
}
