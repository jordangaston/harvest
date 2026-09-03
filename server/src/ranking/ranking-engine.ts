import type { UserPreferences } from '../models/user-preferences.js';
import type { RankableRecipe, RankedRecipe } from './types.js';
import { type FilterRule, AllergenFilter, DietFilter, EquipmentFilter } from './filters.js';
import {
  type SignalScorer,
  CostScorer, DifficultyScorer, NutritionScorer, AffinityScorer, TimeScorer, PopularityScorer, MealPrepScorer,
} from './scorers.js';
import {
  PENALTY_MILD_ALLERGEN, PENALTY_FLEXIBLE_INCOMPATIBLE, PENALTY_UNKNOWN_VERDICT, PENALTY_MISSING_EQUIPMENT, MODERATION_PENALTY_MAX,
} from './constants.js';

/** Pure filter-then-rank engine: hard filters drop recipes, a weighted average of soft signals ranks survivors. */
export class RankingEngine {
  private constructor(
    private readonly filters: FilterRule[],
    private readonly scorers: SignalScorer[],
  ) {}

  static create(): RankingEngine {
    return new RankingEngine(
      [new AllergenFilter(), new DietFilter(), new EquipmentFilter()],
      [new CostScorer(), new DifficultyScorer(), new NutritionScorer(), new AffinityScorer(), new TimeScorer(), new PopularityScorer(), new MealPrepScorer()],
    );
  }

  /** Hard-filter only: the recipes a user can actually eat (allergen/diet/equipment), before scoring.
   * Exposed so affinity sourcing can gate candidates on hard constraints *before* narrowing by taste. */
  eligible(recipes: RankableRecipe[], prefs: UserPreferences): RankableRecipe[] {
    return recipes.filter((r) => !this.filters.some((f) => f.excludes(r, prefs)));
  }

  rank(recipes: RankableRecipe[], prefs: UserPreferences): RankedRecipe[] {
    return this.eligible(recipes, prefs)
      .map((r) => this.scoreRecipe(r, prefs))
      .sort((a, b) => this.compare(a, b, recipes));
  }

  private scoreRecipe(recipe: RankableRecipe, prefs: UserPreferences): RankedRecipe {
    const breakdown: Record<string, number> = {};
    let weighted = 0, totalWeight = 0;
    for (const scorer of this.scorers) {
      const w = scorer.weight(prefs);
      const s = scorer.score(recipe, prefs);
      if (s === null || w <= 0) continue;
      breakdown[scorer.key] = s;
      weighted += w * s;
      totalWeight += w;
    }
    const average = totalWeight > 0 ? weighted / totalWeight : 0;
    const score = Math.max(0, average - this.penalty(recipe, prefs));
    return { recipeId: recipe.id, score, breakdown };
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
    // Food-class moderation ("eat less of X"): a negative intent target on a food class the recipe
    // carries sinks it, scaled by intent magnitude. Positive target is inert this milestone (less-only).
    for (const p of prefs.foodPrefs)
      if (p.dimension === 'food_category' && p.target != null && p.target < 0 && recipe.categories.foodCategory.includes(p.value))
        total += MODERATION_PENALTY_MAX * -p.target;
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
