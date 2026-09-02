import type { TimeByMeal, UserPreferences } from '../models/user-preferences.js';
import type { RankableRecipe } from './types.js';
import { NUTRITION_K, BUDGET_SLOPE, DIFFICULTY_BY_DISTANCE, MEAL_PREP_SCORE } from './constants.js';

/** One soft signal: its weight for a user and its normalized score (or null when unavailable) for a recipe. */
export interface SignalScorer {
  key: string;
  weight(prefs: UserPreferences): number;
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const BAND_RANK = { beginner: 1, intermediate: 2, advanced: 3 } as const;

/** (2·budget − cost)/budget: at/under budget → 1, at 2× budget → 0. */
export class CostScorer implements SignalScorer {
  key = 'cost';
  weight = (p: UserPreferences) => p.weights.cost;
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null {
    const budget = prefs.budgetCentsPerServing;
    if (recipe.costPerServingCents === null || budget === null) return null;
    return clamp01((BUDGET_SLOPE * budget - recipe.costPerServingCents) / budget);
  }
}

/** Asymmetric lookup on signed distance bandRank − skillRank. */
export class DifficultyScorer implements SignalScorer {
  key = 'difficulty';
  weight = (p: UserPreferences) => p.weights.difficulty;
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null {
    if (recipe.difficultyBand === null) return null;
    const d = BAND_RANK[recipe.difficultyBand] - BAND_RANK[prefs.skillLevel];
    return DIFFICULTY_BY_DISTANCE[d];
  }
}

/** Saturating squash x⁺/(x⁺+k), x⁺ = max(0, nrf). */
export class NutritionScorer implements SignalScorer {
  key = 'nutrition';
  weight = (p: UserPreferences) => p.weights.nutrition;
  score(recipe: RankableRecipe): number | null {
    if (recipe.nrfScore === null) return null;
    const x = Math.max(0, recipe.nrfScore);
    return x / (x + NUTRITION_K);
  }
}

const FACET_KEY = { cuisine: 'cuisine', dish_type: 'dishType', primary_ingredient: 'primaryIngredient' } as const;

/** Per facet: +1 shares a liked value, −1 shares a disliked (no liked), else 0; centered on 0.5.
 * Four facets: the three `recipe.categories` facets plus `ingredient`, matched on the recipe's
 * rolled-up `baseIngredientIds` (so an "okra" like/dislike bites at base-ingredient granularity). */
export class AffinityScorer implements SignalScorer {
  key = 'affinity';
  weight = (p: UserPreferences) => p.weights.affinity;
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null {
    const sentiments: number[] = [];
    for (const facet of ['cuisine', 'dish_type', 'primary_ingredient'] as const) {
      const values = recipe.categories[FACET_KEY[facet]];
      if (values.length === 0) continue;
      sentiments.push(this.facetSentiment(facet, values, prefs));
    }
    if (recipe.baseIngredientIds.length > 0) {
      sentiments.push(this.facetSentiment('ingredient', recipe.baseIngredientIds, prefs));
    }
    if (sentiments.length === 0) return null;
    const mean = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    return clamp01(0.5 + 0.5 * mean);
  }

  private facetSentiment(facet: string, values: string[], prefs: UserPreferences): number {
    // Skip pure-intent rows (sentiment == null): a "eat less red meat" carries no taste.
    const prefs_ = prefs.foodPrefs.filter((f) => f.sentiment != null && f.facet === facet && values.includes(f.value));
    if (prefs_.some((f) => f.sentiment === 'like')) return 1;
    if (prefs_.some((f) => f.sentiment === 'dislike')) return -1;
    return 0;
  }
}

/** meal_type → its time-budget slot; snack maps to nothing (no snack slider). */
const SLOT_FOR_MEAL_TYPE: Record<string, keyof TimeByMeal | undefined> = {
  breakfast: 'breakfast',
  brunch: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
};

/**
 * The time budget to score a recipe against: the most-generous (max) applicable per-meal budget,
 * so a recipe valid for several meals isn't penalized by the tightest one (design Q-03). Recipes
 * with no applicable meal_type still get the most-generous overall budget; a null `timeByMeal`
 * (un-migrated user) falls back to the scalar.
 */
function pickBudget(mealTypes: string[], timeByMeal: TimeByMeal | null, fallback: number | null): number | null {
  if (timeByMeal === null) return fallback;
  const nonNull = (n: number | null): n is number => n !== null;
  const applicable = mealTypes
    .map((mt) => SLOT_FOR_MEAL_TYPE[mt])
    .filter((slot): slot is keyof TimeByMeal => slot !== undefined)
    .map((slot) => timeByMeal[slot])
    .filter(nonNull);
  const budgets = applicable.length > 0 ? applicable : Object.values(timeByMeal).filter(nonNull);
  return budgets.length > 0 ? Math.max(...budgets) : fallback;
}

/** Mirrors cost: (2·T − minutes)/T, scored against the budget for the recipe's meal type. */
export class TimeScorer implements SignalScorer {
  key = 'time';
  weight = (p: UserPreferences) => p.weights.time;
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null {
    const t = pickBudget(recipe.mealTypes, prefs.timeByMeal, prefs.timeBudgetMinutes);
    if (recipe.totalMinutes === null || t === null) return null;
    return clamp01((BUDGET_SLOPE * t - recipe.totalMinutes) / t);
  }
}

/** Band-map lookup (signal #10): designed→1.0, suitable→0.6, unsuitable→0.15; null fit → null. */
export class MealPrepScorer implements SignalScorer {
  key = 'mealPrep';
  weight = (p: UserPreferences) => p.weights.mealPrep;
  score(recipe: RankableRecipe): number | null {
    if (recipe.mealPrepFit === null) return null;
    return MEAL_PREP_SCORE[recipe.mealPrepFit];
  }
}

/** Registered so the fold accounts for it; returns null until the popularity column ships. */
export class PopularityScorer implements SignalScorer {
  key = 'popularity';
  weight = (p: UserPreferences) => p.weights.popularity;
  score(): number | null {
    return null;
  }
}
