import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipes, type MealSlot } from '../schema.js';
import { AppError, NotFoundError } from '../errors.js';
import type { UserPreferences } from '../models/user-preferences.js';
import type { User } from '../models/user.js';
import type { InsertedEntry } from '../models/meal-plan.js';
import { CandidateProvider } from './candidate-provider.js';
import { MmrFiller, mmrTopN } from './slot-filler.js';
import { MealPlanRepository } from '../repositories/meal-plan-repository.js';
import { PreferenceRepository } from '../repositories/preference-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { CandidateRecipe, FillConstraints, PlanAssignment, Slot } from './types.js';

const MEALS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_PREP_WHEN_COOK = ['meal_prep', 'weekly_schedule'];
/** Days on each side of a re-rolled slot treated as "the current week" for uniqueness — 7 covers the
 * whole containing week wherever `date` falls. A repeat 8+ days out is a different week (recency's job). */
const REGEN_WINDOW_DAYS = 7;

interface RecipeCard {
  id: string;
  title: string;
  image_url?: string;
  total_minutes: number | null;
  cost_per_serving_cents: number | null;
}
export interface GeneratedPlan {
  entries: { id: string | null; date: string; meal: MealSlot; tier: string; recipe: RecipeCard }[];
  summary: {
    preference_total: number;
    cost_total_cents: number;
    weekly_budget_cents: number | null;
    novelty_ratio: number;
    leftover_ratio: number;
    unfilled_slots: number;
  };
}

/**
 * Orchestrates candidate-generation → fill → persist for the meal-planning engine (WI-MP-3). Hand-wired,
 * no DI container. Pure engine bits (CandidateProvider, MmrFiller) do the work; this service loads inputs,
 * shapes the response, and persists.
 */
export class MealPlanGeneratorService {
  constructor(
    private readonly db: Database,
    private readonly candidates: CandidateProvider,
    private readonly filler: MmrFiller,
    private readonly mealPlan: MealPlanRepository,
    private readonly prefsRepo: PreferenceRepository,
    private readonly users: UserRepository,
  ) {}

  static create(db: Database): MealPlanGeneratorService {
    return new MealPlanGeneratorService(
      db,
      CandidateProvider.create(db),
      MmrFiller.create(),
      MealPlanRepository.create(db),
      PreferenceRepository.create(db),
      UserRepository.create(db),
    );
  }

  /**
   * Fills the week's slots and (unless `preview`) persists them as generated entries.
   * @param opts.shuffle - Re-roll: exclude the current plan's recipes so the new plan differs.
   * @throws AppError EMPTY_PLAN (422) when `weekly_meals` has no slots.
   */
  async generate(userId: string, opts: { start: string; end: string; preview: boolean; shuffle: boolean }): Promise<GeneratedPlan> {
    const prefs = await this.prefsRepo.getPreferences(userId);
    const slots = buildSlots(prefs, dateRange(opts.start, opts.end));
    if (slots.length === 0) throw new AppError('EMPTY_PLAN', 422, 'no meals are planned for this week');
    const user = await this.users.findById(userId);

    const exclude = opts.shuffle ? await this.planRecipeIds(userId, opts.start, opts.end) : new Set<string>();
    const pools = await this.buildPools(userId, slots, prefs, exclude);
    const assignment = this.filler.fill(slots, pools, buildConstraints(prefs, user));

    const inserted = opts.preview
      ? []
      : await this.mealPlan.replaceGenerated(userId, opts.start, opts.end, assignment.choices.map((ch) => ({ date: ch.slot.date, meal: ch.slot.meal, recipeId: ch.recipeId, batchId: ch.batchId })));

    logGenerate(userId, slots.length, assignment, opts);
    return this.toResponse(assignment, inserted, prefs);
  }

  /**
   * Re-rolls one slot to the next-best fresh recipe (the one-tap "shuffle it" path).
   * @throws AppError NO_CANDIDATE (409) when the pool is exhausted after exclusions.
   */
  async regenerateSlot(userId: string, date: string, meal: MealSlot, excludeRecipeId?: string): Promise<{ entry: Awaited<ReturnType<MealPlanRepository['replaceSlot']>>; tier: string }> {
    const prefs = await this.prefsRepo.getPreferences(userId);
    const exclude = await this.planRecipeIds(userId, shiftDate(date, -REGEN_WINDOW_DAYS), shiftDate(date, REGEN_WINDOW_DAYS));
    if (excludeRecipeId) exclude.add(excludeRecipeId);
    const [pick] = await this.candidates.candidates(userId, meal, prefs, { exclude });
    if (!pick) throw new AppError('NO_CANDIDATE', 409, 'no alternative recipe is available for this slot');
    const entry = await this.mealPlan.replaceSlot(userId, date, meal, pick.recipeId, 'generated');
    return { entry, tier: pick.tier };
  }

  /**
   * Up to `limit` preference-ranked, MMR-diversified alternatives for a slot (WI-MP-4 options), excluding
   * the current pick and what's already planned nearby. Never persists.
   */
  async slotOptions(userId: string, date: string, meal: MealSlot, limit: number, excludeRecipeId?: string): Promise<{ options: { tier: string; recipe: RecipeCard }[] }> {
    const prefs = await this.prefsRepo.getPreferences(userId);
    const exclude = await this.planRecipeIds(userId, shiftDate(date, -REGEN_WINDOW_DAYS), shiftDate(date, REGEN_WINDOW_DAYS));
    if (excludeRecipeId) exclude.add(excludeRecipeId);
    const pool = await this.candidates.candidates(userId, meal, prefs, { exclude });
    const top = mmrTopN(pool, limit);
    const cards = await this.cardsFor(top.map((c) => c.recipeId));
    return { options: top.flatMap((c) => { const recipe = cards.get(c.recipeId); return recipe ? [{ tier: c.tier, recipe }] : []; }) };
  }

