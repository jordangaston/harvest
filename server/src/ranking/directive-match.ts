import type { FoodPref } from '../models/user-preferences.js';
import type { RankableRecipe } from './types.js';
import { NUTRIENT_PANEL_COLUMN } from '../nutrition/nutrient-catalog.js';

/** The affinity/category facets a recipe carries directly on its category buckets (ingredient/nutrient
 * are separate). Maps a directive `dimension` to the recipe's `categories` bucket. */
const CATEGORY_BUCKET = { cuisine: 'cuisine', dish_type: 'dishType', primary_ingredient: 'primaryIngredient', food_category: 'foodCategory' } as const;

/**
 * Whether a recipe carries a directive's `(dimension, value)` — the attribute the directive
 * ranks/filters/completes against, scope-agnostic. Categories/ingredient match on membership; a
 * `nutrient` matches when the recipe's panel measures that nutrient (a non-null value to budget).
 * One implementation shared by the ranker (recipe scope) and plate completion (meal-slot scope).
 */
export function recipeMatches(recipe: RankableRecipe, d: Pick<FoodPref, 'dimension' | 'value'>): boolean {
  if (d.dimension === 'ingredient') return recipe.baseIngredientIds.includes(d.value);
  if (d.dimension === 'nutrient') {
    const column = NUTRIENT_PANEL_COLUMN[d.value];
    return column !== undefined && recipe.nutrition[column] !== null;
  }
  return recipe.categories[CATEGORY_BUCKET[d.dimension]].includes(d.value);
}
