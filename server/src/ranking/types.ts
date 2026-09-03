import type { Equipment, Essentiality } from '../schema.js';
import type { LabelCoreKey } from '../models/label-core.js';

/** Recipe-with-signals the engine consumes; WI-RANK-3 populates it from the DB. */
export type RankableRecipe = {
  id: string;
  createdAt: Date;
  costPerServingCents: number | null;
  difficultyBand: 'beginner' | 'intermediate' | 'advanced' | null;
  mealPrepFit: 'unsuitable' | 'suitable' | 'designed' | null;
  nrfScore: number | null;
  // Per-serving nutrition panel (the eight label-core macros), keyed by label-core column. A
  // `nutrient` directive budgets against the field its value maps to (NUTRIENT_PANEL_COLUMN); a
  // genuinely-absent macro is null and the directive can't bite.
  nutrition: Record<LabelCoreKey, number | null>;
  totalMinutes: number | null;
  // The recipe's meal_type facets (breakfast/brunch/lunch/dinner/snack); picks the time budget.
  mealTypes: string[];
  categories: { cuisine: string[]; dishType: string[]; primaryIngredient: string[]; foodCategory: string[] };
  // Ingredient-level affinity (taste overhaul): the recipe's matched ingredients rolled up
  // to base-ingredient ids (`ingredients.fdc_id` → `fdc_foods.base_ingredient_id`). Empty
  // when no ingredient matched a curated base ingredient — the facet then contributes nothing.
  baseIngredientIds: string[];
  allergens: { contains: string[]; mayContain: string[]; complete: boolean };
  dietFit: Record<string, 'compatible' | 'incompatible' | 'unknown'>;
  // Equipment signal (WI-EQ-3): the recipe's rolled-up set with per-recipe essentiality, and
  // whether detection ran (false → the filter stays lenient).
  equipment: { equipment: Equipment; essentiality: Essentiality }[];
  equipmentComplete: boolean;
  popularity: number | null; // always null until the signal ships
};

export type RankedRecipe = { recipeId: string; score: number; breakdown: Record<string, number> };
