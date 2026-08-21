import type { Database } from '../db.js';
import { VOCAB } from '../categorize/vocab.js';
import { CUISINE_LABEL } from '../categorize/cuisines.js';
import { TasteIngredientRepository } from '../repositories/taste-ingredient-repository.js';

/** The taste-picker catalog: three facets the onboarding/settings picker renders. */
export interface TasteOptions {
  cuisines: { value: string; label: string }[];
  dish_types: { value: string; label: string }[];
  ingredients: { value: string; label: string; section: string }[];
}

/** slug → display label (`stir_fry` → `Stir Fry`) for the code-vocab facets. */
function labelFor(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Assembles the `GET /v1/taste-options` catalog by merging the code VOCAB (cuisines + dish
 * types) with the curated `taste_ingredients` rows. Cuisines and dish types reuse the facets
 * already classified on recipes; only the ingredient facet is new. Offline (no network).
 */
export class TasteOptionsService {
  constructor(private readonly ingredients: TasteIngredientRepository) {}

  static create(db: Database): TasteOptionsService {
    return new TasteOptionsService(TasteIngredientRepository.create(db));
  }

  /** The full catalog: cuisines/dish types from VOCAB (labels derived), ingredients from the DB. */
  async options(): Promise<TasteOptions> {
    const ingredients = await this.ingredients.ingredients();
    return {
      cuisines: VOCAB.cuisine.map((value) => ({ value, label: CUISINE_LABEL[value] ?? labelFor(value) })),
      dish_types: VOCAB.dishType.map((value) => ({ value, label: labelFor(value) })),
      ingredients,
    };
  }
}
