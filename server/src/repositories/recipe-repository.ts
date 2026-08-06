import { eq, and, inArray } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { recipes, ingredients, recipeSteps, savedRecipes, cookbooks, cookbookRecipes } from '../db/schema/index.js';
import type { SourceType } from '../db/schema/enums.js';
import { RecipeSchema, type RecipeDetail } from '../models/recipe.js';
import { mapIngredientIcon } from '../parse/icons.js';

/** What the parse provider hands the repository to persist. */
export interface RecipeInput {
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  servings?: number;
  totalMinutes?: number;
  imageUrl?: string;
  confidence?: number;
  ingredients: string[];
  steps: string[];
}

/** A drizzle transaction client — the type passed to each write in `persist`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Persists a parsed recipe and saves it to the user's cookbook (O-08). One
 * transaction writes the recipe, its ingredients (each with an O-09 icon key),
 * its steps, and one `saved_recipes` join row. Idempotent on the unique
 * (user_id, recipe_id): a duplicate save is swallowed, not raised.
 *
 * ponytail: BR-07 thumbnail re-host is deferred — imageUrl is stored as-is and
 * the mobile app hotlinks it; re-host to object storage when hotlinking breaks.
 */
export class RecipeRepository {
  constructor(private readonly db: Database) {}

  /** Wire dependencies from the shared singletons. */
  static create(): RecipeRepository {
    return new RecipeRepository(db);
  }

  /**
   * Fetches one recipe with its ordered ingredients and steps. Recipes are shared
   * (canonical) entities, so any caller can read any recipe — browsing isn't
   * gated on having saved it.
   * @param recipeId - Recipe to fetch.
   * @returns The recipe aggregate, or null if no recipe has that id.
   */
  async findById(recipeId: string): Promise<RecipeDetail | null> {
    const [row] = await this.db.select().from(recipes).where(eq(recipes.id, recipeId));
    if (!row) return null;
    const ings = await this.db
      .select({
        name: ingredients.name,
        icon: ingredients.icon,
        quantityText: ingredients.quantityText,
        amount: ingredients.amount,
        unit: ingredients.unit,
      })
      .from(ingredients)
      .where(eq(ingredients.recipeId, recipeId))
      .orderBy(ingredients.position);
    const steps = await this.db
      .select({ text: recipeSteps.text })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(recipeSteps.position);
    return { recipe: RecipeSchema.parse(row), ingredients: ings, steps: steps.map((s) => s.text) };
  }

