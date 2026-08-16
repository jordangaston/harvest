import type { FdcFoodRepository } from './fdc-food-repository.js';
import type { FoodMatch } from './food-matcher.js';

/** A converted quantity in grams, tagged with how confident the conversion is. */
export interface GramQuantity {
  grams: number;
  quality: 'high' | 'medium' | 'low';
}

// Mass → grams. Exact, so `quality: 'high'`. Keyed on both the parser's canonical spelled
// forms (ingredient.ts UNIT_ALIASES) and the short symbols the spec names.
const MASS_GRAMS: Record<string, number> = {
  g: 1, gram: 1,
  kg: 1000, kilogram: 1000,
  oz: 28.3495, ounce: 28.3495,
  lb: 453.592, pound: 453.592,
};

// Volume → millilitres. Converted to grams via a density, so `quality: 'medium'`.
const VOLUME_ML: Record<string, number> = {
  tsp: 4.929, teaspoon: 4.929,
  tbsp: 14.787, tablespoon: 14.787,
  cup: 240,
  ml: 1, milliliter: 1,
  l: 1000, liter: 1000,
};

// g/ml density keyed on the food's FNDDS category; default 1.0 (water) when unknown.
// tunable, widen if unmatched rate warrants — a handful of high-impact categories only.
const CATEGORY_DENSITY: Record<string, number> = {
  'Fats and oils': 0.92, // oils/butter — denser-than-water is wrong; fats float
};
const DEFAULT_DENSITY = 1.0;

// Count/no-unit fallback: grams per item keyed on a food-name token, when the food has
// no usable portion. tunable, widen if unmatched rate warrants.
const PER_ITEM_GRAMS: Record<string, number> = {
  egg: 50,
  onion: 110,
  clove: 3,
};

/** Portion descriptions that denote a single item ("1 large", "1 each", "1 breast",
 * "1 fillet") — as opposed to a measured portion ("1 cup", "1 oz"). */
const EACH_PORTION = /\b(each|large|medium|small|whole|breast|fillet|slice)\b/i;

/**
 * Converts a parsed `(amount, unit)` to grams (the catalog stores nutrients per 100g).
 * Mass is exact; volume uses a category density; count/no-unit uses a portion or a small
 * per-item table. Unconvertible inputs → null (the estimator drops them, doesn't guess).
 */
export class QuantityConverter {
  constructor(private readonly repo: FdcFoodRepository) {}

  static create(repo: FdcFoodRepository): QuantityConverter {
    return new QuantityConverter(repo);
  }

  /**
   * @param amount - the parsed numeric amount as text (StructuredIngredient.amount), or null.
   * @param unit - the parsed canonical unit, or null/empty for a count/no-unit line.
   * @param match - the matched food (its category picks a density; its portions cover counts).
   * @returns grams + a confidence tier, or null when the input can't be converted.
   */
  async toGrams(amount: string | null, unit: string | null, match: FoodMatch): Promise<GramQuantity | null> {
    const n = amount == null ? NaN : Number(amount);
    if (!Number.isFinite(n)) return null;
    const key = (unit ?? '').trim().toLowerCase();

    if (MASS_GRAMS[key] != null) return { grams: n * MASS_GRAMS[key], quality: 'high' };
    if (VOLUME_ML[key] != null) {
      const density = (match.category ? CATEGORY_DENSITY[match.category] : undefined) ?? DEFAULT_DENSITY;
      return { grams: n * VOLUME_ML[key] * density, quality: 'medium' };
    }
    if (key === '') return this.fromCount(n, match);
    return null; // unrecognized unit
  }

  /** Count/no-unit: prefer a per-item portion, else the per-item name table, else null. */
  private async fromCount(n: number, match: FoodMatch): Promise<GramQuantity | null> {
    const portions = await this.repo.portions(match.fdcId);
    const each = portions.find((p) => EACH_PORTION.test(p.description));
    if (each) return { grams: n * each.gramWeight, quality: 'low' };

    const description = await this.repo.descriptionNormalized(match.fdcId);
    for (const [token, grams] of Object.entries(PER_ITEM_GRAMS)) {
      if (description.includes(token)) return { grams: n * grams, quality: 'low' };
    }
    return null;
  }
}
