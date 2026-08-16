import { FDC_NUTRIENT } from './fdc-nutrient.js';

/**
 * NRF (Nutrient-Rich Foods) reference values, keyed by FDC nutrient number.
 *
 * `dv` = Daily Value (encourage nutrients); `mrv` = Maximum Reference Value (limiters).
 * Encourage terms are summed as %DV capped at 100 each; limiter terms are subtracted as
 * %MRV; the whole sum is expressed per 100 kcal.
 *
 * tunable — dietician config, design Q-04. The default set is NRF11.3 + omega-3
 * (DHA+EPA), limiters = saturated fat, sugar, sodium. The exact set and DV/MRV values
 * are a code constant here so the dietician's table drops in without touching call sites.
 * Units match the seeded FNDDS panel (grams, milligrams, micrograms per 100 g).
 */
const NRF_ENCOURAGE: Record<string, number> = {
  [FDC_NUTRIENT.protein]: 50, // g
  [FDC_NUTRIENT.fiber]: 28, // g
  [FDC_NUTRIENT.vitaminD]: 20, // µg
  [FDC_NUTRIENT.dha]: 0.25, // g — DHA+EPA share one reference (omega-3)
  [FDC_NUTRIENT.epa]: 0.25, // g
  '320': 900, // vitamin A, µg RAE
  '401': 90, // vitamin C, mg
  '323': 15, // vitamin E, mg
  '301': 1300, // calcium, mg
  '303': 18, // iron, mg
  '304': 420, // magnesium, mg
  '306': 4700, // potassium, mg
  '418': 2.4, // vitamin B12, µg
};

const NRF_LIMIT: Record<string, number> = {
  [FDC_NUTRIENT.saturatedFat]: 20, // g
  [FDC_NUTRIENT.sugar]: 50, // g (total sugar as the added-sugar proxy)
  [FDC_NUTRIENT.sodium]: 2300, // mg
};

/**
 * The raw NRF nutrient-density score: encourage nutrients as %DV (each capped at 100),
 * minus limiter nutrients as %MRV, all per 100 kcal.
 * @param nutrientsPer100g - the dish's nutrient panel, FDC number → amount per 100 g.
 * @param calories - the dish's calories on the same 100 g basis.
 * @returns the score, or null when `calories <= 0` (no per-100-kcal basis exists).
 *   A nutrient absent from the panel contributes nothing to its term (never invented).
 */
export function nrfScore(nutrientsPer100g: Map<string, number>, calories: number): number | null {
  if (!(calories > 0)) return null;
  let encourage = 0;
  for (const [number, dv] of Object.entries(NRF_ENCOURAGE)) {
    const amount = nutrientsPer100g.get(number);
    if (amount != null) encourage += Math.min(100, (amount / dv) * 100);
  }
  let limit = 0;
  for (const [number, mrv] of Object.entries(NRF_LIMIT)) {
    const amount = nutrientsPer100g.get(number);
    if (amount != null) limit += (amount / mrv) * 100;
  }
  return ((encourage - limit) * 100) / calories;
}
