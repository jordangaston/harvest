import { LABEL_CORE_KEYS, type LabelCoreKey } from '../models/label-core.js';

/**
 * USDA FDC nutrient numbers keyed by symbolic name — the eight label-core macros plus
 * the NRF-relevant extras (vitamin D, DHA, EPA) the estimator scores. Values are the
 * `nutrient.number` strings stored in `fdc_food_nutrient`.
 */
export const FDC_NUTRIENT = {
  calories: '208',
  protein: '203',
  fat: '204',
  saturatedFat: '606',
  carbohydrate: '205',
  fiber: '291',
  sugar: '269',
  sodium: '307',
  vitaminD: '328',
  dha: '621',
  epa: '629',
} as const;

/** FDC nutrient number → its label-core recipe-column key, for the eight macros. */
const NUMBER_TO_LABEL_CORE: Record<string, LabelCoreKey> = {
  [FDC_NUTRIENT.calories]: 'calories',
  [FDC_NUTRIENT.fat]: 'grams_of_fat',
  [FDC_NUTRIENT.saturatedFat]: 'grams_of_saturated_fat',
  [FDC_NUTRIENT.carbohydrate]: 'grams_of_carbohydrate',
  [FDC_NUTRIENT.fiber]: 'grams_of_fiber',
  [FDC_NUTRIENT.sugar]: 'grams_of_sugar',
  [FDC_NUTRIENT.protein]: 'grams_of_protein',
  [FDC_NUTRIENT.sodium]: 'milligrams_of_sodium',
};

/** The FDC nutrient number backing each label-core key (the reverse of the above). */
export const LABEL_CORE_TO_FDC_NUMBER: Record<LabelCoreKey, string> = Object.fromEntries(
  LABEL_CORE_KEYS.map((key) => [key, fdcNumberForLabelCore(key)]),
) as Record<LabelCoreKey, string>;

/** Maps an FDC nutrient number back to its `LabelCoreKey`, or undefined if not a macro. */
export function labelCoreForFdcNumber(number: string): LabelCoreKey | undefined {
  return NUMBER_TO_LABEL_CORE[number];
}

function fdcNumberForLabelCore(key: LabelCoreKey): string {
  const number = Object.entries(NUMBER_TO_LABEL_CORE).find(([, k]) => k === key)?.[0];
  if (!number) throw new Error(`no FDC nutrient number for label-core key ${key}`);
  return number;
}
