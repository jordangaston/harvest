import { FDC_NUTRIENT } from './fdc-nutrient.js';
import type { LabelCoreKey } from '../models/label-core.js';

/**
 * The nutrients a `nutrient` directive may reference — the eight label-core macros the recipe
 * nutrition panel actually carries (`models/label-core.ts`), so the WI-3 ranker can budget a
 * directive against a real panel field. Each canonical id maps to its USDA FDC `nutrient.number`
 * (the seeded reference in `fdc_food_nutrient`, via `FDC_NUTRIENT`) — the id is the human-facing
 * slug a directive stores; the number is how it joins the panel.
 */
export const NUTRIENT_FDC_NUMBER: Record<string, string> = {
  calories: FDC_NUTRIENT.calories,
  protein: FDC_NUTRIENT.protein,
  fat: FDC_NUTRIENT.fat,
  saturated_fat: FDC_NUTRIENT.saturatedFat,
  carbohydrate: FDC_NUTRIENT.carbohydrate,
  fiber: FDC_NUTRIENT.fiber,
  sugar: FDC_NUTRIENT.sugar,
  sodium: FDC_NUTRIENT.sodium,
};

/** The legal `nutrient` directive values — the catalog `codeCandidates('nutrient')` grounds against. */
export const NUTRIENT_IDS = Object.keys(NUTRIENT_FDC_NUMBER);

/**
 * The recipe nutrition-panel column each `nutrient` directive value budgets against — how the WI-3
 * ranker joins a directive to a real per-serving panel field. The panel is keyed by label-core column
 * (`models/label-core.ts`), not by FDC number, so the ranker maps slug → column directly (the FDC
 * number is the ingest-time join, not the rank-time one).
 */
export const NUTRIENT_PANEL_COLUMN: Record<string, LabelCoreKey> = {
  calories: 'calories',
  protein: 'grams_of_protein',
  fat: 'grams_of_fat',
  saturated_fat: 'grams_of_saturated_fat',
  carbohydrate: 'grams_of_carbohydrate',
  fiber: 'grams_of_fiber',
  sugar: 'grams_of_sugar',
  sodium: 'milligrams_of_sodium',
};
