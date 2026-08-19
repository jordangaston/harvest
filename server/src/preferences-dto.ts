import { z } from 'zod';
import { MAJOR_ALLERGENS, ALLERGEN_SEVERITIES, DIFFICULTY_BANDS, DIET_STRICTNESS, EQUIPMENT_TYPES } from './schema.js';
import { WeeklyMealsSchema, type UserPreferences, type PreferencesUpdate } from './models/user-preferences.js';

/** `PUT /v1/preferences` body — the user-editable subset, snake_case over the wire. */
export const preferencesBodySchema = z.object({
  skill_level: z.enum(DIFFICULTY_BANDS),
  weekly_budget_cents: z.number().int().nonnegative().nullable(),
  time_budget_minutes: z.number().int().positive().nullable(),
  weekly_meals: WeeklyMealsSchema,
  liked_cuisines: z.array(z.string()),
  disliked_ingredients: z.array(z.string()),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ diet: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  owned_equipment: z.array(z.enum(EQUIPMENT_TYPES)),
});
export type PreferencesBody = z.infer<typeof preferencesBodySchema>;

/** Domain model → wire DTO. Folds the food-pref facets into the two lists the UI reads. */
export function toPreferencesDTO(p: UserPreferences) {
  return {
    skill_level: p.skillLevel,
    weekly_budget_cents: p.weeklyBudgetCents,
    time_budget_minutes: p.timeBudgetMinutes,
    weekly_meals: p.weeklyMeals,
    liked_cuisines: p.foodPrefs.filter((f) => f.facet === 'cuisine' && f.sentiment === 'like').map((f) => f.value),
    disliked_ingredients: p.foodPrefs.filter((f) => f.facet === 'primary_ingredient' && f.sentiment === 'dislike').map((f) => f.value),
    allergens: p.allergens,
    diets: p.diets.map((d) => ({ diet: d.dietId, strictness: d.strictness })),
    owned_equipment: p.ownedEquipment,
  };
}

/** Wire DTO → the repository's editable-subset input. */
export function fromPreferencesDTO(b: PreferencesBody): PreferencesUpdate {
  return {
    skillLevel: b.skill_level,
    weeklyBudgetCents: b.weekly_budget_cents,
    timeBudgetMinutes: b.time_budget_minutes,
    weeklyMeals: b.weekly_meals,
    likedCuisines: b.liked_cuisines,
    dislikedIngredients: b.disliked_ingredients,
    allergens: b.allergens,
    diets: b.diets.map((d) => ({ dietId: d.diet, strictness: d.strictness })),
    ownedEquipment: b.owned_equipment,
  };
}
