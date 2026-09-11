import { CUISINE_SLUGS } from './cuisines.js';

/**
 * VOCAB — the controlled vocabulary for the taste signal (WI-TS-2). Three allow-
 * lists, one per facet; every categorizer output must be a member. `cuisine` is derived
 * from the authored hierarchy in `cuisines-data.ts` (the single source of truth, also
 * seeded into the `cuisines` table) — meal/dish/primary stay code constants here.
 */
export const VOCAB = {
  cuisine: CUISINE_SLUGS,
  // WHEN it's eaten (Edamam mealType). Orthogonal to dishType — french toast is a
  // `breakfast` (meal) that in form is a `pancake`/`bread` (dish).
  mealType: ['breakfast', 'brunch', 'lunch', 'dinner', 'snack'],
  // The ROLE a dish plays in a meal — orthogonal to both mealType (when) and dishType (form).
  // Apple pie = course `dessert` + form `pie` + mealType `snack`. Split out of dishType so each
  // axis answers one question; `main_course` is the only course that stands alone as a meal.
  course: ['appetizer', 'main_course', 'side_dish', 'dessert'],
  // WHAT form the dish takes (Edamam dishType, cleaned to dish forms only — meal-timing moved to
  // mealType, meal role moved to course). snake_case for multi-word values.
  dishType: [
    'salad', 'soup', 'stew', 'bread', 'pancake', 'cereal', 'pastry', 'pie', 'pizza', 'pasta',
    'sandwich', 'taco', 'bowl', 'casserole', 'curry', 'stir_fry', 'cookie', 'ice_cream',
    // `cereal` = granola/muesli/oatmeal/porridge; `snack` = the portable snackable form a bar,
    // popcorn, or spiced nuts takes (distinct from mealType `snack`, which is WHEN it's eaten).
    // `condiment` = a rub/spice-blend/dressing/marinade/stock/component (Edamam "Preps"); `preserve`
    // = jam/pickle/preserve. A burger is a sandwich — folded into `sandwich`, no separate `burger`.
    'snack', 'sauce', 'condiment', 'preserve', 'beverage', 'cocktail', 'sushi',
  ],
  primaryIngredient: [
    'seafood', 'poultry', 'beef', 'pork', 'lamb', 'egg', 'cheese', 'tofu', 'beans', 'vegetable',
    'pasta', 'grain',
  ],
} as const;

export type Facet = keyof typeof VOCAB;

const SETS: Record<Facet, Set<string>> = {
  cuisine: new Set(VOCAB.cuisine),
  mealType: new Set(VOCAB.mealType),
  course: new Set(VOCAB.course),
  dishType: new Set(VOCAB.dishType),
  primaryIngredient: new Set(VOCAB.primaryIngredient),
};

/** Whether `value` is a member of the facet's controlled vocabulary. */
export function inVocab(facet: Facet, value: string): boolean {
  return SETS[facet].has(value);
}
