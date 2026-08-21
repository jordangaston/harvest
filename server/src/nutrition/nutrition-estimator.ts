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

/** One persisted ingredient→FDC food match (taste overhaul), keyed by the ingredient
 * name so the repository can stamp it onto the right ingredient row. */
export interface IngredientMatch {
  name: string;
  fdcId: number;
  quality: 'high' | 'medium' | 'low';
}

/** The estimator's per-recipe result. `nutrition`/`nrfScore` are withheld when nothing
 * matches or there's no basis; `matches` carries every ingredient→food match found (for
 * ingredient-affinity persistence), independent of whether nutrition was withheld. */
export interface EstimateResult {
  nutrition?: { values: LabelCoreValues; estimated: boolean };
  nrfScore?: number;
  matches?: IngredientMatch[];
}

/**
 * Composes matching + gram conversion + scoring into one estimate per recipe.
 * Matches each ingredient, converts to grams, aggregates the full nutrient panel
 * (Σ amountPer100g × grams / 100) into dish totals, then scores via `nrfScore`.
 * Estimates the eight per-serving macros from ingredients; a recipe with parsed nutrition
 * keeps the macros the source published and backfills the ones it left blank from the
 * estimate (many sites publish calories only). Always scored. Withholds (returns `{}`) when
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
    const { totals, matches } = await this.aggregate(ingredients);
    const result = this.estimate(totals, servings, parsed);
    // The match set rides out on every path (even a withheld estimate) — it feeds
    // ingredient-affinity persistence, not nutrition.
    if (matches.length) result.matches = matches;
    return result;
  }

  /** The nutrition/NRF estimate from the aggregated dish totals (no matching side-effects). */
  private estimate(totals: Map<string, number>, servings: number | null, parsed?: LabelCoreText): EstimateResult {
    if (totals.size === 0) return {}; // nothing matched — withhold entirely

    const calories = totals.get(FDC_NUTRIENT.calories) ?? 0;
    const score = nrfScore(totals, calories);
    const result: EstimateResult = {};
    if (score != null) result.nrfScore = score;

    if (parsed) {
      // Keep the macros the source actually published; backfill the ones it left
      // 0/blank (many sites publish calories only) from the FDC estimate.
      const estimate = servings && servings > 0 ? this.macrosPerServing(totals, servings) : null;
      const { values, filled } = this.mergeParsed(parsed, estimate);
      result.nutrition = { values, estimated: filled };
      return result;
    }
    if (!(servings && servings > 0)) return { nrfScore: result.nrfScore }; // no basis to divide by

    result.nutrition = { values: this.macrosPerServing(totals, servings), estimated: true };
    return result;
  }

  /** Prefer each macro the source published (a positive value); backfill a 0/blank one
   * from the per-serving FDC estimate. `filled` is true when anything was backfilled, so
   * the result reads as `computed` (a hybrid) rather than a clean `parsed` panel. */
  private mergeParsed(parsed: LabelCoreText, estimate: LabelCoreValues | null): { values: LabelCoreValues; filled: boolean } {
    const values = {} as LabelCoreValues;
    let filled = false;
    for (const key of LABEL_CORE_KEYS) {
      const source = parsed[key];
      const sourceNum = source == null ? NaN : Number(source);
      if (Number.isFinite(sourceNum) && sourceNum > 0) {
        values[key] = source;
      } else if (estimate && estimate[key] != null) {
        values[key] = estimate[key];
        filled = true;
      } else {
        values[key] = source ?? null;
      }
    }
    return { values, filled };
  }

  /** Sums every matched, convertible ingredient's panel into dish totals (per 100 g basis),
   * and captures each ingredient→food match (deduped by name) for affinity persistence. A
   * match is captured even when its quantity can't be converted to grams (nutrition needs
   * grams; affinity only needs the matched food). */
  private async aggregate(
    ingredients: EstimatorIngredient[],
  ): Promise<{ totals: Map<string, number>; matches: IngredientMatch[] }> {
    const totals = new Map<string, number>();
    const matchByName = new Map<string, IngredientMatch>();
    for (const ing of ingredients) {
      const match = await this.matcher.match(ing.name);
      if (!match) continue;
      if (!matchByName.has(ing.name)) matchByName.set(ing.name, { name: ing.name, fdcId: match.fdcId, quality: match.quality });
      const grams = await this.converter.toGrams(ing.amount, ing.unit, match);
      if (!grams) continue;
      const panel = await this.repo.nutrients(match.fdcId);
      for (const [number, per100g] of panel) {
        totals.set(number, (totals.get(number) ?? 0) + (per100g * grams.grams) / 100);
      }
    }
    return { totals, matches: [...matchByName.values()] };
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
