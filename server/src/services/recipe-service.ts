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
}
