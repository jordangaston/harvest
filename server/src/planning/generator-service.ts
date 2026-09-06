import type { Database } from '../db.js';
import type { MealSlot } from '../schema.js';
import type { UserPreferences } from '../models/user-preferences.js';
import type { HouseholdPreferences } from '../models/household-preferences.js';
import type { RankableRecipe } from '../ranking/types.js';
import type { PublicRecipeCard } from '../models/recipe.js';
import { CandidateProvider } from './candidate-provider.js';
import { pickMains, mmrTopN } from './slot-filler.js';
import { completePlate } from '../ranking/plate.js';
import { RankingEngine } from '../ranking/ranking-engine.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { MealPlanRepository, type GeneratedEntry } from '../repositories/meal-plan-repository.js';
import { PreferenceRepository } from '../repositories/preference-repository.js';
import { HouseholdPreferenceRepository } from '../repositories/household-preference-repository.js';
import { GrocerySync } from '../services/grocery-sync.js';
import type { CandidateRecipe, Slot, SlotCriteria } from './types.js';

const MEALS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** Days on each side of a slot treated as "this week" for slot-options uniqueness — 7 covers the
 * whole containing week wherever `date` falls. */
const PLAN_WINDOW_DAYS = 7;

/** One filled slot of the generated plan: its date/meal and the recipe cards in it, main-first. */
export interface PlannedSlot {
  date: string;
  meal: MealSlot;
  recipes: PublicRecipeCard[];
}

/**
 * Fills a household's week and persists it. Pure engine bits (CandidateProvider, MMR, completePlate)
 * do the work; this service loads inputs (household meal counts + the owner's ranking prefs), composes
 * a main+sides plate per slot, and persists them main-first as `generated` entries. Hand-wired, no DI.
 */
export class MealPlanGeneratorService {
  constructor(
    private readonly candidates: CandidateProvider,
    private readonly ranking: RankingEngine,
    private readonly recipes: RecipeRepository,
    private readonly mealPlan: MealPlanRepository,
    private readonly userPrefs: PreferenceRepository,
    private readonly householdPrefs: HouseholdPreferenceRepository,
    private readonly grocerySync: GrocerySync,
  ) {}

  static create(db: Database): MealPlanGeneratorService {
    return new MealPlanGeneratorService(
      CandidateProvider.create(db),
      RankingEngine.create(),
      RecipeRepository.create(db),
      MealPlanRepository.create(db),
      PreferenceRepository.create(db),
      HouseholdPreferenceRepository.create(db),
      GrocerySync.create(db),
    );
  }

  /**
   * Fills the week's slots and persists them as generated entries (replacing the range's prior
   * generated entries; manual picks survive). Best-effort: a slot whose pool is exhausted is left
   * empty, never faked.
   * @param userId - The plan owner (the thread's owner).
   * @param householdId - The household whose meal counts define the window's slots.
   * @param start - Inclusive ISO date (YYYY-MM-DD).
   * @param end - Inclusive ISO date (YYYY-MM-DD).
   * @returns The persisted plan, grouped by slot (main-first), for Sage to present.
   */
  async generate(userId: string, householdId: string, start: string, end: string): Promise<PlannedSlot[]> {
    const [prefs, household] = await Promise.all([this.userPrefs.getPreferences(userId), this.householdPrefs.getPreferences(householdId)]);
    const slots = buildSlots(household, dateRange(start, end));
    if (slots.length === 0) return [];

    // The plate corpus: every recipe the owner can see, eligible (allergen/diet/equipment ok), as
    // RankableRecipe — used both to resolve a picked main and to draw directive sides from.
    const corpus = await this.recipes.listDeckCandidates(userId);
    const eligible = this.ranking.eligible(corpus.map((c) => c.recipe), prefs);
    const rankableById = new Map(eligible.map((r) => [r.id, r]));
    const cardById = new Map(corpus.map((c) => [c.recipe.id, c.card]));

    // One MMR pick per slot, mains kept distinct across the week, grouped by meal so each meal draws
    // from its own ranked pool.
    const pools = await this.pools(userId, slots, prefs);
    const picks = pickMains(slots.map((slot) => ({ slot, pool: pools.get(slot.meal) ?? [] })));

    const entries: GeneratedEntry[] = [];
    const planned: PlannedSlot[] = [];
    for (const { slot, pick } of picks) {
      const main = rankableById.get(pick.recipeId);
      if (!main) continue; // vanished between rank and corpus load — drop, don't crash
      const { sides } = completePlate(main, eligible, prefs.foodPrefs, slot.meal);
      const recipeIds = [main.id, ...sides.map((s) => s.id)];
      recipeIds.forEach((recipeId, position) => entries.push({ date: slot.date, meal: slot.meal, recipeId, position }));
      planned.push({ date: slot.date, meal: slot.meal, recipes: recipeIds.map((id) => cardById.get(id)!).filter(Boolean) });
    }

    await this.mealPlan.replaceGenerated(userId, start, end, entries);
    await this.grocerySync.reconcile(userId);
    return planned;
  }

  /**
   * Up to `limit` preference-ranked, MMR-diversified options for a slot, honouring the user's ad-hoc
   * `criteria`. "More options" = call again with the shown ids in `exclude`. Never persists.
   */
  async slotOptions(
    userId: string,
    date: string,
    meal: MealSlot,
    opts: { criteria?: SlotCriteria; limit: number; exclude?: ReadonlySet<string> },
  ): Promise<CandidateRecipe[]> {
    const prefs = await this.userPrefs.getPreferences(userId);
    // Never suggest something already on the plan that week: exclude recipe ids planned in the ±7-day
    // window around this slot, on top of the caller's "more options" exclusions.
    const planned = await this.mealPlan.listRange(userId, shiftDate(date, -PLAN_WINDOW_DAYS), shiftDate(date, PLAN_WINDOW_DAYS));
    const exclude = new Set([...(opts.exclude ?? []), ...planned.map((e) => e.recipe.id)]);
    const pool = await this.candidates.candidates(userId, meal, prefs, { criteria: opts.criteria, exclude });
    return mmrTopN(pool, opts.limit);
  }

  /** One ranked pool per distinct meal in the slot set. */
  private async pools(userId: string, slots: Slot[], prefs: UserPreferences): Promise<Map<MealSlot, CandidateRecipe[]>> {
    const meals = [...new Set(slots.map((s) => s.meal))];
    const pools = await Promise.all(meals.map((meal) => this.candidates.candidates(userId, meal, prefs)));
    return new Map(meals.map((meal, i) => [meal, pools[i]!]));
  }
}


// ── pure helpers ────────────────────────────────────────────────────────────

/** A YYYY-MM-DD date shifted by `days` (UTC midnight, DST-safe). */
const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** Inclusive YYYY-MM-DD dates from start to end. */
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** One slot per planned meal, round-robin across the range's dates. Meal counts come from the
 * household's recorded facts; a household with none recorded yields no slots (best-effort by design). */
function buildSlots(household: HouseholdPreferences, dates: string[]): Slot[] {
  const slots: Slot[] = [];
  if (dates.length === 0 || !household.weeklyMeals) return slots;
  for (const meal of MEALS) {
    const n = household.weeklyMeals[meal] ?? 0;
    for (let i = 0; i < n; i++) slots.push({ date: dates[i % dates.length]!, meal });
  }
  return slots;
}