  /**
   * Inserts recipe + ingredients + steps + the cookbook join in one transaction.
   * @param recipe - Parsed recipe the provider hands over to persist.
   * @param userId - Owner to save the recipe for; the save is idempotent.
   * @returns The new recipe id.
   */
  async persist(recipe: RecipeInput, userId: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      const recipeId = await this.insertRecipe(tx, recipe);
      await this.insertIngredients(tx, recipeId, recipe.ingredients);
      await this.insertSteps(tx, recipeId, recipe.steps);
      await this.saveForUser(tx, recipeId, userId);
      return recipeId;
    });
  }

  /**
   * Inserts the recipe row (confidence numeric is stringified for pg).
   * @param tx - Active transaction client.
   * @param recipe - Recipe to insert; absent optionals become null.
   * @returns The new recipe id, parsed at the boundary.
   */
  private async insertRecipe(tx: Tx, recipe: RecipeInput): Promise<string> {
    const [row] = await tx
      .insert(recipes)
      .values({
        title: recipe.title,
        sourceType: recipe.sourceType,
        sourceUrl: recipe.sourceUrl ?? null,
        servings: recipe.servings ?? null,
        totalMinutes: recipe.totalMinutes ?? null,
        imageUrl: recipe.imageUrl ?? null,
        confidence: recipe.confidence != null ? String(recipe.confidence) : null,
      })
      .returning();
    return RecipeSchema.parse(row).id;
  }

  /**
   * Bulk-inserts ingredient rows, each tagged with an O-09 icon key; no-op if empty.
   * @param tx - Active transaction client.
   * @param recipeId - Parent recipe.
   * @param lines - Ingredient text lines; array order becomes `position`.
   */
  private async insertIngredients(tx: Tx, recipeId: string, lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.insert(ingredients).values(
      lines.map((name, i) => ({ recipeId, position: i, name, icon: mapIngredientIcon(name) })),
    );
  }

  /**
   * Bulk-inserts step rows; no-op if empty.
   * @param tx - Active transaction client.
   * @param recipeId - Parent recipe.
   * @param steps - Step text; array order becomes `position`.
   */
  private async insertSteps(tx: Tx, recipeId: string, steps: string[]): Promise<void> {
    if (steps.length === 0) return;
    await tx.insert(recipeSteps).values(steps.map((text, i) => ({ recipeId, position: i, text })));
  }

  /**
   * Saves the recipe to the user's cookbook; the unique (user_id, recipe_id)
   * index swallows a re-save, so this is idempotent.
   * @param tx - Active transaction client.
   * @param recipeId - Recipe to save.
   * @param userId - Owner.
   */
  private async saveForUser(tx: Tx, recipeId: string, userId: string): Promise<void> {
    await tx.insert(savedRecipes).values({ userId, recipeId }).onConflictDoNothing();
  }

  /**
   * Whether the user has this recipe in their library.
   * @param userId - Caller.
   * @param recipeId - Recipe to check.
   */
  async isSavedBy(userId: string, recipeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: savedRecipes.id })
      .from(savedRecipes)
      .where(and(eq(savedRecipes.userId, userId), eq(savedRecipes.recipeId, recipeId)));
    return Boolean(row);
  }

  /**
   * Whether a canonical recipe with this id exists.
   * @param recipeId - Recipe to check.
   */
  async exists(recipeId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId));
    return Boolean(row);
  }

  /**
   * Edits a recipe's ingredients and/or steps for the caller, copy-on-write: if any
   * other user also saved the recipe, the edit forks a private clone and repoints the
   * caller's library + cookbook rows to it; otherwise it edits in place. One transaction.
   * @param userId - Caller (already verified to have the recipe saved).
   * @param recipeId - Recipe to edit.
   * @param edit - New ingredient lines and/or step texts (full replacements).
   * @returns The id of the edited recipe — the same id, or a new clone id if forked.
   */
  async updateContent(userId: string, recipeId: string, edit: { ingredients?: string[]; steps?: string[] }): Promise<string> {
    return this.db.transaction(async (tx) => {
      const savers = await this.countSavers(tx, recipeId);
      let targetId = recipeId;
      if (savers > 1) {
        targetId = await this.cloneRecipe(tx, recipeId);
        await this.repointUser(tx, userId, recipeId, targetId);
      }
      if (edit.ingredients) await this.replaceIngredients(tx, targetId, edit.ingredients);
      if (edit.steps) await this.replaceSteps(tx, targetId, edit.steps);
      return targetId;
    });
  }

  /**
   * Removes the recipe from the caller's library and their cookbooks. The shared
   * `recipes` row is left intact for other savers. One transaction.
   * @param userId - Caller.
   * @param recipeId - Recipe to remove.
   * @returns true if the caller had it saved (else the caller should 404).
   */
  async removeForUser(userId: string, recipeId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const owned = await this.usersCookbookIds(tx, userId);
      if (owned.length > 0) {
        await tx
          .delete(cookbookRecipes)
          .where(and(eq(cookbookRecipes.recipeId, recipeId), inArray(cookbookRecipes.cookbookId, owned)));
      }
      const deleted = await tx
        .delete(savedRecipes)
        .where(and(eq(savedRecipes.userId, userId), eq(savedRecipes.recipeId, recipeId)))
        .returning({ id: savedRecipes.id });
      return deleted.length > 0;
    });
  }

  /** Counts how many users have this recipe saved. */
  private async countSavers(tx: Tx, recipeId: string): Promise<number> {
    const rows = await tx.select({ id: savedRecipes.id }).from(savedRecipes).where(eq(savedRecipes.recipeId, recipeId));
    return rows.length;
  }

  /** Deep-copies a recipe (row + ingredients + steps) to a new id. */
  private async cloneRecipe(tx: Tx, recipeId: string): Promise<string> {
    const [orig] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
    const [clone] = await tx
      .insert(recipes)
      .values({
        title: orig.title,
        sourceType: orig.sourceType,
        sourceUrl: orig.sourceUrl,
        servings: orig.servings,
        totalMinutes: orig.totalMinutes,
        imageUrl: orig.imageUrl,
        confidence: orig.confidence,
      })
      .returning();
    const origIngs = await tx.select().from(ingredients).where(eq(ingredients.recipeId, recipeId)).orderBy(ingredients.position);
    if (origIngs.length > 0) {
      await tx.insert(ingredients).values(
        origIngs.map((i) => ({
          recipeId: clone.id,
          position: i.position,
          name: i.name,
          quantityText: i.quantityText,
          amount: i.amount,
          unit: i.unit,
          icon: i.icon,
        })),
      );
    }
    const origSteps = await tx.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId)).orderBy(recipeSteps.position);
    if (origSteps.length > 0) {
      await tx.insert(recipeSteps).values(origSteps.map((s) => ({ recipeId: clone.id, position: s.position, text: s.text })));
    }
    return clone.id;
  }

  /** Repoints the caller's library + cookbook rows from `origId` to the clone. */
  private async repointUser(tx: Tx, userId: string, origId: string, cloneId: string): Promise<void> {
    await tx
      .update(savedRecipes)
      .set({ recipeId: cloneId })
      .where(and(eq(savedRecipes.userId, userId), eq(savedRecipes.recipeId, origId)));
    const owned = await this.usersCookbookIds(tx, userId);
    if (owned.length > 0) {
      await tx
        .update(cookbookRecipes)
        .set({ recipeId: cloneId })
        .where(and(eq(cookbookRecipes.recipeId, origId), inArray(cookbookRecipes.cookbookId, owned)));
    }
  }

  /** The caller's cookbook ids (for scoping membership writes). */
  private async usersCookbookIds(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx.select({ id: cookbooks.id }).from(cookbooks).where(eq(cookbooks.userId, userId));
    return rows.map((r) => r.id);
  }

  /** Replaces a recipe's ingredient rows from raw lines, re-resolving icons. */
  private async replaceIngredients(tx: Tx, recipeId: string, lines: string[]): Promise<void> {
    await tx.delete(ingredients).where(eq(ingredients.recipeId, recipeId));
    if (lines.length > 0) {
      await tx.insert(ingredients).values(lines.map((name, i) => ({ recipeId, position: i, name, icon: mapIngredientIcon(name) })));
    }
  }

  /** Replaces a recipe's step rows from texts. */
  private async replaceSteps(tx: Tx, recipeId: string, steps: string[]): Promise<void> {
    await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
    if (steps.length > 0) {
      await tx.insert(recipeSteps).values(steps.map((text, i) => ({ recipeId, position: i, text })));
    }
  }
}
