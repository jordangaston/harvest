/**
 * VOCAB — the controlled vocabulary for the taste signal (WI-TS-2). Three allow-
 * lists, one per facet; every categorizer output must be a member. A code constant,
 * not a table, so revising it is a code change (design decision). Seed values are
 * the design's proposed lists (Q-01), pending founder sign-off — revise here.
 */
export const VOCAB = {
  cuisine: [
    'american', 'british', 'caribbean', 'chinese', 'eastern_european', 'french', 'greek', 'indian',
    'italian', 'japanese', 'korean', 'mediterranean', 'mexican', 'middle_eastern', 'southeast_asian',
    'south_american', 'spanish', 'thai',
  ],
  dishType: [
    'pasta', 'pizza', 'soup', 'stew', 'salad', 'sandwich', 'burger', 'taco', 'curry', 'stir_fry',
    'bowl', 'casserole', 'bread', 'dessert', 'main_course', 'side_dish',
  ],
  primaryIngredient: [
    'seafood', 'poultry', 'beef', 'pork', 'lamb', 'egg', 'cheese', 'tofu', 'beans', 'vegetable',
    'pasta', 'grain',
  ],
} as const;

export type Facet = keyof typeof VOCAB;

const SETS: Record<Facet, Set<string>> = {
  cuisine: new Set(VOCAB.cuisine),
  dishType: new Set(VOCAB.dishType),
  primaryIngredient: new Set(VOCAB.primaryIngredient),
};

/** Whether `value` is a member of the facet's controlled vocabulary. */
export function inVocab(facet: Facet, value: string): boolean {
  return SETS[facet].has(value);
}
