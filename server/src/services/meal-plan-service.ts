import type { Database } from '../db.js';
import { MealPlanRepository } from '../repositories/meal-plan-repository.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import type { MealPlanEntryView, MealSlot } from '../models/meal-plan.js';
import { NotFoundError } from '../errors.js';

/**
 * Meal-plan reads and writes, all owner-scoped. Adding checks the recipe exists
 * (recipes are shared-readable, so no ownership gate) — an unknown id 404s.
 */
export class MealPlanService {
  constructor(
    private readonly entries: MealPlanRepository,
    private readonly recipes: RecipeRepository,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database) {
    return new MealPlanService(MealPlanRepository.create(db), RecipeRepository.create(db));
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
   * @throws {NotFoundError} 404 if the recipe id is unknown.
   */
  async add(userId: string, date: string, meal: MealSlot, recipeId: string): Promise<MealPlanEntryView> {
    if (!(await this.recipes.exists(recipeId))) throw new NotFoundError();
    return this.entries.add(userId, date, meal, recipeId);
  }

  /**
   * Removes one of the caller's entries.
   * @param userId - Owner.
   * @param entryId - Entry to remove.
   * @throws {NotFoundError} 404 if the entry is unknown or not the caller's.
   */
  async remove(userId: string, entryId: string): Promise<void> {
    if (!(await this.entries.remove(userId, entryId))) throw new NotFoundError();
  }
}
