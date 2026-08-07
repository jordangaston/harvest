import { RecipeRepository } from '../repositories/recipe-repository.js';
import { toPublicRecipe, type PublicRecipe } from '../models/recipe.js';
import { NotFoundError } from '../api/errors.js';

/**
 * Recipe reads. Recipes are shared entities, so `get` isn't owner-scoped — any
 * authenticated caller can open any recipe; a missing id 404s.
 */
export class RecipeService {
  constructor(private readonly recipes: RecipeRepository) {}

  /** Wire dependencies from the shared singletons. */
  static create() {
    return new RecipeService(RecipeRepository.create());
  }

  /**
   * Returns a recipe by id.
   * @param recipeId - The recipe to fetch.
   * @returns The recipe's public projection.
   * @throws {NotFoundError} If no recipe has that id (404).
   */
  async get(recipeId: string): Promise<PublicRecipe> {
    const detail = await this.recipes.findById(recipeId);
    if (!detail) throw new NotFoundError();
    return toPublicRecipe(detail);
  }

  /**
   * Edits the caller's copy of a recipe's ingredients and/or steps (copy-on-write:
   * forks a private clone if others also saved it, else edits in place).
   * @param userId - Caller.
   * @param recipeId - Recipe to edit.
   * @param edit - New ingredient lines and/or step texts.
   * @returns The edited recipe (possibly under a new id if it forked).
   * @throws {NotFoundError} 404 if the caller hasn't saved this recipe.
   */
  async update(userId: string, recipeId: string, edit: { ingredients?: string[]; steps?: string[] }): Promise<PublicRecipe> {
    if (!(await this.recipes.isSavedBy(userId, recipeId))) throw new NotFoundError();
    const targetId = await this.recipes.updateContent(userId, recipeId, edit);
    return this.get(targetId);
  }

  /**
   * Removes a recipe from the caller's library and cookbooks (leaves the shared row).
   * @param userId - Caller.
   * @param recipeId - Recipe to remove.
   * @throws {NotFoundError} 404 if the caller hadn't saved it.
   */
  async remove(userId: string, recipeId: string): Promise<void> {
    const removed = await this.recipes.removeForUser(userId, recipeId);
    if (!removed) throw new NotFoundError();
  }
}
