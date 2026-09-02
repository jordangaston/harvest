import { PreferenceRepository } from '../../repositories/preference-repository.js';
import type { FoodPrefUpdate, PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';

/**
 * Read-merge-FULL-upsert one member fact: reads the member's whole editable subset, applies a
 * single-fact mutation, then writes the FULL `PreferencesUpdate` back through `PreferenceRepository`
 * (which owns the transaction and the incidental gates — equipmentReviewed, leftovers meal-prep
 * seed). Food prefs are written targeted (via `upsertFoodPref`), NOT through here — but
 * `savePreferences` full-replaces the caller-authored food-pref facets, so an allergen/diet write
 * routed through this helper must still carry the member's whole current `foodPrefs` array verbatim
 * (every axis: `sentiment`/`target`/`reason`) or it would wipe the upsert-written siblings. `mutate`
 * is handed the current prefs and returns only the slice it changes; everything else carries over.
 */
export async function mergeMemberFact(
  repo: PreferenceRepository,
  userId: string,
  mutate: (current: UserPreferences) => Partial<PreferencesUpdate>,
): Promise<void> {
  const current = await repo.getPreferences(userId);
  const base: PreferencesUpdate = {
    skillLevel: current.skillLevel,
    weeklyBudgetCents: current.weeklyBudgetCents,
    timeBudgetMinutes: current.timeBudgetMinutes,
    timeByMeal: current.timeByMeal,
    weeklyMeals: current.weeklyMeals,
    foodPrefs: current.foodPrefs as FoodPrefUpdate[],
    allergens: current.allergens,
    diets: current.diets,
    ownedEquipment: current.ownedEquipment,
    groceryStores: current.groceryStores,
    household: current.household,
    eatsLeftovers: current.eatsLeftovers,
  };
  await repo.savePreferences(userId, { ...base, ...mutate(current) });
}
