import type { MealSlot, MealPrepFit } from '../schema.js';

/** Preference tier, ordered imported ≻ liked ≻ saved ≻ global (WI-MP-2 P1). */
export type Tier = 'imported' | 'liked' | 'saved' | 'global';

/** A ranked recipe eligible for a slot. `baseScore` already folds the tier bonus into the
 * ranking-engine score (see planning/constants TIER_BONUS); `familiar` drives the novelty
 * portfolio; `categories` feeds MMR similarity; the rest feed repair + batching. */
export interface CandidateRecipe {
  recipeId: string;
  tier: Tier;
  baseScore: number;
  costPerServingCents: number | null;
  totalMinutes: number | null;
  mealPrepFit: MealPrepFit | null;
  categories: { cuisine: string[]; dishType: string[]; primaryIngredient: string[] };
  familiar: boolean;
}

/** One (date, meal) opening to fill. */
export interface Slot {
  date: string; // YYYY-MM-DD
  meal: MealSlot;
}

/** A filled slot. `batchId` groups a leftover batch (P7); the cook slot and its leftovers share it. */
export interface SlotChoice {
  slot: Slot;
  recipeId: string;
  tier: Tier;
  batchId: string | null;
}

/** Everything the filler needs beyond the pools: the soft-constraint targets + trigger inputs. */
export interface FillConstraints {
  weeklyBudgetCents: number | null;
  timeByMeal: { breakfast: number; lunch: number; dinner: number; snack: number } | null;
  timeBudgetMinutes: number | null;
  householdServings: number; // adults + kids; scales per-serving cost and batch sizing
  cookDaysCount: number | null; // weekly cooking capacity; null disables the capacity trigger
  eatsLeftovers: boolean;
  mealPrepIntent: boolean; // when_cook ∈ {meal_prep, weekly_schedule} OR goal meal_prepping
  weightMealPrep: number; // 0–3; scales how many batches the intent path makes
}

/** The engine's output: the chosen slots plus an objective summary for the API + monitoring. */
export interface PlanAssignment {
  choices: SlotChoice[];
  summary: {
    preferenceTotal: number;
    costTotalCents: number;
    noveltyRatio: number; // fraction of distinct cooks that are new (familiar=false)
    leftoverRatio: number; // fraction of slots served as leftovers
    unfilledSlots: number;
  };
}

/** The pluggable slot-filling core (WI-MP-2 O-02). Pure: no I/O. */
export interface SlotFiller {
  fill(slots: Slot[], pools: Map<MealSlot, CandidateRecipe[]>, constraints: FillConstraints): PlanAssignment;
}

/** Collapses M household members' per-recipe scores into one (WI-MP-2 O-03, D-04). */
export interface ScoreAggregator {
  aggregate(memberScores: number[]): number;
}
