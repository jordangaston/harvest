import { z } from 'zod';
import { MAJOR_ALLERGENS, ALLERGEN_SEVERITIES, DIFFICULTY_BANDS, DIET_STRICTNESS, EQUIPMENT_TYPES, GROCERY_STORES, AFFINITY_FACETS, SENTIMENTS } from './schema.js';
import { WeeklyMealsSchema, TimeByMealSchema, type UserPreferences, type PreferencesUpdate } from './models/user-preferences.js';

// One unified food-pref carries both orthogonal axes over the wire (snake_case), each axis
// optional so a caller sends only what applies. `facet` spans every affinity facet incl.
// `food_category` (moderation) and `ingredient` (value = a base_ingredient_id uuid).
const foodPrefBody = z.object({
  facet: z.enum(AFFINITY_FACETS),
  value: z.string(),
  sentiment: z.enum(SENTIMENTS).nullish(),
  target: z.number().min(-1).max(1).nullish(),
  reason: z.string().nullish(),
});

/** `PUT /v1/preferences` body — the user-editable subset, snake_case over the wire. */
export const preferencesBodySchema = z.object({
  skill_level: z.enum(DIFFICULTY_BANDS),
  weekly_budget_cents: z.number().int().nonnegative().nullable(),
  time_budget_minutes: z.number().int().positive().nullable(),
  // Optional so a not-yet-shipped client that only sends the scalar still validates.
  time_by_meal: TimeByMealSchema.nullish(),
  weekly_meals: WeeklyMealsSchema,
  food_prefs: z.array(foodPrefBody),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ diet: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  owned_equipment: z.array(z.enum(EQUIPMENT_TYPES)),
  grocery_stores: z.array(z.enum(GROCERY_STORES)),
  household_adults: z.number().int().min(1),
  household_kids: z.number().int().nonnegative(),
  eats_leftovers: z.boolean(),
});
export type PreferencesBody = z.infer<typeof preferencesBodySchema>;

/** Domain model → wire DTO. The resolved `foodPrefs` array maps 1:1 to `food_prefs` — every
 * axis (sentiment/target/reason) carried through, so GET and PUT finally share one shape. */
export function toPreferencesDTO(p: UserPreferences) {
  return {
    skill_level: p.skillLevel,
    weekly_budget_cents: p.weeklyBudgetCents,
    time_budget_minutes: p.timeBudgetMinutes,
    time_by_meal: p.timeByMeal,
    weekly_meals: p.weeklyMeals,
    food_prefs: p.foodPrefs.map((f) => ({ facet: f.facet, value: f.value, sentiment: f.sentiment, target: f.target, reason: f.reason })),
    allergens: p.allergens,
    diets: p.diets.map((d) => ({ diet: d.dietId, strictness: d.strictness })),
    owned_equipment: p.ownedEquipment,
    grocery_stores: p.groceryStores,
    household_adults: p.household.adults,
    household_kids: p.household.kids,
    eats_leftovers: p.eatsLeftovers,
  };
}

/** Wire DTO → the repository's editable-subset input. The unified `food_prefs` array passes
 * through 1:1 (the domain schema re-validates the ≥1-axis invariant). */
export function fromPreferencesDTO(b: PreferencesBody): PreferencesUpdate {
  return {
    skillLevel: b.skill_level,
    weeklyBudgetCents: b.weekly_budget_cents,
    timeBudgetMinutes: b.time_budget_minutes,
    timeByMeal: b.time_by_meal ?? null,
    weeklyMeals: b.weekly_meals,
    foodPrefs: b.food_prefs,
    allergens: b.allergens,
    diets: b.diets.map((d) => ({ dietId: d.diet, strictness: d.strictness })),
    ownedEquipment: b.owned_equipment,
    groceryStores: b.grocery_stores,
    household: { adults: b.household_adults, kids: b.household_kids },
    eatsLeftovers: b.eats_leftovers,
  };
}
