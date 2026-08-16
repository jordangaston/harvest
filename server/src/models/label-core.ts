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

/** Nutrition on a recipe. Parsed-only: the source published schema.org NutritionInformation. */
export interface Nutrition {
  source: 'parsed';
  values: LabelCoreText;
}
