import { z } from 'zod';
import { AFFINITY_FACETS, SENTIMENTS } from '../schema.js';

// Ranking enum value tuples, re-declared here (repo convention: the model validates
// independently of the Drizzle table). The 0–3 weight range is enforced in this
// schema at the read boundary, not by a DB check constraint. `AFFINITY_FACETS`/`SENTIMENTS`
// are the one exception — shared with the recipe/user facet columns, so imported from schema.
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const MAJOR_ALLERGENS = ['milk', 'egg', 'fish', 'crustacean_shellfish', 'tree_nut', 'peanut', 'wheat', 'soybean', 'sesame'] as const;
const ALLERGEN_SEVERITIES = ['severe', 'moderate', 'mild'] as const;
const DIET_STRICTNESS = ['strict', 'flexible'] as const;
export { AFFINITY_FACETS };
const EQUIPMENT_TYPES = ['oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'pressure_cooker', 'stand_mixer', 'blender', 'food_processor', 'grill', 'dutch_oven', 'deep_fryer', 'wok', 'sous_vide', 'smoker', 'ice_cream_maker', 'waffle_iron'] as const;

const weight = () => z.number().int().min(0).max(3);
const mealCount = () => z.number().int().min(0).max(21);

/** How many of each meal type to plan per week (meal-count intake). */
export const WeeklyMealsSchema = z.object({
  breakfast: mealCount(),
  lunch: mealCount(),
  dinner: mealCount(),
  snack: mealCount(),
  kids: mealCount(),
});
export type WeeklyMeals = z.infer<typeof WeeklyMealsSchema>;
export const ZERO_MEALS: WeeklyMeals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 };

/** Per-meal cook-time budget in minutes, each independently optional (an iMessage user may give
 *  just "30-min dinners"). Backed by three columns; a meal with no budget is null. */
export const TimeByMealSchema = z.object({
  breakfast: z.number().int().positive().nullable(),
  lunch: z.number().int().positive().nullable(),
  dinner: z.number().int().positive().nullable(),
});
export type TimeByMeal = z.infer<typeof TimeByMealSchema>;

/** Assemble the domain `timeByMeal` from its three columns — null when no meal has a budget. */
export function timeByMealFromColumns(breakfast: number | null, lunch: number | null, dinner: number | null): TimeByMeal | null {
  if (breakfast === null && lunch === null && dinner === null) return null;
  return { breakfast, lunch, dinner };
}

/** The fully-resolved per-user ranking preferences, with the child tables folded in. */
export const UserPreferencesSchema = z.object({
  userId: z.string(),
  skillLevel: z.enum(SKILL_LEVELS),
  budgetCentsPerServing: z.number().int().positive().nullable(),
  weeklyBudgetCents: z.number().int().nonnegative().nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  timeByMeal: TimeByMealSchema.nullable(),
  weeklyMeals: WeeklyMealsSchema,
  weights: z.object({
    cost: weight(),
    difficulty: weight(),
    nutrition: weight(),
    affinity: weight(),
    time: weight(),
    popularity: weight(),
    mealPrep: weight(),
  }),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ dietId: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  foodPrefs: z.array(z.object({ facet: z.enum(AFFINITY_FACETS), value: z.string(), sentiment: z.enum(SENTIMENTS) })),
  // Equipment signal (WI-EQ-1): the owned appliance set + the review gate. The filter engages
  // only when `equipmentReviewed` is true (EQUIPMENT-SIGNAL.md § Gating).
  ownedEquipment: z.array(z.enum(EQUIPMENT_TYPES)),
  equipmentReviewed: z.boolean(),
  // Onboarding front-loaded signals (WI-1).
  groceryStores: z.array(z.string()),
  household: z.object({ adults: z.number().int().min(1), kids: z.number().int().nonnegative() }),
  eatsLeftovers: z.boolean(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/** A like/dislike over any of the three affinity facets (domain shape). */
const AffinitySelectionSchema = z.object({ facet: z.enum(AFFINITY_FACETS), value: z.string() });

/**
 * The user-editable subset the settings + onboarding surfaces write. Weights are omitted on
 * purpose — they're server-owned (tuned by the dislike loop), so a save never clobbers them.
 * `likes`/`dislikes` carry {facet,value} over all three affinity facets; the repo rebuilds the
 * full food-pref set from them (dislike-loop weight tuning stays untouched).
 */
export const PreferencesUpdateSchema = z.object({
  skillLevel: z.enum(SKILL_LEVELS),
  weeklyBudgetCents: z.number().int().nonnegative().nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  timeByMeal: TimeByMealSchema.nullable(),
  weeklyMeals: WeeklyMealsSchema,
  likes: z.array(AffinitySelectionSchema),
  dislikes: z.array(AffinitySelectionSchema),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ dietId: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  ownedEquipment: z.array(z.enum(EQUIPMENT_TYPES)),
  groceryStores: z.array(z.string()),
  household: z.object({ adults: z.number().int().min(1), kids: z.number().int().nonnegative() }),
  eatsLeftovers: z.boolean(),
});
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;
