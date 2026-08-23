import type { MealSlot } from '../schema.js';
import type { Database } from '../db.js';
import type { UserPreferences } from '../models/user-preferences.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { CookbookRepository } from '../repositories/cookbook-repository.js';
import { MealPlanRepository } from '../repositories/meal-plan-repository.js';
import { RankingEngine } from '../ranking/ranking-engine.js';
import { SingleUserAggregator } from './score-aggregator.js';
import type { CandidateRecipe, ScoreAggregator, Tier } from './types.js';
import { TIER_BONUS, MEAL_COOLDOWN_DAYS } from './constants.js';

/** A meal slot → the recipe `meal_type` facet values that fill it (brunch counts as breakfast). */
const MEAL_TYPE_VALUES: Record<MealSlot, string[]> = {
  breakfast: ['breakfast', 'brunch'],
  lunch: ['lunch'],
  dinner: ['dinner'],
  snack: ['snack'],
};

/**
 * Builds the ranked, tiered, recency-clean candidate pool for a meal type (WI-MP-2 O-01) — the single
 * chokepoint where the corpus becomes engine-ready, so no filler re-implements loading or filtering.
 * Reuses the ranking engine verbatim (its hard filters drop allergen/diet/equipment mismatches).
 */
export class CandidateProvider {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly cookbooks: CookbookRepository,
    private readonly mealPlan: MealPlanRepository,
    private readonly ranking: RankingEngine,
    private readonly aggregator: ScoreAggregator,
  ) {}

  static create(db: Database): CandidateProvider {
    return new CandidateProvider(
      RecipeRepository.create(db),
      CookbookRepository.create(db),
      MealPlanRepository.create(db),
      RankingEngine.create(),
      SingleUserAggregator.create(),
    );
  }

  /**
   * The candidate pool for one meal type, sorted by `baseScore` (tier bonus + ranking score) desc.
   * @param userId - The planner.
   * @param meal - The slot's meal type.
   * @param prefs - The user's resolved ranking preferences.
   * @param cooldownDays - Days a recently-cooked recipe stays out of the pool (default MEAL_COOLDOWN_DAYS).
   */
  async candidates(userId: string, meal: MealSlot, prefs: UserPreferences, cooldownDays = MEAL_COOLDOWN_DAYS): Promise<CandidateRecipe[]> {
    const [pool, owned, liked, saved, recent] = await Promise.all([
      this.recipes.listDeckCandidates(userId, MEAL_TYPE_VALUES[meal]),
      this.ownedIds(userId),
      this.cookbookIds(userId, 'liked', 'Liked'),
      this.cookbookIds(userId, 'saved', 'Saved'),
      this.recentlyCooked(userId, cooldownDays),
    ]);
    const byId = new Map(pool.map((p) => [p.recipe.id, p.recipe]));
    const ranked = this.ranking.rank(pool.map((p) => p.recipe), prefs);

    const out: CandidateRecipe[] = [];
    for (const { recipeId, score } of ranked) {
      if (recent.has(recipeId)) continue;
      const r = byId.get(recipeId)!;
      const tier = tierFor(recipeId, owned, liked, saved);
      out.push({
        recipeId,
        tier,
        baseScore: TIER_BONUS[tier] + this.aggregator.aggregate([score]),
        costPerServingCents: r.costPerServingCents,
        totalMinutes: r.totalMinutes,
        mealPrepFit: r.mealPrepFit,
        categories: r.categories,
        familiar: tier !== 'global', // owned/endorsed = familiar; an untouched global = new (P3)
      });
    }
    return out.sort((a, b) => b.baseScore - a.baseScore);
  }

  private async ownedIds(userId: string): Promise<Set<string>> {
    const owned = await this.recipes.listRankable(userId);
    return new Set(owned.map((o) => o.recipe.id));
  }

  private async cookbookIds(userId: string, slug: string, name: string): Promise<Set<string>> {
    const cookbookId = await this.cookbooks.ensureSystemCookbook(userId, slug, name);
    const cb = await this.cookbooks.getForUser(userId, cookbookId);
    return new Set((cb?.recipes ?? []).map((r) => r.id));
  }

  /** Recipe ids cooked in the last `cooldownDays` (up to today) — the cross-week recency exclusion. */
  private async recentlyCooked(userId: string, cooldownDays: number): Promise<Set<string>> {
    const now = new Date();
    const start = new Date(now.getTime() - cooldownDays * 86_400_000).toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    const entries = await this.mealPlan.listRange(userId, start, end);
    return new Set(entries.map((e) => e.recipe.id));
  }
}

/** Highest applicable tier wins: owned ≻ liked ≻ saved ≻ global. */
function tierFor(id: string, owned: Set<string>, liked: Set<string>, saved: Set<string>): Tier {
  if (owned.has(id)) return 'imported';
  if (liked.has(id)) return 'liked';
  if (saved.has(id)) return 'saved';
  return 'global';
}
