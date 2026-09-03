import type { FoodPref } from '../models/user-preferences.js';
import type { RankableRecipe } from './types.js';
import { recipeMatches } from './directive-match.js';

/** The meal-slot scopes a plate rule can target — the slice of DIRECTIVE_SCOPES between `recipe`
 * (ranking) and `day`/`week` (aggregates). A directive at one of these completes a plate. */
export type MealSlotScope = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** A composed plate: the ranked main plus the sides added to satisfy meal-slot directives the main
 * missed. Persisted as `1..*` meal_plan_entries in the slot, ordered main-first by `position`. */
export interface Plate {
  main: RankableRecipe;
  sides: RankableRecipe[];
}

/** Whether a recipe is a side dish — the corpus plate completion draws from. Reuses the existing
 * `recipe_categories` dish_type facet; no new role column (design § Plate = main + optional sides). */
function isSideDish(recipe: RankableRecipe): boolean {
  return recipe.categories.dishType.includes('side_dish');
}

/**
 * Completes a plate: keeps the main, then for each meal-slot `more` directive the main doesn't
 * already carry, appends the first matching `side_dish` from the corpus. A good main is never
 * rejected — a missed rule adds a side, it doesn't drop the main (design § How scope enforces it).
 *
 * `less` slot directives don't complete a plate (you can't add a side to have *less* of something —
 * that's the ranker's job when it picks the main); only `more` appends.
 *
 * @param main - The chosen main (already ranked/eligible).
 * @param sideCorpus - Candidate side recipes to draw completions from.
 * @param directives - The household's food directives (any scope; only this slot's `more` ones bite).
 * @param slot - The plate's meal slot.
 * @returns The plate `{ main, sides }`; sides empty when the main covers every rule.
 */
export function completePlate(
  main: RankableRecipe,
  sideCorpus: RankableRecipe[],
  directives: FoodPref[],
  slot: MealSlotScope,
): Plate {
  const sides: RankableRecipe[] = [];
  const slotRules = directives.filter((d) => d.scope === slot && d.direction === 'more');
  for (const rule of slotRules) {
    if (recipeMatches(main, rule) || sides.some((s) => recipeMatches(s, rule))) continue;
    const side = sideCorpus.find((r) => isSideDish(r) && recipeMatches(r, rule) && !sides.includes(r));
    if (side) sides.push(side);
  }
  return { main, sides };
}
