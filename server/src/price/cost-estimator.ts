import type { Database } from '../db.js';
import { FdcFoodRepository } from '../nutrition/fdc-food-repository.js';
import { FoodMatcher } from '../nutrition/food-matcher.js';
import { QuantityConverter } from '../nutrition/quantity-converter.js';
import type { EstimatorIngredient } from '../nutrition/nutrition-estimator.js';
import { PriceRepository } from './price-repository.js';

// Ages PP-NAP's 2017–18 dollars to present USD: BLS CPI-U food-at-home (series
// CUUR0000SAF11) current ÷ 2017–18 average ≈ 1.3. Placeholder value — Q-02 is to pull
// the exact BLS ratio at build (no network here to fetch it).
// ponytail: single national CPI factor; per-region or newer-cycle re-seed if accuracy demands.
export const CPI_FACTOR = 1.3;

/** A recipe's cost estimate: absolute cents per serving + the priced fraction of gram-weight. */
export interface RecipeCost {
  centsPerServing: number;
  coverage: number;
}

/**
 * Estimates a recipe's cost-per-serving in USD cents — the nutrition path with the
 * nutrient lookup swapped for a price lookup. For each ingredient: `FoodMatcher.match`
 * → `QuantityConverter.toGrams` → `PriceRepository.pricePer100g`, then
 * `grams / 100 × price × CPI_FACTOR`. Sums only ingredients that matched, converted, AND
 * had a price; `coverage` is the priced fraction of the gram-weight we could convert.
 * Returns null when nothing matched-and-converted. No network — reads the seeded catalog.
 */
export class CostEstimator {
  private constructor(
    private readonly prices: PriceRepository,
    private readonly matcher: FoodMatcher,
    private readonly converter: QuantityConverter,
  ) {}

  static create(db: Database): CostEstimator {
    const repo = FdcFoodRepository.create(db);
    return new CostEstimator(PriceRepository.create(db), FoodMatcher.create(repo), QuantityConverter.create(repo));
  }

  /**
   * @param ingredients - the recipe's ingredients (name/amount/unit).
   * @param servings - the serving count to divide the dish total by (always ≥1 at ingest).
   * @returns cents-per-serving + coverage, or null when nothing matched and converted.
   */
  async estimate(ingredients: EstimatorIngredient[], servings: number): Promise<RecipeCost | null> {
    let totalUsd = 0;
    let pricedGrams = 0;
    let convertibleGrams = 0;

    for (const ing of ingredients) {
      const match = await this.matcher.match(ing.name);
      if (!match) continue;
      const grams = await this.converter.toGrams(ing.amount, ing.unit, match);
      if (!grams) continue;
      convertibleGrams += grams.grams;

      const price = await this.prices.pricePer100g(match.fdcId);
      if (price == null) continue;
      totalUsd += (grams.grams / 100) * Number(price) * CPI_FACTOR;
      pricedGrams += grams.grams;
    }

    if (convertibleGrams === 0) return null;
    return {
      centsPerServing: Math.round((totalUsd / servings) * 100),
      coverage: pricedGrams / convertibleGrams,
    };
  }
}
