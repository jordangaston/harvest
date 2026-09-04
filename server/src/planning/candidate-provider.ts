import type { MealSlot } from '../schema.js';
import type { Database } from '../db.js';
import type { UserPreferences } from '../models/user-preferences.js';
import type { RankableRecipe } from '../ranking/types.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { MealPlanRepository } from '../repositories/meal-plan-repository.js';
import { RankingEngine } from '../ranking/ranking-engine.js';
import { recipeMatches } from '../ranking/directive-match.js';
import { isStandaloneMeal } from '../ranking/course.js';
import type { CandidateRecipe, SlotCriteria, CriteriaDimension } from './types.js';

/** A meal slot → the recipe `meal_type` facet values that fill it (brunch counts as breakfast). */
const MEAL_TYPE_VALUES: Record<MealSlot, string[]> = {
  breakfast: ['breakfast', 'brunch'],
  lunch: ['lunch'],
  dinner: ['dinner'],
  snack: ['snack'],
};

/** Days a recently-cooked recipe stays out of the pool — longer than the swipe cooldown, since a
 * served dinner should rest longer than a swiped card. */
const MEAL_COOLDOWN_DAYS = 14;

/**
 * Builds the ranked, recency-clean candidate pool for a meal type — the single chokepoint where the
 * corpus becomes plan-ready, so no filler re-implements loading or filtering. Reuses the ranking
 * engine verbatim (its hard filters drop allergen/diet/equipment mismatches) and, when given ad-hoc
 * `criteria`, applies them as transient constraints on top (never persisted as preferences).
 */
export class CandidateProvider {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly mealPlan: MealPlanRepository,
    private readonly ranking: RankingEngine,
  ) {}

  static create(db: Database): CandidateProvider {
    return new CandidateProvider(RecipeRepository.create(db), MealPlanRepository.create(db), RankingEngine.create());
  }

  /**
   * The candidate pool for one meal type, best-first by ranking score.
   * @param userId - The planner.
   * @param meal - The slot's meal type.
   * @param prefs - The user's resolved ranking preferences.
   * @param opts.exclude - Recipe ids to drop (in-week uniqueness, the current pick, "more options"
   *   pagination) — on top of the automatic recency exclusion.
   * @param opts.criteria - A one-shot ad-hoc constraint (include/exclude facets, max minutes).
   * @param opts.cooldownDays - Days a recently-cooked recipe stays out (default MEAL_COOLDOWN_DAYS).
   */
  async candidates(
    userId: string,
    meal: MealSlot,
    prefs: UserPreferences,
    opts: { exclude?: ReadonlySet<string>; criteria?: SlotCriteria; cooldownDays?: number } = {},
  ): Promise<CandidateRecipe[]> {
    const [pool, recent] = await Promise.all([
      this.recipes.listDeckCandidates(userId, MEAL_TYPE_VALUES[meal]),
      this.recentlyCooked(userId, opts.cooldownDays ?? MEAL_COOLDOWN_DAYS),
    ]);
    const byId = new Map(pool.map((p) => [p.recipe.id, p]));
    const criteria = opts.criteria;
    // A slot's candidate is its MAIN — a side/dessert/drink tagged for the meal (a dinner roll is
    // `meal_type: dinner`) is not a dinner. Sides come only from completePlate's corpus. Snacks keep
    // everything (a snack has no separate side course).
    const mainsOnly = meal !== 'snack';

    const out: CandidateRecipe[] = [];
    for (const { recipeId, score } of this.ranking.rank(pool.map((p) => p.recipe), prefs)) {
      if (recent.has(recipeId) || opts.exclude?.has(recipeId)) continue;
      const p = byId.get(recipeId)!;
      if (mainsOnly && !isStandaloneMeal(p.recipe)) continue;
      if (criteria && !matchesCriteria(p.recipe, criteria)) continue;
      out.push({ recipeId, score, categories: p.recipe.categories, card: p.card });
    }
    return out;
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

/** Whether a recipe satisfies an ad-hoc criteria: every `include` facet must match, no `exclude`
 * facet may, and (when set) the recipe's cook time must be known and within `maxTotalMinutes`. */
function matchesCriteria(recipe: RankableRecipe, criteria: SlotCriteria): boolean {
  if (criteria.maxTotalMinutes !== undefined && (recipe.totalMinutes === null || recipe.totalMinutes > criteria.maxTotalMinutes)) return false;
  for (const [dimension, values] of dimEntries(criteria.include)) if (!values.every((v) => recipeMatches(recipe, { dimension, value: v }))) return false;
  for (const [dimension, values] of dimEntries(criteria.exclude)) if (values.some((v) => recipeMatches(recipe, { dimension, value: v }))) return false;
  return true;
}

/** Typed `(dimension, values)` pairs of a criteria side, skipping empty value lists. */
function dimEntries(side: SlotCriteria['include']): [CriteriaDimension, string[]][] {
  if (!side) return [];
  return Object.entries(side).filter(([, v]) => v && v.length) as [CriteriaDimension, string[]][];
}
