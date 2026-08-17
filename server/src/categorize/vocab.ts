/**
 * VOCAB — the controlled vocabulary for the taste signal (WI-TS-2). Three allow-
 * lists, one per facet; every categorizer output must be a member. A code constant,
 * not a table, so revising it is a code change (design decision). Seed values are
 * the design's proposed lists (Q-01), pending founder sign-off — revise here.
 */
export const VOCAB = {
  cuisine: [
    'american', 'british', 'caribbean', 'chinese', 'eastern_european', 'french', 'greek', 'indian',
    'italian', 'japanese', 'korean', 'mediterranean', 'mexican', 'middle_eastern', 'nordic',
    'southeast_asian', 'south_american', 'spanish', 'thai',
  ],
  // WHEN it's eaten (Edamam mealType). Orthogonal to dishType — french toast is a
  // `breakfast` (meal) that in form is a `pancake`/`bread` (dish).
  mealType: ['breakfast', 'brunch', 'lunch', 'dinner', 'snack'],
  // WHAT form the dish takes (Edamam dishType, cleaned to dish forms only — meal-timing
  // moved to mealType). snake_case for multi-word values.
  dishType: [
    'main_course', 'side_dish', 'appetizer', 'salad', 'soup', 'stew', 'bread', 'pancake', 'pastry',
    'pie', 'pizza', 'pasta', 'sandwich', 'burger', 'taco', 'bowl', 'casserole', 'curry', 'stir_fry',
    'dessert', 'cookie', 'ice_cream', 'sauce', 'beverage', 'cocktail',
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
  dishType: new Set(VOCAB.dishType),
  primaryIngredient: new Set(VOCAB.primaryIngredient),
};

/** Whether `value` is a member of the facet's controlled vocabulary. */
export function inVocab(facet: Facet, value: string): boolean {
  return SETS[facet].has(value);
}
