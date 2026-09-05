import type { MealSlot } from '../schema.js';
import type { RankableRecipe } from '../ranking/types.js';
import type { PublicRecipeCard } from '../models/recipe.js';

/** The criteria dimensions a one-shot slot search can constrain — the subset of directive dimensions
 * `recipeMatches` understands as category/ingredient membership (nutrient is aggregate-only). */
export const CRITERIA_DIMENSIONS = ['ingredient', 'cuisine', 'dish_type', 'primary_ingredient', 'food_category'] as const;
export type CriteriaDimension = (typeof CRITERIA_DIMENSIONS)[number];

/**
 * A transient, ad-hoc constraint on a slot search — "something with fish, under 30 minutes". Never
 * persisted as a preference: it filters this one query. `include`/`exclude` are `(dimension → values)`
 * maps matched via `recipeMatches`; `maxTotalMinutes` caps cook time (a recipe with unknown time is
 * dropped, since we can't prove it fits).
 */
export interface SlotCriteria {
  include?: Partial<Record<CriteriaDimension, string[]>>;
  exclude?: Partial<Record<CriteriaDimension, string[]>>;
  maxTotalMinutes?: number;
}

/** A scored recipe eligible for a slot: its score (tier bonus + ranking score, so the household's own
 * recipes lead), the facets MMR diversifies on, and its card so the presenting tool needs no second fetch. */
export interface CandidateRecipe {
  recipeId: string;
  score: number;
  categories: RankableRecipe['categories'];
  card: PublicRecipeCard;
}

/** One (date, meal) opening to fill. */
export interface Slot {
  date: string; // YYYY-MM-DD
  meal: MealSlot;
}
