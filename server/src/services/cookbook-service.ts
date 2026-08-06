import { CookbookRepository } from '../repositories/cookbook-repository.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { toPublicCookbook, type PublicCookbook } from '../models/cookbook.js';
import { NotFoundError } from '../api/errors.js';

/** The show-cookbook payload: the cookbook plus its recipe cards. */
export interface CookbookView {
  cookbook: { id: string; name: string };
  recipes: { id: string; title: string; image_url?: string }[];
}

/**
 * Cookbook reads and writes. Cookbooks are owner-scoped; a cookbook that isn't the
 * caller's reads as not found. Recipe membership is set here, ensuring the recipe is
 * in the caller's library first.
 */
export class CookbookService {
  constructor(
    private readonly cookbooks: CookbookRepository,
    private readonly recipes: RecipeRepository,
  ) {}

  /** Wire dependencies from the shared singletons. */
  static create() {
    return new CookbookService(CookbookRepository.create(), RecipeRepository.create());
  }

  /**
   * Creates a cookbook for the user.
   * @param userId - Owner.
   * @param name - Non-empty, trimmed name.
   * @returns The created cookbook (0 recipes).
   * @throws {CookbookExistsError} 409 on a duplicate name.
   */
  async create(userId: string, name: string): Promise<PublicCookbook> {
    const cookbook = await this.cookbooks.create(userId, name);
    return toPublicCookbook({ cookbook, recipeCount: 0, coverImageUrl: null });
  }

  /**
   * Lists the user's cookbooks, newest first, with counts and covers.
   * @param userId - Owner.
   */
  async list(userId: string): Promise<PublicCookbook[]> {
    const summaries = await this.cookbooks.listForUser(userId);
    return summaries.map(toPublicCookbook);
  }

  /**
   * Returns a cookbook and its recipes.
   * @param userId - Owner.
   * @param cookbookId - Cookbook to show.
   * @throws {NotFoundError} 404 if the cookbook isn't the caller's.
   */
  async get(userId: string, cookbookId: string): Promise<CookbookView> {
    const found = await this.cookbooks.getForUser(userId, cookbookId);
    if (!found) throw new NotFoundError();
    return { cookbook: { id: found.cookbook.id, name: found.cookbook.name }, recipes: found.recipes };
  }

  /**
   * Sets the recipe's membership across the caller's cookbooks.
   * @param userId - Owner.
   * @param recipeId - Recipe to file.
   * @param cookbookIds - The complete set of the caller's cookbooks the recipe should sit in.
   * @returns The applied (owned) cookbook ids.
   * @throws {NotFoundError} 404 if the recipe id is unknown.
   */
  async setMembership(userId: string, recipeId: string, cookbookIds: string[]): Promise<string[]> {
    if (!(await this.recipes.exists(recipeId))) throw new NotFoundError();
    return this.cookbooks.setMembership(userId, recipeId, cookbookIds);
  }
}
