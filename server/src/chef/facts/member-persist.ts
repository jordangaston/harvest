import { PreferenceRepository } from '../../repositories/preference-repository.js';
import type { PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';
import type { AffinityFacet } from '../../schema.js';

/** A like/dislike selection, the shape `savePreferences` rebuilds the food-pref set from. */
export type Selection = { facet: AffinityFacet; value: string };

/** Splits resolved foodPrefs back into the like/dislike selection arrays. */
export function foodPrefsToLikesDislikes(prefs: UserPreferences): { likes: Selection[]; dislikes: Selection[] } {
  const likes = prefs.foodPrefs.filter((f) => f.sentiment === 'like').map((f) => ({ facet: f.facet, value: f.value }));
  const dislikes = prefs.foodPrefs.filter((f) => f.sentiment === 'dislike').map((f) => ({ facet: f.facet, value: f.value }));
  return { likes, dislikes };
}

/** Union two selection lists, de-duped on (facet, value). */
export function mergeSelections(a: Selection[], b: Selection[]): Selection[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((s) => {
    const key = `${s.facet}:${s.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Read-merge-FULL-upsert one member fact: reads the member's whole editable subset, applies a
 * single-fact mutation, then writes the FULL `PreferencesUpdate` back through `PreferenceRepository`
 * (which owns the transaction and the incidental gates — equipmentReviewed, leftovers meal-prep
 * seed). Writing one fact must not wipe its siblings, so `mutate` is handed the current prefs and
 * mutates only its slice; every other field is carried over verbatim.
 */
export async function mergeMemberFact(
  repo: PreferenceRepository,
  userId: string,
  mutate: (current: UserPreferences) => Partial<PreferencesUpdate>,
): Promise<void> {
  const current = await repo.getPreferences(userId);
  const food = foodPrefsToLikesDislikes(current);
  const base: PreferencesUpdate = {
    skillLevel: current.skillLevel,
    weeklyBudgetCents: current.weeklyBudgetCents,
    timeBudgetMinutes: current.timeBudgetMinutes,
    timeByMeal: current.timeByMeal,
    weeklyMeals: current.weeklyMeals,
    likes: food.likes,
    dislikes: food.dislikes,
    allergens: current.allergens,
    diets: current.diets,
    ownedEquipment: current.ownedEquipment,
    groceryStores: current.groceryStores,
    household: current.household,
    eatsLeftovers: current.eatsLeftovers,
  };
  await repo.savePreferences(userId, { ...base, ...mutate(current) });
}
