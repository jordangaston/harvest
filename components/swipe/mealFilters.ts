/**
 * Meal-type filter shared by the Discover deck (editable chips) and the onboarding warm-up
 * deck (pre-filtered to the user's plan). Each chip maps to the recipe_categories values it
 * selects, across the meal_type + dish_type facets — a recipe matches if it carries any.
 */
export const MEAL_FILTERS: { label: string; values: string[] }[] = [
  { label: "Mains", values: ["main_course"] },
  { label: "Breakfast", values: ["breakfast", "brunch"] },
  { label: "Lunch", values: ["lunch"] },
  { label: "Dinner", values: ["dinner"] },
  { label: "Snacks", values: ["snack", "appetizer"] },
  { label: "Salads", values: ["salad"] },
  { label: "Desserts", values: ["dessert", "cookie", "ice_cream", "pie"] },
  { label: "Drinks", values: ["beverage", "cocktail"] },
];

/** The meal slots the user plans (onboarding weekly_meals) → default chip selection. */
export function defaultMealSelection(weeklyMeals?: Record<string, number>): string[] {
  const slots: [string, string][] = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snacks"]];
  const sel = slots.filter(([slot]) => (weeklyMeals?.[slot] ?? 0) > 0).map(([, label]) => label);
  return sel.length ? sel : ["Dinner"];
}

/** Flatten selected chip labels to the category values the deck endpoint filters on. */
export function categoriesForSelection(selected: string[]): string[] {
  return MEAL_FILTERS.filter((m) => selected.includes(m.label)).flatMap((m) => m.values);
}
