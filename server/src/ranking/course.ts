import type { RankableRecipe } from './types.js';

/** Whether the recipe can stand as a lunch/dinner — reads the `course` facet directly: only a
 * `main_course` is a standalone meal (an appetizer/side/dessert isn't). Unknown course (empty) is
 * kept — we don't over-filter on missing data (a crème brûlée tagged `meal_type: dinner` with no
 * course still passes; the categorizer, not this filter, decides its role). */
export function isStandaloneMeal(recipe: RankableRecipe): boolean {
  const courses = recipe.categories.course;
  return courses.length === 0 || courses.includes('main_course');
}

/** Whether the meal-type context calls for mains only: a full meal is planned and snacks aren't.
 * Driven by the user's plan (or explicit Discover selection) — "I need lunch & dinner" ⇒ mains. */
export function wantsMainsOnly(mealTypes: string[]): boolean {
  return mealTypes.length > 0 && !mealTypes.includes('snack');
}
