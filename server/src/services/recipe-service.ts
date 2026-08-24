import type { Database } from "../db.js";
import { RecipeRepository } from "../repositories/recipe-repository.js";
import { PreferenceRepository } from "../repositories/preference-repository.js";
import { SwipeRepository } from "../repositories/swipe-repository.js";
import { CookbookRepository } from "../repositories/cookbook-repository.js";
import { RankingEngine } from "../ranking/ranking-engine.js";
import { tasteDeckSourcer, TasteRepository } from "../ranking/taste/index.js";
import { tuneActionFor } from "../ranking/tune-mapping.js";
import { SWIPE_COOLDOWN_DAYS } from "../ranking/constants.js";
import { parseIngredientLine } from "../parse/ingredient.js";
import type { SWIPE_REASONS } from "../schema.js";
import type { WeeklyMeals } from "../models/user-preferences.js";
import {
  toPublicRecipe,
  toPublicRecipeCard,
  projectRecipe,
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

type SwipeReason = (typeof SWIPE_REASONS)[number];

/** meal_type category values each planned slot maps to. Mirrors the client's MEAL_FILTERS. */
const SLOT_MEAL_TYPES: Record<keyof WeeklyMeals, string[]> = {
  breakfast: ["breakfast", "brunch"],
  lunch: ["lunch"],
  dinner: ["dinner"],
  snack: ["snack"],
  kids: [],
};

/** The default deck meal-type filter: the category values for the slots the user actually plans. */
function defaultMealTypes(weeklyMeals: WeeklyMeals): string[] {
  return (Object.keys(SLOT_MEAL_TYPES) as (keyof WeeklyMeals)[])
    .filter((slot) => weeklyMeals[slot] > 0)
    .flatMap((slot) => SLOT_MEAL_TYPES[slot]);
}

/** A swipe request: direction, plus a dislike reason and its free-text detail (the ingredient). */
export interface SwipeInput {
  direction: "like" | "dislike" | "save";
  reason?: SwipeReason;
  reasonDetail?: string;
}

/**
 * Recipe reads and owner edits. Recipes are shared entities, so `get` isn't
 * owner-scoped — any authenticated caller can open any recipe; a missing id 404s.
 */
export class RecipeService {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly preferences: PreferenceRepository,
    private readonly swipes: SwipeRepository,
    private readonly cookbooks: CookbookRepository,
    private readonly taste: TasteRepository,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database) {
    return new RecipeService(
      RecipeRepository.create(db),
      PreferenceRepository.create(db),
      SwipeRepository.create(db),
      CookbookRepository.create(db),
      TasteRepository.create(db),
    );
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
        score: round1(r.score * 100),
        breakdown: r.breakdown,
      })),
      page_token: next < ranked.length ? encodeIndex(next) : null,
    };
  }

  /**
   * The caller's swipe deck (WI-RANK-4): visible recipes (owned ∪ global) minus any
   * they've liked (permanent) or swiped within `SWIPE_COOLDOWN_DAYS`, ranked best-first,
   * top `limit`. Same card/score/breakdown shape as {@link ranked}; the deck advances by
   * swiping, so there's no `page_token`.
   * The deck is meal-type filtered as part of the recommendation: an explicit `categories`
   * selection (Discover chips) overrides, else the user's planned meal types (from their
   * onboarding weekly_meals) apply — so the warm-up and Discover both respect what the user
   * wants. The filter never empties the deck: if it leaves no live candidates it's relaxed.
   * @param userId - The caller.
   * @param opts - `limit` (deck batch size) and an optional explicit meal-type filter.
   */
  async deck(userId: string, opts: { limit: number; categories?: string[] }): Promise<{ recipes: RankedCard[] }> {
    const cutoff = new Date(Date.now() - SWIPE_COOLDOWN_DAYS * 86_400_000);
    const [prefs, excluded] = await Promise.all([
      this.preferences.getPreferences(userId),
      this.swipes.excludedRecipeIds(userId, cutoff),
    ]);
    // Explicit selection wins (`[]` = show-all); absent → the user's planned meal types.
    const mealTypes = opts.categories !== undefined ? opts.categories : defaultMealTypes(prefs.weeklyMeals);

    let candidates = await this.recipes.listDeckCandidates(userId, mealTypes);
    let live = candidates.filter((c) => !excluded.has(c.recipe.id));
    // Never hand back an empty deck because of the meal filter — relax to the whole catalog.
    if (live.length === 0 && mealTypes.length > 0) {
      candidates = await this.recipes.listDeckCandidates(userId);
      live = candidates.filter((c) => !excluded.has(c.recipe.id));
    }

    const cardById = new Map(live.map((c) => [c.recipe.id, c.card]));
    const engine = RankingEngine.create();
    // Hard constraints (allergen/diet/equipment) gate the candidate set FIRST — you never want an
    // incompatible recipe regardless of taste — then affinity sources the neighbourhood from what's
    // eligible, and the scorers rerank it. Null (no anchors) → the full eligible deck.
    const eligible = engine.eligible(live.map((c) => c.recipe), prefs);
    const byId = new Map(eligible.map((r) => [r.id, r]));
    const sourced = await (await tasteDeckSourcer(this.taste)).source(
      userId,
      [...byId.keys()],
      Math.min(byId.size, Math.max(opts.limit * 2, 24)),
    );
    const pool = sourced ? sourced.map((id) => byId.get(id)!) : eligible;
    const ranked = engine.rank(pool, prefs).slice(0, opts.limit);
    return {
      recipes: ranked.map((r) => ({ recipe: cardById.get(r.recipeId)!, score: round1(r.score * 100), breakdown: r.breakdown })),
    };
  }

  /**
   * Records a swipe and applies its side-effect (WI-RANK-4). Snapshots the pre-tune
   * score+weights (what produced the card the user saw), then: a `like` files the recipe
   * into the caller's "Liked" system cookbook; a `save` ("cook this week") files it into
   * "Saved"; a reasoned `dislike` tunes preferences (bump a weight, or add a food-pref
   * dislike when a `reasonDetail` names the ingredient).
   * @param userId - The caller.
   * @param recipeId - The swiped recipe (must be visible to the caller).
   * @param input - Direction + optional dislike reason and its detail.
   * @throws {NotFoundError} 404 if the recipe isn't visible to the caller.
   */
  async swipe(
    userId: string,
    recipeId: string,
    input: SwipeInput,
  ): Promise<{ direction: "like" | "dislike" | "save"; reason: SwipeReason | null; score: number }> {
    const rankable = await this.recipes.getRankable(userId, recipeId);
    if (!rankable) throw new NotFoundError();

    const prefs = await this.preferences.getPreferences(userId);
    const score = round1(RankingEngine.create().rank([rankable], prefs)[0]!.score * 100);
    const reason = input.reason ?? null;
    await this.swipes.upsert(userId, { recipeId, direction: input.direction, reason, score, weights: prefs.weights });

    if (input.direction === "like" || input.direction === "save") {
      const [slug, name] = input.direction === "like" ? ["liked", "Liked"] : ["saved", "Saved"];
      const cb = await this.cookbooks.ensureSystemCookbook(userId, slug, name);
      await this.cookbooks.addRecipe(userId, cb, recipeId);
    } else if (input.reason) {
      await this.applyDislikeTuning(userId, input.reason, input.reasonDetail);
    }
    return { direction: input.direction, reason, score };
  }

  /**
   * Un-swipes: removes the `(user, recipe)` swipe and reverses its cookbook filing, so the
   * recipe becomes deck-eligible again. Idempotent — a no-op if there was no swipe. A `like`
   * un-files from Liked, a `save` from Saved; a dislike just clears the row.
   */
  async unswipe(userId: string, recipeId: string): Promise<void> {
    const removed = await this.swipes.delete(userId, recipeId);
    if (!removed) return;
    if (removed.direction === "like" || removed.direction === "save") {
      const [slug, name] = removed.direction === "like" ? ["liked", "Liked"] : ["saved", "Saved"];
      const cb = await this.cookbooks.ensureSystemCookbook(userId, slug, name);
      await this.cookbooks.removeRecipe(userId, cb, recipeId);
    }
  }

  /** Tunes preferences for a reasoned dislike: bump a weight, add a food-pref dislike, or nothing. */
  private async applyDislikeTuning(userId: string, reason: SwipeReason, reasonDetail?: string): Promise<void> {
    const action = tuneActionFor(reason);
    if (action.kind === "weight") await this.preferences.bumpWeight(userId, action.signal);
    else if (action.kind === "dislike" && reasonDetail) await this.preferences.addDislike(userId, "primary_ingredient", reasonDetail);
  }

  /**
   * Returns a recipe by id.
   * @throws {NotFoundError} If no recipe has that id (404).
   */
  async get(recipeId: string): Promise<PublicRecipe>;
  async get(recipeId: string, fields: Set<string>): Promise<Partial<PublicRecipe> & { id: string }>;
  async get(recipeId: string, fields?: Set<string>): Promise<Partial<PublicRecipe> & { id: string }> {
    const detail = await this.recipes.findById(recipeId);
    if (!detail) throw new NotFoundError();
    const full = toPublicRecipe(detail);
    return fields && fields.size ? projectRecipe(full, fields) : full;
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

/** Rounds a 0–100 score to one decimal (the deck/ranked score convention). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The ranked page_token is just the next start index into the recomputed ranking. */
function encodeIndex(index: number): string {
  return Buffer.from(String(index), "utf8").toString("base64url");
}

function decodeIndex(token: string): number {
  const n = Number(Buffer.from(token, "base64url").toString("utf8"));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
