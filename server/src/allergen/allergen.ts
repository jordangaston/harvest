import { MAJOR_ALLERGENS, ALLERGEN_PRESENCE } from '../schema';

export type Allergen = (typeof MAJOR_ALLERGENS)[number];
export type AllergenPresence = (typeof ALLERGEN_PRESENCE)[number];

export interface RecipeAllergens {
  presences: Partial<Record<Allergen, AllergenPresence>>;
  complete: boolean;
}

/** contains always wins over may_contain. */
export function mergePresence(a: AllergenPresence, b: AllergenPresence): AllergenPresence {
  return a === 'contains' || b === 'contains' ? 'contains' : 'may_contain';
}
