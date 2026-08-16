/** The eight Nutrition-Facts label-core fields (C5), keyed by their snake_case
 * recipe-column names. Stored as strings (pg numeric → SQLite text). */
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

/** The label core as strings — the shape parsed from schema.org and stored on a recipe. */
export type LabelCoreText = Record<LabelCoreKey, string>;

/**
 * Nutrition on a recipe — one model for both authoritative and estimated values.
 * `estimated` is `false` when the source published schema.org NutritionInformation
 * (parsed), `true` when computed from ingredients. It persists via the existing
 * `nutrition_source` column (`'parsed'` ⇔ false, `'computed'` ⇔ true); no new column.
 * A macro genuinely absent is stored `null`, never `0`.
 */
export interface Nutrition {
  estimated: boolean;
  values: LabelCoreValues;
}

/** Label core where a genuinely-absent macro is null (estimated recipes omit macros). */
export type LabelCoreValues = Record<LabelCoreKey, string | null>;
