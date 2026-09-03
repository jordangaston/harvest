import { z } from 'zod';
import { AFFINITY_FACETS, DIRECTIVE_DIMENSIONS, DIRECTIVE_SCOPES, DIRECTIONS, STRENGTHS } from '../schema.js';

// Ranking enum value tuples, re-declared here (repo convention: the model validates
// independently of the Drizzle table). `AFFINITY_FACETS`/`SENTIMENTS` are the one exception —
// shared with the recipe/user facet columns, so imported from schema.
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const MAJOR_ALLERGENS = ['milk', 'egg', 'fish', 'crustacean_shellfish', 'tree_nut', 'peanut', 'wheat', 'soybean', 'sesame'] as const;
const ALLERGEN_SEVERITIES = ['severe', 'moderate', 'mild'] as const;
const DIET_STRICTNESS = ['strict', 'flexible'] as const;
export { AFFINITY_FACETS, DIRECTIVE_DIMENSIONS };
const EQUIPMENT_TYPES = ['oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'pressure_cooker', 'stand_mixer', 'blender', 'food_processor', 'grill', 'dutch_oven', 'deep_fryer', 'wok', 'sous_vide', 'smoker', 'ice_cream_maker', 'waffle_iron'] as const;

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

/**
 * One resolved food directive (mirrors a `user_food_prefs` row 1:1) —
 * `{ dimension, value, scope, direction, strength, target?, unit? }` plus a `reason` blurb.
 * `scope` drives enforcement (recipe → rank/filter, meal-slot → plate rule, day/week → aggregate);
 * `direction`+`strength` replace the old taste/weight axes. `target`/`unit` are aggregate-scope only.
 */
export const FoodPrefSchema = z.object({
  dimension: z.enum(DIRECTIVE_DIMENSIONS),
  value: z.string(),
  scope: z.enum(DIRECTIVE_SCOPES),
  direction: z.enum(DIRECTIONS),
  strength: z.enum(STRENGTHS),
  target: z.number().nullable(),
  unit: z.string().nullable(),
  reason: z.string().nullable(),
});
export type FoodPref = z.infer<typeof FoodPrefSchema>;

/** The fully-resolved per-user ranking preferences, with the child tables folded in. */
export const UserPreferencesSchema = z.object({
  userId: z.string(),
  skillLevel: z.enum(SKILL_LEVELS),
  budgetCentsPerServing: z.number().int().positive().nullable(),
  weeklyBudgetCents: z.number().int().nonnegative().nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  timeByMeal: TimeByMealSchema.nullable(),
  weeklyMeals: WeeklyMealsSchema,
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ dietId: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  foodPrefs: z.array(FoodPrefSchema),
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

/**
 * One editable food directive (mirrors the row). `scope`/`strength` default when a caller omits
 * them; `target`/`unit`/`reason` are `.nullish()` (aggregate-scope or optional).
 */
export const FoodPrefUpdateSchema = z.object({
  dimension: z.enum(DIRECTIVE_DIMENSIONS),
  value: z.string(),
  scope: z.enum(DIRECTIVE_SCOPES).default('recipe'),
  direction: z.enum(DIRECTIONS),
  strength: z.enum(STRENGTHS).default('soft'),
  target: z.number().nullish(),
  unit: z.string().nullish(),
  reason: z.string().nullish(),
});
export type FoodPrefUpdate = z.infer<typeof FoodPrefUpdateSchema>;

/**
 * The user-editable subset the settings + onboarding surfaces write. One `foodPrefs` array carries
 * every food directive (taste + eat-more/less intent); the repo upserts each by
 * (userId, dimension, value, scope).
 */
export const PreferencesUpdateSchema = z.object({
  skillLevel: z.enum(SKILL_LEVELS),
  weeklyBudgetCents: z.number().int().nonnegative().nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  timeByMeal: TimeByMealSchema.nullable(),
  weeklyMeals: WeeklyMealsSchema,
  foodPrefs: z.array(FoodPrefUpdateSchema),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ dietId: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  ownedEquipment: z.array(z.enum(EQUIPMENT_TYPES)),
  groceryStores: z.array(z.string()),
  household: z.object({ adults: z.number().int().min(1), kids: z.number().int().nonnegative() }),
  eatsLeftovers: z.boolean(),
});
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;
