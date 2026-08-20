import type { ApiPreferences } from "./preferences";
import { DEFAULT_PREFERENCES, type Preferences } from "../../components/swipe/mock";

/**
 * Maps between the client `Preferences` (display labels the settings UI uses) and the server's
 * canonical `ApiPreferences` DTO. The two disagree on a few enum spellings (allergens) and the
 * client offers equipment the server doesn't model yet — handled here so the UI stays declarative.
 */

// Client allergen label ↔ server enum. Server-only "sesame" round-trips as itself.
const ALLERGEN_TO_SERVER: Record<string, string> = {
  "tree nut": "tree_nut", soy: "soybean", shellfish: "crustacean_shellfish",
};
const ALLERGEN_TO_CLIENT: Record<string, string> = {
  tree_nut: "tree nut", soybean: "soy", crustacean_shellfish: "shellfish",
};

// The equipment the server enum models. The settings list is reconciled to exactly this set, so the
// filter below is a no-op safety net (a stray unknown type would be dropped rather than 422 a PUT).
const SERVER_EQUIPMENT = new Set([
  "air_fryer", "slow_cooker", "pressure_cooker", "stand_mixer", "blender", "food_processor",
  "grill", "dutch_oven", "deep_fryer", "wok", "sous_vide", "smoker", "ice_cream_maker", "waffle_iron",
]);

/** Server DTO → the client `Preferences` the settings screen seeds from. */
export function apiToClient(a: ApiPreferences): Preferences {
  return {
    skillLevel: a.skill_level,
    weeklyBudgetCents: a.weekly_budget_cents ?? DEFAULT_PREFERENCES.weeklyBudgetCents,
    timeBudgetMin: a.time_budget_minutes ?? DEFAULT_PREFERENCES.timeBudgetMin,
    weeklyMeals: a.weekly_meals,
    weights: DEFAULT_PREFERENCES.weights, // server-owned (D-10); not surfaced in settings
    likedCuisines: a.liked_cuisines,
    dislikedIngredients: a.disliked_ingredients,
    allergens: a.allergens.map((x) => ({ allergen: ALLERGEN_TO_CLIENT[x.allergen] ?? x.allergen, severity: x.severity })),
    diets: a.diets.map((d) => ({ diet: d.diet, strictness: d.strictness })),
    ownedEquipment: a.owned_equipment,
    equipmentReviewed: true,
  };
}

/** Client `Preferences` → the server DTO a settings Save sends. */
export function clientToApi(p: Preferences): ApiPreferences {
  return {
    skill_level: p.skillLevel,
    weekly_budget_cents: p.weeklyBudgetCents,
    time_budget_minutes: p.timeBudgetMin,
    weekly_meals: p.weeklyMeals,
    liked_cuisines: p.likedCuisines,
    disliked_ingredients: p.dislikedIngredients,
    allergens: p.allergens.map((x) => ({ allergen: ALLERGEN_TO_SERVER[x.allergen] ?? x.allergen, severity: x.severity })),
    diets: p.diets.map((d) => ({ diet: d.diet, strictness: d.strictness })),
    owned_equipment: p.ownedEquipment.filter((e) => SERVER_EQUIPMENT.has(e)),
  };
}
