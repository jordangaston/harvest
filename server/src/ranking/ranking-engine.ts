import type { UserPreferences } from '../models/user-preferences.js';
import type { RankableRecipe, RankedRecipe } from './types.js';
import { type FilterRule, AllergenFilter, DietFilter, EquipmentFilter } from './filters.js';
import { type SignalScorer, AffinityScorer, PopularityScorer } from './scorers.js';
import { recipeMatches } from './directive-match.js';
import {
  PENALTY_MILD_ALLERGEN, PENALTY_FLEXIBLE_INCOMPATIBLE, PENALTY_UNKNOWN_VERDICT, PENALTY_MISSING_EQUIPMENT, DIRECTIVE_FACTOR,
} from './constants.js';

/** The four taste dimensions the AffinityScorer scores directly (strength-scaled). A soft/firm
 * directive on these is already in the base, so the modulation layer leaves them alone;
 * food_category/nutrient are affinity-blind, so the layer weights those. */
const AFFINITY_DIMENSIONS = new Set(['cuisine', 'dish_type', 'primary_ingredient', 'ingredient']);

/** Pure filter-then-rank engine: hard filters + strict directives drop recipes, an affinity+popularity
 * base scores survivors, and soft/firm recipe-scope directives modulate that base (D-06). */
export class RankingEngine {
  private constructor(
    private readonly filters: FilterRule[],
    private readonly scorers: SignalScorer[],
  ) {}

  static create(): RankingEngine {
    return new RankingEngine(
      [new AllergenFilter(), new DietFilter(), new EquipmentFilter()],
      [new AffinityScorer(), new PopularityScorer()],
    );
  }

  /** Hard-filter only: the recipes a user can actually eat (allergen/diet/equipment) plus strict
   * recipe-scope directives (a `less` excludes a match, a `more` requires one), before scoring.
   * Exposed so affinity sourcing can gate candidates on hard constraints *before* narrowing by taste. */
  eligible(recipes: RankableRecipe[], prefs: UserPreferences): RankableRecipe[] {
    return recipes.filter((r) => !this.filters.some((f) => f.excludes(r, prefs)) && !this.strictExcludes(r, prefs));
  }

  /** A `strict` recipe-scope directive is a filter: `less` drops a recipe that carries the value,
   * `more` drops one that doesn't (require). */
  private strictExcludes(recipe: RankableRecipe, prefs: UserPreferences): boolean {
    return prefs.foodPrefs.some((d) => {
      if (d.scope !== 'recipe' || d.strength !== 'strict') return false;
      const carries = recipeMatches(recipe, d);
      return d.direction === 'less' ? carries : !carries;
    });
  }

  rank(recipes: RankableRecipe[], prefs: UserPreferences): RankedRecipe[] {
    return this.eligible(recipes, prefs)
      .map((r) => this.scoreRecipe(r, prefs))
      .sort((a, b) => this.compare(a, b, recipes));
  }

  private scoreRecipe(recipe: RankableRecipe, prefs: UserPreferences): RankedRecipe {
    const breakdown: Record<string, number> = {};
    let sum = 0, count = 0;
    for (const scorer of this.scorers) {
      const s = scorer.score(recipe, prefs);
      if (s === null) continue;
      breakdown[scorer.key] = s;
      sum += s;
      count += 1;
    }
    const base = count > 0 ? sum / count : 0;
    const modulated = base * this.modulation(recipe, prefs);
    const score = Math.max(0, Math.min(1, modulated) - this.penalty(recipe, prefs));
    return { recipeId: recipe.id, score, breakdown };
  }

  /** The product of every matching soft/firm food_category/nutrient directive's factor. Taste
   * dimensions are already in the affinity base (strength-scaled), so they're skipped here. */
  private modulation(recipe: RankableRecipe, prefs: UserPreferences): number {
    let factor = 1;
    for (const d of prefs.foodPrefs)
      if (d.scope === 'recipe' && d.strength !== 'strict' && !AFFINITY_DIMENSIONS.has(d.dimension) && recipeMatches(recipe, d))
        factor *= DIRECTIVE_FACTOR[d.strength][d.direction];
    return factor;
  }

  private penalty(recipe: RankableRecipe, prefs: UserPreferences): number {
    let total = 0;
    for (const { allergen, severity } of prefs.allergens)
      if (severity === 'mild' && recipe.allergens.contains.includes(allergen)) total += PENALTY_MILD_ALLERGEN;
    for (const { dietId, strictness } of prefs.diets) {
      const verdict = recipe.dietFit[dietId];
      if (strictness === 'flexible' && verdict === 'incompatible') total += PENALTY_FLEXIBLE_INCOMPATIBLE;
      if (verdict === 'unknown') total += PENALTY_UNKNOWN_VERDICT;
    }
    if (prefs.equipmentReviewed && this.missingRecommendedEquipment(recipe, prefs)) total += PENALTY_MISSING_EQUIPMENT;
    return total;
  }

  /** Whether a reviewed user lacks any `recommended` (substitutable) gear the recipe suggests —
   * a flat once-per-recipe penalty. `required`-missing is the filter's job, not the penalty's. */
  private missingRecommendedEquipment(recipe: RankableRecipe, prefs: UserPreferences): boolean {
    const owned = new Set(prefs.ownedEquipment);
    return recipe.equipment.some(({ equipment, essentiality }) => essentiality === 'recommended' && !owned.has(equipment));
  }

  private compare(a: RankedRecipe, b: RankedRecipe, recipes: RankableRecipe[]): number {
    if (a.score !== b.score) return b.score - a.score;
    const ra = recipes.find((r) => r.id === a.recipeId)!;
    const rb = recipes.find((r) => r.id === b.recipeId)!;
    const coverage = Object.keys(b.breakdown).length - Object.keys(a.breakdown).length;
    if (coverage !== 0) return coverage;
    // null popularity sorts last; ?? -Infinity would make null−null = NaN, so compare explicitly.
    if (rb.popularity !== ra.popularity) return (rb.popularity ?? -Infinity) - (ra.popularity ?? -Infinity);
    const created = rb.createdAt.getTime() - ra.createdAt.getTime();
    if (created !== 0) return created;
    return ra.id < rb.id ? -1 : ra.id > rb.id ? 1 : 0;
  }
}
