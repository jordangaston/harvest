import { FDC_NUTRIENT } from './fdc-nutrient.js';

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
