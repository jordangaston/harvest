import type { RankableRecipe } from './types.js';

/** Dish forms that are never a standalone meal — sides, breads, sweets, drinks, accompaniments.
 * A dinner roll or crème brûlée is legitimately tagged `meal_type: dinner`, but it isn't a dinner. */
const NON_MEAL_DISH_TYPES = new Set([
  'side_dish', 'appetizer', 'bread', 'pastry', 'dessert', 'cookie', 'ice_cream', 'sauce', 'beverage', 'cocktail',
]);

/** True unless the recipe is *only* a side/dessert/drink — i.e. it can stand as a lunch/dinner.
 * Unknown dish type (empty) is kept: we don't over-filter on missing data. */
export function isStandaloneMeal(recipe: RankableRecipe): boolean {
  const dishTypes = recipe.categories.dishType;
  return dishTypes.length === 0 || dishTypes.some((d) => !NON_MEAL_DISH_TYPES.has(d));
}

/** Whether the meal-type context calls for mains only: a full meal is planned and snacks aren't.
 * Driven by the user's plan (or explicit Discover selection) — "I need lunch & dinner" ⇒ mains. */
export function wantsMainsOnly(mealTypes: string[]): boolean {
  return mealTypes.length > 0 && !mealTypes.includes('snack');
}
