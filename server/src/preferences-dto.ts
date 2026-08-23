import { z } from 'zod';
import { MAJOR_ALLERGENS, ALLERGEN_SEVERITIES, DIFFICULTY_BANDS, DIET_STRICTNESS, EQUIPMENT_TYPES, GROCERY_STORES } from './schema.js';
import { WeeklyMealsSchema, TimeByMealSchema, type UserPreferences, type PreferencesUpdate } from './models/user-preferences.js';

// The wire facet vocab (`ingredient` reads cleaner than the domain's `primary_ingredient`).
const WIRE_FACETS = ['cuisine', 'dish_type', 'ingredient'] as const;
type WireFacet = (typeof WIRE_FACETS)[number];
type DomainFacet = 'cuisine' | 'dish_type' | 'primary_ingredient';
const toDomainFacet = (f: WireFacet): DomainFacet => (f === 'ingredient' ? 'primary_ingredient' : f);
const toWireFacet = (f: DomainFacet): WireFacet => (f === 'primary_ingredient' ? 'ingredient' : f);

const affinitySelection = z.object({ facet: z.enum(WIRE_FACETS), value: z.string() });

/** `PUT /v1/preferences` body — the user-editable subset, snake_case over the wire. */
export const preferencesBodySchema = z.object({
  skill_level: z.enum(DIFFICULTY_BANDS),
  weekly_budget_cents: z.number().int().nonnegative().nullable(),
  time_budget_minutes: z.number().int().positive().nullable(),
  weekly_meals: WeeklyMealsSchema,
  // Per-meal time budget (WI-MP-1). Optional so pre-existing clients that don't send it
  // still validate; absent → null (engine falls back to time_budget_minutes).
  time_by_meal: TimeByMealSchema.nullable().optional(),
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

/** Domain model → wire DTO. Folds the food-pref facets into like/dislike lists over all facets. */
export function toPreferencesDTO(p: UserPreferences) {
  const selections = (sentiment: 'like' | 'dislike') =>
    p.foodPrefs.filter((f) => f.sentiment === sentiment).map((f) => ({ facet: toWireFacet(f.facet as DomainFacet), value: f.value }));
  return {
    skill_level: p.skillLevel,
    weekly_budget_cents: p.weeklyBudgetCents,
    time_budget_minutes: p.timeBudgetMinutes,
    weekly_meals: p.weeklyMeals,
    time_by_meal: p.timeByMeal,
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

/** Wire DTO → the repository's editable-subset input. */
export function fromPreferencesDTO(b: PreferencesBody): PreferencesUpdate {
  const toDomain = (s: { facet: WireFacet; value: string }) => ({ facet: toDomainFacet(s.facet), value: s.value });
  return {
    skillLevel: b.skill_level,
    weeklyBudgetCents: b.weekly_budget_cents,
    timeBudgetMinutes: b.time_budget_minutes,
    weeklyMeals: b.weekly_meals,
    timeByMeal: b.time_by_meal ?? null,
    likes: b.likes.map(toDomain),
    dislikes: b.dislikes.map(toDomain),
    allergens: b.allergens,
    diets: b.diets.map((d) => ({ dietId: d.diet, strictness: d.strictness })),
    ownedEquipment: b.owned_equipment,
    groceryStores: b.grocery_stores,
    household: { adults: b.household_adults, kids: b.household_kids },
    eatsLeftovers: b.eats_leftovers,
  };
}
