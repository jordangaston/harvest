import type { Database } from "../db.js";
import { RecipeRepository } from "../repositories/recipe-repository.js";
import { PreferenceRepository } from "../repositories/preference-repository.js";
import { RankingEngine } from "../ranking/ranking-engine.js";
import { parseIngredientLine } from "../parse/ingredient.js";
import {
  toPublicRecipe,
  toPublicRecipeCard,
  type PublicRecipe,
  type PublicRecipeCard,
} from "../models/recipe.js";
import { NotFoundError } from "../errors.js";

/** One ranked recipe on the wire: its public card, 0–100 score, and per-signal breakdown. */
export interface RankedCard {
  recipe: PublicRecipeCard;
  score: number;
  breakdown: Record<string, number>;
}

/**
 * Recipe reads and owner edits. Recipes are shared entities, so `get` isn't
 * owner-scoped — any authenticated caller can open any recipe; a missing id 404s.
 */
export class RecipeService {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly preferences: PreferenceRepository,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database) {
    return new RecipeService(RecipeRepository.create(db), PreferenceRepository.create(db));
  }

  /**
   * The caller's owned catalog ranked best-first for their preferences (WI-RANK-3).
   * Ranking is global, so the full catalog is scored, then the requested page is
   * sliced; `cursor` is a base64url start index (absent = start at 0).
   * @param userId - The catalog owner (authenticated caller).
   * @param opts - `pageSize` (max 200) and an optional `cursor` from a prior page.
   * @returns One page of ranked cards + the next `page_token` (null at the end).
   */
  async ranked(
    userId: string,
    opts: { pageSize: number; cursor?: string },
  ): Promise<{ recipes: RankedCard[]; page_token: string | null }> {
    const [prefs, rankable] = await Promise.all([
      this.preferences.getPreferences(userId),
      this.recipes.listRankable(userId),
    ]);
    const cardById = new Map(rankable.map((r) => [r.recipe.id, r.card]));
    const ranked = RankingEngine.create().rank(rankable.map((r) => r.recipe), prefs);

    const start = opts.cursor ? decodeIndex(opts.cursor) : 0;
    const page = ranked.slice(start, start + opts.pageSize);
    const next = start + opts.pageSize;
    return {
      recipes: page.map((r) => ({
        recipe: cardById.get(r.recipeId)!,
        score: Math.round(r.score * 1000) / 10,
        breakdown: r.breakdown,
      })),
      page_token: next < ranked.length ? encodeIndex(next) : null,
    };
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

/** The ranked page_token is just the next start index into the recomputed ranking. */
function encodeIndex(index: number): string {
  return Buffer.from(String(index), "utf8").toString("base64url");
}

function decodeIndex(token: string): number {
  const n = Number(Buffer.from(token, "base64url").toString("utf8"));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
