import { z } from 'zod';
import { MAJOR_ALLERGENS, ALLERGEN_SEVERITIES, DIFFICULTY_BANDS, DIET_STRICTNESS, EQUIPMENT_TYPES, GROCERY_STORES } from './schema.js';
import { WeeklyMealsSchema, TimeByMealSchema, type UserPreferences, type PreferencesUpdate } from './models/user-preferences.js';

// The picker's facets. `ingredient` is now its own affinity facet (value = a base_ingredient_id
// uuid), so wire and domain names match 1:1 — no more `ingredient`↔`primary_ingredient` remap.
// A legacy `primary_ingredient` food-pref (from the swipe dislike-loop) simply isn't a picker
// facet: it's dropped from the DTO but survives a Save (dislikes replace only re-supplied values).
const WIRE_FACETS = ['cuisine', 'dish_type', 'ingredient'] as const;
type WireFacet = (typeof WIRE_FACETS)[number];
const isWireFacet = (f: string): f is WireFacet => (WIRE_FACETS as readonly string[]).includes(f);

const affinitySelection = z.object({ facet: z.enum(WIRE_FACETS), value: z.string() });

/** `PUT /v1/preferences` body — the user-editable subset, snake_case over the wire. */
export const preferencesBodySchema = z.object({
  skill_level: z.enum(DIFFICULTY_BANDS),
  weekly_budget_cents: z.number().int().nonnegative().nullable(),
  time_budget_minutes: z.number().int().positive().nullable(),
  // Optional so a not-yet-shipped client that only sends the scalar still validates.
  time_by_meal: TimeByMealSchema.nullish(),
  weekly_meals: WeeklyMealsSchema,
  likes: z.array(affinitySelection),
  dislikes: z.array(affinitySelection),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ diet: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  owned_equipment: z.array(z.enum(EQUIPMENT_TYPES)),
  grocery_stores: z.array(z.enum(GROCERY_STORES)),
  household_adults: z.number().int().min(1),
  household_kids: z.number().int().nonnegative(),
  eats_leftovers: z.boolean(),
});
export type PreferencesBody = z.infer<typeof preferencesBodySchema>;

/** Domain model → wire DTO. Surfaces only the picker's facets (cuisine/dish_type/ingredient);
 * a legacy `primary_ingredient` pref isn't editable in the picker, so it's omitted here. */
export function toPreferencesDTO(p: UserPreferences) {
  const selections = (sentiment: 'like' | 'dislike') =>
    p.foodPrefs
      .filter((f) => f.sentiment === sentiment && isWireFacet(f.facet))
      .map((f) => ({ facet: f.facet as WireFacet, value: f.value }));
  return {
    skill_level: p.skillLevel,
    weekly_budget_cents: p.weeklyBudgetCents,
    time_budget_minutes: p.timeBudgetMinutes,
    time_by_meal: p.timeByMeal,
    weekly_meals: p.weeklyMeals,
    likes: selections('like'),
    dislikes: selections('dislike'),
    allergens: p.allergens,
    diets: p.diets.map((d) => ({ diet: d.dietId, strictness: d.strictness })),
    owned_equipment: p.ownedEquipment,
    grocery_stores: p.groceryStores,
    household_adults: p.household.adults,
    household_kids: p.household.kids,
    eats_leftovers: p.eatsLeftovers,
  };
}

/** Wire DTO → the repository's editable-subset input. Facet names pass through 1:1 now. */
export function fromPreferencesDTO(b: PreferencesBody): PreferencesUpdate {
  return {
    skillLevel: b.skill_level,
    weeklyBudgetCents: b.weekly_budget_cents,
    timeBudgetMinutes: b.time_budget_minutes,
    timeByMeal: b.time_by_meal ?? null,
    weeklyMeals: b.weekly_meals,
    likes: b.likes,
    dislikes: b.dislikes,
    allergens: b.allergens,
    diets: b.diets.map((d) => ({ dietId: d.diet, strictness: d.strictness })),
    ownedEquipment: b.owned_equipment,
    groceryStores: b.grocery_stores,
    household: { adults: b.household_adults, kids: b.household_kids },
    eatsLeftovers: b.eats_leftovers,
  };
}
