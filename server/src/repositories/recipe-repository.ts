import { eq, and, desc, or, exists, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipes, ingredients, recipeSteps, cookbooks, cookbookRecipes, type SourceType } from '../schema.js';
import { RecipeSchema, type Recipe, type RecipeDetail, type RecipeCard, type RecipeCardPage } from '../models/recipe.js';
import type { StructuredIngredient } from '../parse/ingredient.js';
import type { Nutrition } from '../models/label-core.js';
import { mapIngredientIcon } from '../parse/icons.js';

/** What the parse provider hands the repository to persist. */
export interface RecipeInput {
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  servings: number;
  servingsEstimated: boolean;
  totalMinutes?: number;
  imageUrl?: string;
  confidence?: number;
  ingredients: StructuredIngredient[];
  steps: string[];
  nutrition: Nutrition | null;
}

/** A drizzle transaction client — the type passed to each write in `persist`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Persists a parsed recipe owned by its creator (C6). One interactive transaction
 * writes the recipe (with its `user_id`, C4 servings estimate, and C5 nutrition),
 * its ingredients (separated amount/unit/quantity_text, C3, and an O-09 icon key),
 * and its steps. Saving into a cookbook is a separate `cookbook_recipes` concern.
 */
export class RecipeRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database): RecipeRepository {
    return new RecipeRepository(db);
  }

  /**
   * Fetches one recipe with its ordered ingredients and steps. Recipes are shared
   * (canonical) entities, so any caller can read any recipe.
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
   * Inserts recipe + ingredients + steps, owned by `userId`. Opens its own
   * transaction, or joins a caller's `tx` when the write must commit atomically
   * with other rows (the import persist links the job in the same transaction).
   * @param recipe - Parsed recipe the provider hands over to persist.
   * @param userId - The creator/owner (`recipes.user_id`).
   * @param tx - Executor; a caller's transaction client, else the db singleton.
   * @returns The new recipe id.
   */
  async persist(recipe: RecipeInput, userId: string, tx?: Tx): Promise<string> {
    if (tx) return this.persistWith(tx, recipe, userId);
    return this.db.transaction((t) => this.persistWith(t, recipe, userId));
  }

  /** Writes the recipe aggregate on an active transaction client. */
  private async persistWith(tx: Tx, recipe: RecipeInput, userId: string): Promise<string> {
    const recipeId = await this.insertRecipe(tx, recipe, userId);
    await this.insertIngredients(tx, recipeId, recipe.ingredients);
    await this.insertSteps(tx, recipeId, recipe.steps);
    return recipeId;
  }

  /**
   * Inserts the recipe row (numeric fields are stringified).
   * @param tx - Active transaction client.
   * @param recipe - Recipe to insert; absent optionals become null.
   * @param userId - The owner.
   * @returns The new recipe id, parsed at the boundary.
   */
  private async insertRecipe(tx: Tx, recipe: RecipeInput, userId: string): Promise<string> {
    const [row] = await tx
      .insert(recipes)
      .values({
        userId,
        title: recipe.title,
        sourceType: recipe.sourceType,
        sourceUrl: recipe.sourceUrl ?? null,
        servings: recipe.servings,
        servingsEstimated: recipe.servingsEstimated,
        totalMinutes: recipe.totalMinutes ?? null,
        imageUrl: recipe.imageUrl ?? null,
        confidence: recipe.confidence != null ? String(recipe.confidence) : null,
        ...nutritionColumns(recipe.nutrition),
      })
      .returning();
    return RecipeSchema.parse(row).id;
  }

  /**
   * Bulk-inserts ingredient rows with separated amount/unit/quantity_text (C3) and
   * an O-09 icon key; no-op if empty.
   * @param tx - Active transaction client.
   * @param recipeId - Parent recipe.
   * @param items - Structured ingredients; array order becomes `position`.
   */
  private async insertIngredients(tx: Tx, recipeId: string, items: StructuredIngredient[]): Promise<void> {
    if (items.length === 0) return;
    await tx.insert(ingredients).values(items.map((item, i) => toIngredientRow(recipeId, item, i)));
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
   * Whether a canonical recipe with this id exists.
   * @param recipeId - Recipe to check.
   */
  async exists(recipeId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId));
    return Boolean(row);
  }

  /**
   * The owner (creator) of a recipe, or null if the recipe doesn't exist. The
   * single source of truth for edit/delete authorization (C6).
   * @param recipeId - Recipe to check.
   */
  async findOwner(recipeId: string): Promise<string | null> {
    const [row] = await this.db.select({ userId: recipes.userId }).from(recipes).where(eq(recipes.id, recipeId));
    return row?.userId ?? null;
  }

  /**
   * The recipes a user created (owns), newest first.
   * @param userId - Owner.
   */
  async listOwned(userId: string): Promise<Recipe[]> {
    const rows = await this.db.select().from(recipes).where(eq(recipes.userId, userId)).orderBy(desc(recipes.createdAt));
    return rows.map((row) => RecipeSchema.parse(row));
  }

  /**
   * One page of the caller's library — recipes they own ∪ recipes in any of their
   * cookbooks, deduped (one row per recipe), newest first. Keyset-paginated on
   * `(created_at, id)` so ties don't overlap or skip. `expand` opts into the
   * per-recipe ingredient names and the caller's cookbook ids holding it.
   * @param userId - The library owner.
   * @param opts - `limit` page size, optional `cursor` (from a prior page), and `expand` flags.
   * @returns The page's cards plus the next `pageToken` (null at the end).
   */
  async listCards(
    userId: string,
    opts: { limit: number; cursor?: string; expand: { ingredientNames: boolean; cookbookIds: boolean } },
  ): Promise<RecipeCardPage> {
    const inCookbook = exists(
      this.db
        .select({ one: sql`1` })
        .from(cookbookRecipes)
        .innerJoin(cookbooks, eq(cookbooks.id, cookbookRecipes.cookbookId))
        .where(and(eq(cookbookRecipes.recipeId, recipes.id), eq(cookbooks.userId, userId))),
    );
    const visible = or(eq(recipes.userId, userId), inCookbook);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    // SQLite has no row-value tuple comparison; expand `(created_at, id) < (c, i)`
    // by hand. `created_at` is stored as an epoch (timestamp mode), so bind the
    // cursor's Date the same way drizzle binds the column.
    const keyset = decoded
      ? or(
          sql`${recipes.createdAt} < ${decoded.createdAt}`,
          and(sql`${recipes.createdAt} = ${decoded.createdAt}`, sql`${recipes.id} < ${decoded.id}`),
        )
      : undefined;

    const rows = await this.db
      .select({
        id: recipes.id,
        title: recipes.title,
        imageUrl: recipes.imageUrl,
        totalMinutes: recipes.totalMinutes,
        createdAt: recipes.createdAt,
      })
      .from(recipes)
      .where(and(visible, keyset))
      .orderBy(desc(recipes.createdAt), desc(recipes.id))
      .limit(opts.limit + 1);

    const hasMore = rows.length > opts.limit;
    const page = rows.slice(0, opts.limit);
    const ids = page.map((r) => r.id);
    const names = opts.expand.ingredientNames ? await this.ingredientNamesByRecipe(ids) : null;
    const cbIds = opts.expand.cookbookIds ? await this.cookbookIdsByRecipe(userId, ids) : null;

    const cards: RecipeCard[] = page.map((r) => {
      const card: RecipeCard = { id: r.id, title: r.title, imageUrl: r.imageUrl, totalMinutes: r.totalMinutes };
      if (names) card.ingredientNames = names.get(r.id) ?? [];
      if (cbIds) card.cookbookIds = cbIds.get(r.id) ?? [];
      return card;
    });
    const last = page[page.length - 1];
    return { cards, pageToken: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  /** Maps each recipe id → its ordered ingredient names (empty ids → empty map). */
  private async ingredientNamesByRecipe(recipeIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (recipeIds.length === 0) return map;
    const rows = await this.db
      .select({ recipeId: ingredients.recipeId, name: ingredients.name })
      .from(ingredients)
      .where(inArray(ingredients.recipeId, recipeIds))
      .orderBy(ingredients.recipeId, ingredients.position);
    for (const row of rows) {
      const list = map.get(row.recipeId) ?? [];
      list.push(row.name);
      map.set(row.recipeId, list);
    }
    return map;
  }

  /** Maps each recipe id → the caller's cookbook ids holding it (caller-scoped). */
  private async cookbookIdsByRecipe(userId: string, recipeIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (recipeIds.length === 0) return map;
    const rows = await this.db
      .select({ recipeId: cookbookRecipes.recipeId, cookbookId: cookbookRecipes.cookbookId })
      .from(cookbookRecipes)
      .innerJoin(cookbooks, eq(cookbooks.id, cookbookRecipes.cookbookId))
      .where(and(eq(cookbooks.userId, userId), inArray(cookbookRecipes.recipeId, recipeIds)));
    for (const row of rows) {
      const list = map.get(row.recipeId) ?? [];
      list.push(row.cookbookId);
      map.set(row.recipeId, list);
    }
    return map;
  }

  /**
   * Edits a recipe's ingredients and/or steps in place (C6). One transaction.
   * Authorization is the caller's concern (via {@link findOwner}).
   * @param recipeId - Recipe to edit.
   * @param edit - New structured ingredients and/or step texts (full replacements).
   */
  async updateContent(recipeId: string, edit: { ingredients?: StructuredIngredient[]; steps?: string[] }): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (edit.ingredients) await this.replaceIngredients(tx, recipeId, edit.ingredients);
      if (edit.steps) await this.replaceSteps(tx, recipeId, edit.steps);
    });
  }

  /**
   * Deletes a recipe the caller owns. Children (ingredients, steps, cookbook and
   * import-job rows) fall away via their `onDelete: cascade` FKs.
   * @param userId - Caller (must own the recipe).
   * @param recipeId - Recipe to delete.
   * @returns true if a recipe was deleted (else the caller should 404).
   */
  async deleteOwned(userId: string, recipeId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.userId, userId)))
      .returning({ id: recipes.id });
    return deleted.length > 0;
  }

  /** Replaces a recipe's ingredient rows from structured items, re-resolving icons. */
  private async replaceIngredients(tx: Tx, recipeId: string, items: StructuredIngredient[]): Promise<void> {
    await tx.delete(ingredients).where(eq(ingredients.recipeId, recipeId));
    if (items.length > 0) {
      await tx.insert(ingredients).values(items.map((item, i) => toIngredientRow(recipeId, item, i)));
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

/** Encodes a keyset cursor from a row's `(created_at, id)`. `created_at` is stored
 * as epoch seconds (drizzle `mode: 'timestamp'`), so the cursor carries that int. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${Math.floor(createdAt.getTime() / 1000)}|${id}`, 'utf8').toString('base64url');
}

/** Decodes a keyset cursor back to its `createdAt` epoch-seconds int and `id`. */
function decodeCursor(token: string): { createdAt: number; id: string } {
  const [createdAt, id] = Buffer.from(token, 'base64url').toString('utf8').split('|');
  return { createdAt: Number(createdAt), id: id! };
}

/** One structured ingredient → its insert row (position + O-09 icon on the name). */
function toIngredientRow(recipeId: string, item: StructuredIngredient, position: number) {
  return {
    recipeId,
    position,
    name: item.name,
    amount: item.amount,
    unit: item.unit,
    quantityText: item.quantityText,
    icon: mapIngredientIcon(item.name),
  };
}

/** The nutrition columns for an insert, or an all-null spread when unknown. */
function nutritionColumns(nutrition: Nutrition | null) {
  const v = nutrition?.values;
  return {
    calories: v?.calories ?? null,
    gramsOfFat: v?.grams_of_fat ?? null,
    gramsOfSaturatedFat: v?.grams_of_saturated_fat ?? null,
    gramsOfCarbohydrate: v?.grams_of_carbohydrate ?? null,
    gramsOfFiber: v?.grams_of_fiber ?? null,
    gramsOfSugar: v?.grams_of_sugar ?? null,
    gramsOfProtein: v?.grams_of_protein ?? null,
    milligramsOfSodium: v?.milligrams_of_sodium ?? null,
    nutritionSource: nutrition?.source ?? null,
  };
}