  /**
   * Sets a slot to a user-chosen recipe (WI-MP-4 fill), replacing the auto-suggestion. Marked `manual` so
   * a later week-regenerate won't overwrite the deliberate pick.
   * @throws NotFoundError when the recipe isn't visible to the caller (not owned, not global).
   */
  async fillSlot(userId: string, date: string, meal: MealSlot, recipeId: string): Promise<Awaited<ReturnType<MealPlanRepository['replaceSlot']>>> {
    if (!(await this.isVisible(userId, recipeId))) throw new NotFoundError();
    return this.mealPlan.replaceSlot(userId, date, meal, recipeId, 'manual');
  }

  private async isVisible(userId: string, recipeId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.id, recipeId), or(eq(recipes.userId, userId), isNull(recipes.userId))));
    return !!row;
  }

  private async buildPools(userId: string, slots: Slot[], prefs: UserPreferences, exclude: Set<string>): Promise<Map<MealSlot, CandidateRecipe[]>> {
    const meals = [...new Set(slots.map((s) => s.meal))];
    const pools = await Promise.all(meals.map((meal) => this.candidates.candidates(userId, meal, prefs, { exclude })));
    return new Map(meals.map((meal, i) => [meal, pools[i]]));
  }

  /** Recipe ids currently planned in a date range (for shuffle + single-slot uniqueness). */
  private async planRecipeIds(userId: string, start: string, end: string): Promise<Set<string>> {
    const entries = await this.mealPlan.listRange(userId, start, end);
    return new Set(entries.map((e) => e.recipe.id));
  }

  private async toResponse(assignment: PlanAssignment, inserted: InsertedEntry[], prefs: UserPreferences): Promise<GeneratedPlan> {
    const cards = await this.cardsFor([...new Set(assignment.choices.map((c) => c.recipeId))]);
    // Match persisted ids to choices by identity, not array index — SQLite RETURNING order is undefined.
    const idByKey = new Map(inserted.map((e) => [slotKey(e.date, e.meal, e.recipeId), e.id]));
    const entries = assignment.choices
      .map((ch) => {
        const recipe = cards.get(ch.recipeId);
        if (!recipe) return null; // recipe vanished between build and card-fetch — drop it, don't crash
        return { id: idByKey.get(slotKey(ch.slot.date, ch.slot.meal, ch.recipeId)) ?? null, date: ch.slot.date, meal: ch.slot.meal, tier: ch.tier, recipe };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const s = assignment.summary;
    return {
      entries,
      summary: {
        preference_total: s.preferenceTotal,
        cost_total_cents: s.costTotalCents,
        weekly_budget_cents: prefs.weeklyBudgetCents,
        novelty_ratio: s.noveltyRatio,
        leftover_ratio: s.leftoverRatio,
        unfilled_slots: s.unfilledSlots,
      },
    };
  }

  private async cardsFor(ids: string[]): Promise<Map<string, RecipeCard>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: recipes.id, title: recipes.title, imageUrl: recipes.imageUrl, totalMinutes: recipes.totalMinutes, costPerServingCents: recipes.costPerServingCents })
      .from(recipes)
      .where(inArray(recipes.id, ids));
    return new Map(
      rows.map((r) => [r.id, { id: r.id, title: r.title, ...(r.imageUrl ? { image_url: r.imageUrl } : {}), total_minutes: r.totalMinutes, cost_per_serving_cents: r.costPerServingCents }]),
    );
  }
}

// ── pure helpers ────────────────────────────────────────────────────────────

/** Inclusive YYYY-MM-DD dates from start to end. */
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** Identity of a filled slot — unique across a plan's choices (a batch repeats a recipe on other dates). */
const slotKey = (date: string, meal: MealSlot, recipeId: string) => `${date}|${meal}|${recipeId}`;

/** One slot per planned meal, round-robin across the range's dates (kids meals aren't slots yet — Q). */
function buildSlots(prefs: UserPreferences, dates: string[]): Slot[] {
  const slots: Slot[] = [];
  if (dates.length === 0) return slots;
  for (const meal of MEALS) {
    const n = prefs.weeklyMeals[meal];
    for (let i = 0; i < n; i++) slots.push({ date: dates[i % dates.length], meal });
  }
  return slots;
}

function buildConstraints(prefs: UserPreferences, user: User | null): FillConstraints {
  const intent = !!user && ((user.whenCook !== null && MEAL_PREP_WHEN_COOK.includes(user.whenCook)) || (user.goals?.includes('meal_prepping') ?? false));
  return {
    weeklyBudgetCents: prefs.weeklyBudgetCents,
    timeByMeal: prefs.timeByMeal,
    timeBudgetMinutes: prefs.timeBudgetMinutes,
    householdServings: prefs.household.adults + prefs.household.kids,
    cookDaysCount: user?.cookDaysCount ?? null,
    eatsLeftovers: prefs.eatsLeftovers,
    mealPrepIntent: intent,
    weightMealPrep: prefs.weights.mealPrep,
  };
}

/** One structured line per generation (the meal-plan observability signal; no metrics backend yet). */
function logGenerate(userId: string, slots: number, a: PlanAssignment, opts: { shuffle: boolean; preview: boolean }): void {
  const s = a.summary;
  console.log(
    `[mealplan] generate user=${userId} slots=${slots} filled=${a.choices.length} unfilled=${s.unfilledSlots} ` +
      `cost=${s.costTotalCents} novelty=${s.noveltyRatio.toFixed(2)} leftover=${s.leftoverRatio.toFixed(2)} shuffle=${opts.shuffle} preview=${opts.preview}`,
  );
}
