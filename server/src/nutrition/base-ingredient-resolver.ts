import type { Database } from '../db.js';
import { FoodMatcher, type IngredientMatcher } from './food-matcher.js';
import { FdcFoodRepository } from './fdc-food-repository.js';

/**
 * Resolves free ingredient text to the curated base-ingredient cluster it rolls up to
 * (string → FDC food → `base_ingredient_id`) — the same tuned matcher recipes use, so
 * "grilled chicken"→Chicken and "salmon"→Fish. One resolver, shared by the `fact_types` grounding
 * and the `writeFact` persist paths so they always agree.
 */
export class BaseIngredientResolver {
  constructor(
    private readonly matcher: IngredientMatcher,
    private readonly fdc: FdcFoodRepository,
  ) {}

  static create(db: Database): BaseIngredientResolver {
    const fdc = FdcFoodRepository.create(db);
    return new BaseIngredientResolver(FoodMatcher.create(fdc), fdc);
  }

  /** The base-ingredient `{id,label}` for the text, or null if nothing clears the matcher's floor. */
  async resolve(text: string): Promise<{ id: string; label: string } | null> {
    const match = await this.matcher.match(text);
    return match ? this.fdc.baseIngredient(match.fdcId) : null;
  }
}
