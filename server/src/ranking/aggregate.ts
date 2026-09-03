import type { FoodPref } from '../models/user-preferences.js';
import type { RankableRecipe } from './types.js';
import { recipeMatches } from './directive-match.js';
import { NUTRIENT_PANEL_COLUMN } from '../nutrition/nutrient-catalog.js';

/** The aggregate scopes a running budget spans — the day/week slice of DIRECTIVE_SCOPES. */
export type AggregateScope = 'day' | 'week';

/** A day/week directive checked against the meals planned in its scope. `actual` is the running
 * total (meals bearing the value for `count`, summed panel field for a nutrient unit); `met` is
 * whether it satisfies the target under the directive's `direction` comparator. */
export interface AggregateCheck {
  met: boolean;
  actual: number;
  target: number;
  unit: string;
}

/**
 * Checks a day/week directive against the scope's meals. `unit='count'` counts the **meals** bearing
 * the value (a `food_category`/ingredient/etc. the recipe carries); a nutrient unit **sums** that
 * nutrient's per-serving panel field over the meals (a null macro contributes 0). `direction` sets
 * the comparator: `less+target` = at most (met when `actual <= target`), `more+target` = at least.
 *
 * A meal here is one `RankableRecipe` — pass a plate's recipes to include its sides in the total.
 * Reconciling an already-blown aggregate (re-roll/swap) is meal-plan generation, out of scope.
 *
 * @param meals - The recipes planned in the directive's scope (a day's or week's worth).
 * @param directive - A `day`/`week` directive; must carry `target` and `unit`.
 * @returns The running total and whether it meets the target.
 * @throws {Error} if the directive lacks a numeric `target` (an aggregate directive always has one).
 */
export function checkAggregate(meals: RankableRecipe[], directive: FoodPref): AggregateCheck {
  if (directive.target == null) throw new Error('checkAggregate: aggregate directive needs a target');
  const unit = directive.unit ?? 'count';
  const actual = unit === 'count' ? countMeals(meals, directive) : sumNutrient(meals, directive.value);
  const met = directive.direction === 'less' ? actual <= directive.target : actual >= directive.target;
  return { met, actual, target: directive.target, unit };
}

/** Number of meals bearing the directive's value. */
function countMeals(meals: RankableRecipe[], directive: FoodPref): number {
  return meals.filter((m) => recipeMatches(m, directive)).length;
}

/** Sum of a nutrient's per-serving panel field over the meals (absent macro = 0). */
function sumNutrient(meals: RankableRecipe[], value: string): number {
  const column = NUTRIENT_PANEL_COLUMN[value];
  if (column === undefined) return 0;
  return meals.reduce((total, m) => total + (m.nutrition[column] ?? 0), 0);
}
