import type { Database } from '../db.js';
import type { StructuredIngredient } from '../parse/ingredient.js';
import { FdcFoodRepository } from '../nutrition/fdc-food-repository.js';
import { FoodMatcher } from '../nutrition/food-matcher.js';
import { AllergenRepository } from './allergen-repository.js';
import { mergePresence, type Allergen, type AllergenPresence, type RecipeAllergens } from './allergen.js';

/**
 * Detects a recipe's allergen signal by reusing the nutrition match pass: `FoodMatcher`
 * recognizes each ingredient and resolves its `fdc_id`; `fdc_food_allergen` supplies the
 * allergen set. Safety-adjacent — an ingredient we cannot match adds no positive and drops
 * `complete` to false, so its allergens read *undetermined*, never *absent*.
 */
export class AllergenDetector {
  private constructor(
    private readonly matcher: FoodMatcher,
    private readonly allergens: AllergenRepository,
  ) {}

  static create(db: Database): AllergenDetector {
    return new AllergenDetector(FoodMatcher.create(FdcFoodRepository.create(db)), AllergenRepository.create(db));
  }

  /**
   * @param ingredients - the recipe's structured ingredients.
   * @returns the merged allergen profile, or `null` when there are no ingredients to reason about.
   */
  async detect(ingredients: StructuredIngredient[]): Promise<RecipeAllergens | null> {
    if (ingredients.length === 0) return null;

    const presences: Partial<Record<Allergen, AllergenPresence>> = {};
    let complete = true;

    for (const ingredient of ingredients) {
      const match = await this.matcher.match(ingredient.name);
      const recognized = match !== null && (match.quality === 'high' || match.quality === 'medium');
      if (!recognized) {
        complete = false;
        continue;
      }
      for (const hit of await this.allergens.allergensFor(match.fdcId)) {
        // A medium-quality match is uncertain, so it caps at `may_contain` (softening `contains`).
        const effective: AllergenPresence = match.quality === 'medium' ? 'may_contain' : hit.presence;
        const prev = presences[hit.allergen];
        presences[hit.allergen] = prev ? mergePresence(prev, effective) : effective;
      }
    }

    return { presences, complete };
  }
}
