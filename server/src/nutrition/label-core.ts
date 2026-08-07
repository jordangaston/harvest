/** The eight Nutrition-Facts label-core fields (C5), keyed by their snake_case
 * recipe-column names. Values are numbers while computing, strings once stored
 * (pg `numeric`). */
export const LABEL_CORE_KEYS = [
  'calories',
  'grams_of_fat',
  'grams_of_saturated_fat',
  'grams_of_carbohydrate',
  'grams_of_fiber',
  'grams_of_sugar',
  'grams_of_protein',
  'milligrams_of_sodium',
] as const;

export type LabelCoreKey = (typeof LABEL_CORE_KEYS)[number];

/** The label core as numbers (per 100 g in the catalog, per serving after compute). */
export type LabelCore = Record<LabelCoreKey, number>;

/** The label core as strings — the shape parsed from schema.org and stored on a recipe. */
export type LabelCoreText = Record<LabelCoreKey, string>;

/** Nutrition on a recipe: the label core plus where it came from. */
export interface Nutrition {
  source: 'parsed' | 'computed';
  values: LabelCoreText;
}

/** Zero-filled label core, for accumulating a sum. */
export function zeroLabelCore(): LabelCore {
  return {
    calories: 0,
    grams_of_fat: 0,
    grams_of_saturated_fat: 0,
    grams_of_carbohydrate: 0,
    grams_of_fiber: 0,
    grams_of_sugar: 0,
    grams_of_protein: 0,
    milligrams_of_sodium: 0,
  };
}

/** Stringify a numeric label core (rounded to 1 decimal) for storage. */
export function toLabelCoreText(core: LabelCore): LabelCoreText {
  const out = {} as LabelCoreText;
  for (const key of LABEL_CORE_KEYS) out[key] = String(Math.round(core[key] * 10) / 10);
  return out;
}
