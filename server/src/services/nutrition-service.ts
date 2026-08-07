import type { StructuredIngredient } from '../parse/ingredient.js';
import { FoodCatalog } from '../nutrition/food-catalog.js';
import {
  LABEL_CORE_KEYS,
  zeroLabelCore,
  toLabelCoreText,
  type Nutrition,
} from '../nutrition/label-core.js';

/** C5 computed path: per-serving label-core macros summed from the food catalog.
 * Marked `computed` only when enough ingredients resolve — a confident
 * understatement is worse than an honest "unknown". */
const COVERAGE_FLOOR = 0.6;

export class NutritionService {
  constructor(private readonly catalog: FoodCatalog) {}

  /** Wire the singleton food catalog. */
  static create(): NutritionService {
    return new NutritionService(FoodCatalog.create());
  }

  /**
   * Compute per-serving nutrition from structured ingredients, or null when
   * fewer than {@link COVERAGE_FLOOR} of them resolve to grams of a known food.
   * Unmatched ingredients contribute 0 and are logged — never fabricated.
   * @param ingredients - Structured ingredients (amount/unit may be null).
   * @param servings - Servings to divide by (already estimated if it was absent).
   * @returns The computed nutrition, or null below the coverage floor.
   */
  compute(ingredients: StructuredIngredient[], servings: number): Nutrition | null {
    if (ingredients.length === 0) return null;
    const total = zeroLabelCore();
    let covered = 0;

    for (const ing of ingredients) {
      const grams = this.gramsOf(ing);
      if (grams == null) {
        console.info(JSON.stringify({ event: 'nutrition.unmatched_ingredient', name: ing.name }));
        continue;
      }
      const food = this.catalog.matchFood(ing.name)!;
      const factor = grams / 100;
      for (const key of LABEL_CORE_KEYS) total[key] += food.per100g[key] * factor;
      covered++;
    }

    if (covered / ingredients.length < COVERAGE_FLOOR) return null;

    const perServing = zeroLabelCore();
    const divisor = Math.max(1, servings);
    for (const key of LABEL_CORE_KEYS) perServing[key] = total[key] / divisor;
    return { source: 'computed', values: toLabelCoreText(perServing) };
  }

  /** Grams contributed by one ingredient, or null when it can't be resolved. */
  private gramsOf(ing: StructuredIngredient): number | null {
    if (ing.amount == null) return null;
    const food = this.catalog.matchFood(ing.name);
    if (!food) return null;
    return this.catalog.toGrams(Number(ing.amount), ing.unit, food);
  }
}
