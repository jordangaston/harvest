import type { Database } from "../db.js";
import { RecipeRepository } from "../repositories/recipe-repository.js";
import { parseIngredientLine } from "../parse/ingredient.js";
import {
  toPublicRecipe,
  toPublicRecipeCard,
  type PublicRecipe,
  type PublicRecipeCard,
} from "../models/recipe.js";
import { NotFoundError } from "../errors.js";

/**
 * Recipe reads and owner edits. Recipes are shared entities, so `get` isn't
 * owner-scoped — any authenticated caller can open any recipe; a missing id 404s.
 */
export class RecipeService {
  constructor(private readonly recipes: RecipeRepository) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database) {
    return new RecipeService(RecipeRepository.create(db));
  }

  /**
   * Returns a recipe by id.
   * @throws {NotFoundError} If no recipe has that id (404).
   */
  async get(recipeId: string): Promise<PublicRecipe> {
    const detail = await this.recipes.findById(recipeId);
    if (!detail) throw new NotFoundError();
    return toPublicRecipe(detail);
  }

  /**
   * One page of the caller's library (owned ∪ cookbook recipes), newest first.
   * @param userId - The library owner.
   * @param opts - `pageSize`, optional `cursor`, and the set of fields to `expand`.
   * @returns The public cards plus the next `page_token` (null at the end).
   */
  async listCards(
    userId: string,
    opts: { pageSize: number; cursor?: string; expand: Set<string> },
  ): Promise<{ recipes: PublicRecipeCard[]; page_token: string | null }> {
    const page = await this.recipes.listCards(userId, {
      limit: opts.pageSize,
      cursor: opts.cursor,
      expand: { ingredientNames: opts.expand.has("ingredient_names"), cookbookIds: opts.expand.has("cookbook_ids") },
    });
    return { recipes: page.cards.map(toPublicRecipeCard), page_token: page.pageToken };
  }

  /**
   * Edits a recipe's ingredients and/or steps in place — owner only (C6). Edited
   * ingredient lines are re-parsed so scaling survives an edit (C3).
   * @throws {NotFoundError} 404 if the recipe is unknown or not the caller's.
   */
  async update(
    userId: string,
    recipeId: string,
    edit: { ingredients?: string[]; steps?: string[] },
  ): Promise<PublicRecipe> {
    if ((await this.recipes.findOwner(recipeId)) !== userId) throw new NotFoundError();
    await this.recipes.updateContent(recipeId, {
      ingredients: edit.ingredients?.map(parseIngredientLine),
      steps: edit.steps,
    });
    return this.get(recipeId);
  }

  /**
   * Deletes a recipe — owner only (C6). Children cascade.
   * @throws {NotFoundError} 404 if the recipe is unknown or not the caller's.
   */
  async remove(userId: string, recipeId: string): Promise<void> {
    if (!(await this.recipes.deleteOwned(userId, recipeId))) throw new NotFoundError();
  }
}
