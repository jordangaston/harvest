import type { Database } from "../db.js";
import { CookbookRepository } from "../repositories/cookbook-repository.js";
import { RecipeRepository } from "../repositories/recipe-repository.js";
import { toPublicCookbook, type PublicCookbook } from "../models/cookbook.js";
import { NotFoundError } from "../errors.js";

/** The show-cookbook payload: the cookbook plus its recipe cards. */
export interface CookbookView {
  cookbook: { id: string; name: string };
  recipes: { id: string; title: string; image_url?: string }[];
}

/**
 * Cookbook reads and writes. Cookbooks are owner-scoped; a cookbook that isn't the
 * caller's reads as not found. Recipe membership is set here, ensuring the recipe
 * exists first.
 */
export class CookbookService {
  constructor(
    private readonly cookbooks: CookbookRepository,
    private readonly recipes: RecipeRepository,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database) {
    return new CookbookService(CookbookRepository.create(db), RecipeRepository.create(db));
  }

  /**
   * Creates a cookbook for the user.
   * @throws {CookbookExistsError} 409 on a duplicate name.
   */
  async create(userId: string, name: string): Promise<PublicCookbook> {
    const cookbook = await this.cookbooks.create(userId, name);
    return toPublicCookbook({ cookbook, recipeCount: 0, coverImageUrl: null });
  }

  /** Lists the user's cookbooks, newest first, with counts and covers. */
  async list(userId: string): Promise<PublicCookbook[]> {
    const summaries = await this.cookbooks.listForUser(userId);
    return summaries.map(toPublicCookbook);
  }

  /**
   * Returns a cookbook and its recipes.
   * @throws {NotFoundError} 404 if the cookbook isn't the caller's.
   */
  async get(userId: string, cookbookId: string): Promise<CookbookView> {
    const found = await this.cookbooks.getForUser(userId, cookbookId);
    if (!found) throw new NotFoundError();
    return { cookbook: { id: found.cookbook.id, name: found.cookbook.name }, recipes: found.recipes };
  }

  /**
   * Sets the recipe's membership across the caller's cookbooks.
   * @returns The applied (owned) cookbook ids.
   * @throws {NotFoundError} 404 if the recipe id is unknown.
   */
  async setMembership(userId: string, recipeId: string, cookbookIds: string[]): Promise<string[]> {
    if (!(await this.recipes.exists(recipeId))) throw new NotFoundError();
    return this.cookbooks.setMembership(userId, recipeId, cookbookIds);
  }
}
