import type { ApiPreferences, ApiFoodPref } from "./preferences.ts";
import { DEFAULT_PREFERENCES, type Preferences, type TasteFacet } from "../../components/swipe/mock.ts";

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
  "oven", "stovetop", "microwave", "air_fryer", "slow_cooker", "pressure_cooker", "stand_mixer", "blender",
  "food_processor", "grill", "dutch_oven", "deep_fryer", "wok", "sous_vide", "smoker", "ice_cream_maker", "waffle_iron",
]);

/** Whether a wire facet is one the taste picker edits (cuisine/dish_type/ingredient) — used to
 *  split the unified food_prefs array back into like/dislike chip groups. */
const isTasteFacet = (f: string): f is TasteFacet => f === "cuisine" || f === "dish_type" || f === "ingredient";

/** A legacy scalar time budget → equal per-meal budgets (the backfill's client mirror). */
const broadcastTime = (min: number | null): Preferences["timeByMeal"] => {
  const t = min ?? DEFAULT_PREFERENCES.timeByMeal.breakfast;
  return { breakfast: t, lunch: t, dinner: t };
};

/** Server DTO → the client `Preferences` the settings screen seeds from. */
export function apiToClient(a: ApiPreferences): Preferences {
  return {
    skillLevel: a.skill_level,
    weeklyBudgetCents: a.weekly_budget_cents ?? DEFAULT_PREFERENCES.weeklyBudgetCents,
    // Prefer the per-meal budgets; fall back to broadcasting the legacy scalar across all three.
    timeByMeal: a.time_by_meal ?? broadcastTime(a.time_budget_minutes),
    weeklyMeals: a.weekly_meals,
    weights: DEFAULT_PREFERENCES.weights, // server-owned (D-10); not surfaced in settings
    // Split the one food_prefs array back into the settings screen's three views: taste likes
    // (a picker facet + sentiment=like), taste dislikes (sentiment=dislike), and food-class
    // moderations (facet=food_category + a target). A pure moderation carries no sentiment.
    likes: a.food_prefs.filter((f) => f.sentiment === "like" && isTasteFacet(f.facet)).map((f) => ({ facet: f.facet as TasteFacet, value: f.value })),
    dislikes: a.food_prefs.filter((f) => f.sentiment === "dislike" && isTasteFacet(f.facet)).map((f) => ({ facet: f.facet as TasteFacet, value: f.value })),
    moderation: a.food_prefs.filter((f) => f.facet === "food_category" && f.target != null).map((f) => ({ value: f.value, target: f.target as number, reason: f.reason })),
    allergens: a.allergens.map((x) => ({ allergen: ALLERGEN_TO_CLIENT[x.allergen] ?? x.allergen, severity: x.severity })),
    diets: a.diets.map((d) => ({ diet: d.diet, strictness: d.strictness })),
    ownedEquipment: a.owned_equipment,
    equipmentReviewed: true,
    groceryStores: a.grocery_stores,
    household: { adults: a.household_adults, kids: a.household_kids },
    eatsLeftovers: a.eats_leftovers,
  };
}

/** Client `Preferences` → the server DTO a settings Save sends. */
export function clientToApi(p: Preferences): ApiPreferences {
  return {
    skill_level: p.skillLevel,
    weekly_budget_cents: p.weeklyBudgetCents,
    // Server derives the scalar from time_by_meal, but keep it populated (= max) for back-compat.
    time_budget_minutes: Math.max(p.timeByMeal.breakfast, p.timeByMeal.lunch, p.timeByMeal.dinner),
    time_by_meal: p.timeByMeal,
    weekly_meals: p.weeklyMeals,
    // Assemble the three settings views into the one unified array the server expects. A moderation
    // at target 0 ("neither more nor less") is dropped — it carries no signal and would fail the
    // server's ≥1-axis check.
    food_prefs: [
      ...p.likes.map((t): ApiFoodPref => ({ facet: t.facet, value: t.value, sentiment: "like" })),
      ...p.dislikes.map((t): ApiFoodPref => ({ facet: t.facet, value: t.value, sentiment: "dislike" })),
      ...p.moderation.filter((m) => m.target !== 0).map((m): ApiFoodPref => ({ facet: "food_category", value: m.value, target: m.target, reason: m.reason ?? null })),
    ],
    allergens: p.allergens.map((x) => ({ allergen: ALLERGEN_TO_SERVER[x.allergen] ?? x.allergen, severity: x.severity })),
    diets: p.diets.map((d) => ({ diet: d.diet, strictness: d.strictness })),
    owned_equipment: p.ownedEquipment.filter((e) => SERVER_EQUIPMENT.has(e)),
    grocery_stores: p.groceryStores,
    household_adults: p.household.adults,
    household_kids: p.household.kids,
    eats_leftovers: p.eatsLeftovers,
  };
}
