import { PreferenceRepository } from '../../repositories/preference-repository.js';
import type { FoodPrefUpdate, PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';

/**
 * Read-merge-FULL-upsert one member fact: reads the member's whole editable subset, applies a
 * single-fact mutation, then writes the FULL `PreferencesUpdate` back through `PreferenceRepository`
 * (which owns the transaction and the incidental gates — equipmentReviewed, leftovers meal-prep
 * seed). `savePreferences` full-replaces the caller-authored food-pref facets, so `base` must carry
 * the member's whole current `foodPrefs` array verbatim — every taste like/dislike AND every
 * food_category moderation, each with its `sentiment`/`target`/`reason` — or a single-fact write
 * would wipe the siblings it didn't touch. `mutate` is handed the current prefs and returns only the
 * slice it changes; everything else is carried over unchanged.
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
