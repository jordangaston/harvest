import type { Database } from '../db.js';
import { MealPlanRepository } from '../repositories/meal-plan-repository.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { GrocerySync } from './grocery-sync.js';
import type { MealPlanEntryView, MealPlanSource, MealSlot } from '../models/meal-plan.js';
import { NotFoundError } from '../errors.js';

/**
 * Meal-plan reads and writes, all owner-scoped. Adding checks the recipe exists
 * (recipes are shared-readable, so no ownership gate) — an unknown id 404s. After every committed
 * slot mutation the household grocery list reconciles to match (F-05) — the one chokepoint the REST
 * plan endpoints and the chef's mealplan tools both route through.
 */
export class MealPlanService {
  constructor(
    private readonly entries: MealPlanRepository,
    private readonly recipes: RecipeRepository,
    private readonly grocerySync: GrocerySync,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database) {
    return new MealPlanService(MealPlanRepository.create(db), RecipeRepository.create(db), GrocerySync.create(db));
  }

  /**
   * The caller's entries in an inclusive date range.
   * @param userId - Owner.
   * @param start - Inclusive ISO date.
   * @param end - Inclusive ISO date.
   */
  async listRange(userId: string, start: string, end: string): Promise<MealPlanEntryView[]> {
    return this.entries.listRange(userId, start, end);
  }

  /**
   * Assigns a recipe to a (date, meal) slot.
   * @param userId - Owner.
   * @param date - ISO date.
   * @param meal - Meal slot.
   * @param recipeId - Recipe to assign.
   * @param source - Who set it ('manual' by default; the planner passes 'generated').
   * @throws {NotFoundError} 404 if the recipe id is unknown.
   */
  async add(userId: string, date: string, meal: MealSlot, recipeId: string, source: MealPlanSource = 'manual'): Promise<MealPlanEntryView> {
    if (!(await this.recipes.exists(recipeId))) throw new NotFoundError();
    const entry = await this.entries.add(userId, date, meal, recipeId, source);
    await this.grocerySync.reconcile(userId);
    return entry;
  }

  /**
   * Removes one of the caller's entries.
   * @param userId - Owner.
   * @param entryId - Entry to remove.
   * @throws {NotFoundError} 404 if the entry is unknown or not the caller's.
   */
  async remove(userId: string, entryId: string): Promise<void> {
    if (!(await this.entries.remove(userId, entryId))) throw new NotFoundError();
    await this.grocerySync.reconcile(userId);
  }

  /**
   * Removes one recipe from a (date, meal) slot — the entry-level "take this off the plan" the Chef
   * offers. Drops a single matching entry, main or side.
   * @throws {NotFoundError} 404 if that recipe isn't in the slot.
   */
  async removeFromSlot(userId: string, date: string, meal: MealSlot, recipeId: string): Promise<void> {
    if (!(await this.entries.removeFromSlot(userId, date, meal, recipeId))) throw new NotFoundError();
    await this.grocerySync.reconcile(userId);
  }
}
