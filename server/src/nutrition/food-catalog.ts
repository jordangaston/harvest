import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LabelCore } from './label-core.js';

/**
 * C5a: an in-memory USDA food catalog for nutrition compute — no DB table, no
 * network. Loaded once from a committed curated `server/seed/foods.json`. Matching
 * is lexical + an alias table + a bounded Sørensen–Dice bigram fallback (NOT
 * embeddings), so it rewards shared spelling, not semantic neighborhood — "cream"
 * will not match "ice cream".
 */

/** A catalog food: canonical name, synonyms, per-100 g label core, and portions. */
export interface Food {
  name: string;
  aliases: string[];
  per100g: LabelCore;
  portions: { unit: string; grams: number }[];
}

/** The matcher seam — swap the strategy without touching NutritionService. */
export interface FoodMatcher {
  matchFood(name: string): Food | null;
}

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../seed/foods.json');

// Weight units convert to grams independent of the food.
const WEIGHT_GRAMS: Record<string, number> = {
  gram: 1,
  kilogram: 1000,
  ounce: 28.3495,
  pound: 453.592,
};

// Water-like volumetric fallback (≈1 g/ml) — used ONLY for genuinely water-like
// liquids when the food carries no portion for the unit (Architect M4).
const WATER_VOLUME_GRAMS: Record<string, number> = {
  teaspoon: 4.93,
  tablespoon: 14.79,
  cup: 236.6,
  milliliter: 1,
  liter: 1000,
};
const WATER_LIKE = /\b(water|broth|stock|milk|juice)\b/;

// Descriptor/prep words dropped during normalization (they aren't the food).
const STOP_WORDS = new Set([
  'fresh', 'chopped', 'minced', 'diced', 'sliced', 'raw', 'cooked', 'large', 'small',
  'medium', 'finely', 'roughly', 'ground', 'optional', 'peeled', 'grated', 'shredded',
  'crushed', 'whole', 'boneless', 'skinless', 'ripe', 'cold', 'warm', 'softened', 'melted',
  'clove', 'cloves', 'can', 'cans', 'package', 'packages', 'pinch',
]);
const STOP_PHRASES = /\b(to taste|for garnish|for serving|room temperature|at room temperature)\b/g;

/** Naive singular: handles -ies, -oes, and plain trailing -s (not -ss). */
function singularize(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 3 && token.endsWith('oes')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Normalize a name to comparable tokens: lowercase, de-punctuate, drop stop
 * words/numbers/units, singularize. */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(STOP_PHRASES, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
    .map(singularize)
    .filter((t) => !STOP_WORDS.has(t));
}

/** Sørensen–Dice coefficient over character bigrams of two strings. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const count = bigrams.get(g) ?? 0;
    if (count > 0) {
      intersection++;
      bigrams.set(g, count - 1);
    }
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/** A food plus its precomputed normalized candidates (canonical + aliases). */
interface IndexedFood {
  food: Food;
  canonicalTokens: string[];
  candidates: string[]; // normalized "name" strings for exact + fuzzy
}

export class FoodCatalog implements FoodMatcher {
  private readonly index: IndexedFood[];

  constructor(foods: Food[]) {
    this.index = foods.map((food) => {
      const names = [food.name, ...food.aliases];
      return {
        food,
        canonicalTokens: normalizeTokens(food.name),
        candidates: names.map((n) => normalizeTokens(n).join(' ')).filter(Boolean),
      };
    });
  }

  /** Wire the singleton from the committed seed file (loaded once). */
  static create(): FoodCatalog {
    const foods = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Food[];
    return new FoodCatalog(foods);
  }

  /**
   * Match an ingredient name to a catalog food, or null if none is confident.
   * Tiers: exact canonical/alias → head-noun/token-subset → Dice bigram ≥ 0.8.
   * @param name - The ingredient name (already measurement-stripped upstream).
   */
  matchFood(name: string): Food | null {
    const tokens = normalizeTokens(name);
    if (tokens.length === 0) return null;
    const query = tokens.join(' ');

    for (const entry of this.index) {
      if (entry.candidates.includes(query)) return entry.food;
    }

    let bestSubset: IndexedFood | null = null;
    for (const entry of this.index) {
      const ct = entry.canonicalTokens;
      if (ct.length > 0 && ct.every((t) => tokens.includes(t))) {
        if (!bestSubset || ct.length > bestSubset.canonicalTokens.length) bestSubset = entry;
      }
    }
    if (bestSubset) return bestSubset.food;

    let best: { food: Food; score: number } | null = null;
    for (const entry of this.index) {
      for (const candidate of entry.candidates) {
        const score = diceCoefficient(query, candidate);
        if (!best || score > best.score) best = { food: entry.food, score };
      }
    }
    return best && best.score >= 0.8 ? best.food : null;
  }

  /**
   * Convert an amount+unit of a food to grams, or null when it can't be resolved.
   * Weight units are direct; volume/count go through the food's portions; a
   * water-like liquid with no portion uses the ≈1 g/ml fallback; a dry-goods
   * volume with no portion returns null (unmatched — never a water guess).
   */
  toGrams(amount: number, unit: string | null, food: Food): number | null {
    if (unit && WEIGHT_GRAMS[unit] != null) return amount * WEIGHT_GRAMS[unit];

    const portionUnit = unit ?? 'count';
    const portion = food.portions.find((p) => p.unit === portionUnit);
    if (portion) return amount * portion.grams;

    if (unit && WATER_VOLUME_GRAMS[unit] != null && this.isWaterLike(food)) {
      return amount * WATER_VOLUME_GRAMS[unit];
    }
    return null;
  }

  private isWaterLike(food: Food): boolean {
    return WATER_LIKE.test(food.name) || food.aliases.some((a) => WATER_LIKE.test(a));
  }
}
