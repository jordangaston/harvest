import type { Database } from '../db.js';
import { FdcFoodRepository } from './fdc-food-repository.js';
import { FoodMatcher } from './food-matcher.js';
import { QuantityConverter } from './quantity-converter.js';
import { nrfScore } from './nrf-score.js';
import { FDC_NUTRIENT, labelCoreForFdcNumber } from './fdc-nutrient.js';
import { LABEL_CORE_KEYS, type LabelCoreValues, type LabelCoreText } from '../models/label-core.js';

/** One ingredient to estimate from — the fields the matcher and converter read. */
export interface EstimatorIngredient {
  name: string;
  amount: string | null;
  unit: string | null;
}

/** The estimator's per-recipe result. Empty (`{}`) when withheld — no matches or no basis. */
export interface EstimateResult {
  nutrition?: { values: LabelCoreValues; estimated: boolean };
  nrfScore?: number;
}

/**
 * Composes matching + gram conversion + scoring into one estimate per recipe.
 * Matches each ingredient, converts to grams, aggregates the full nutrient panel
 * (Σ amountPer100g × grams / 100) into dish totals, then scores via `nrfScore`.
 * Estimates the eight per-serving macros only when the recipe has no parsed nutrition;
 * a parsed recipe keeps its macros but is still scored. Withholds (returns `{}`) when
 * nothing matches, or when servings are missing and there is no parsed nutrition.
 * No network — reads the seeded catalog through `FdcFoodRepository`.
 */
export class NutritionEstimator {
  private constructor(
    private readonly repo: FdcFoodRepository,
    private readonly matcher: FoodMatcher,
    private readonly converter: QuantityConverter,
  ) {}

  static create(db: Database): NutritionEstimator {
    const repo = FdcFoodRepository.create(db);
    return new NutritionEstimator(repo, FoodMatcher.create(repo), QuantityConverter.create(repo));
  }

  /**
   * @param ingredients - the recipe's ingredients (name/amount/unit).
   * @param servings - the serving count to divide dish totals by; null/≤0 withholds an estimate.
   * @param parsed - authoritative per-serving macros, when the source published them.
   * @returns the estimate + score, or `{}` when withheld.
   */
  async run(
    ingredients: EstimatorIngredient[],
    servings: number | null,
    parsed?: LabelCoreText,
  ): Promise<EstimateResult> {
    const totals = await this.aggregate(ingredients);
    if (totals.size === 0) return {}; // nothing matched — withhold entirely

    const calories = totals.get(FDC_NUTRIENT.calories) ?? 0;
    const score = nrfScore(totals, calories);
    const result: EstimateResult = {};
    if (score != null) result.nrfScore = score;

    if (parsed) {
      result.nutrition = { values: parsed, estimated: false };
      return result;
    }
    if (!(servings && servings > 0)) return { nrfScore: result.nrfScore }; // no basis to divide by

    result.nutrition = { values: this.macrosPerServing(totals, servings), estimated: true };
    return result;
  }

  /** Sums every matched, convertible ingredient's panel into dish totals (per 100 g basis). */
  private async aggregate(ingredients: EstimatorIngredient[]): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    for (const ing of ingredients) {
      const match = await this.matcher.match(ing.name);
      if (!match) continue;
      const grams = await this.converter.toGrams(ing.amount, ing.unit, match);
      if (!grams) continue;
      const panel = await this.repo.nutrients(match.fdcId);
      for (const [number, per100g] of panel) {
        totals.set(number, (totals.get(number) ?? 0) + (per100g * grams.grams) / 100);
      }
    }
    return totals;
  }

  /** Dish totals → the eight per-serving macros; a macro with no contribution stays null. */
  private macrosPerServing(totals: Map<string, number>, servings: number): LabelCoreValues {
    const values = {} as LabelCoreValues;
    for (const key of LABEL_CORE_KEYS) values[key] = null;
    for (const [number, total] of totals) {
      const key = labelCoreForFdcNumber(number);
      if (key) values[key] = String(total / servings);
    }
    return values;
  }
}
