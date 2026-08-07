import { eq, and, desc } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { recipes, ingredients, recipeSteps } from '../db/schema/index.js';
import type { SourceType } from '../db/schema/enums.js';
import { RecipeSchema, type Recipe, type RecipeDetail } from '../models/recipe.js';
import type { StructuredIngredient } from '../parse/ingredient.js';
import type { Nutrition } from '../nutrition/label-core.js';
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
 * Persists a parsed recipe owned by its creator (C6). One transaction writes the
 * recipe (with its `user_id`, C4 servings estimate, and C5 nutrition), its
 * ingredients (each with separated amount/unit/quantity_text, C3, and an O-09 icon
 * key), and its steps. Saving into a cookbook is a separate `cookbook_recipes`
 * concern — a recipe's owner is `recipes.user_id`, not a saved_recipes row.
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
   * gated on ownership.
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
   * Inserts recipe + ingredients + steps in one transaction, owned by `userId`.
   * @param recipe - Parsed recipe the provider hands over to persist.
   * @param userId - The creator/owner (`recipes.user_id`).
   * @returns The new recipe id.
   */
  async persist(recipe: RecipeInput, userId: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      const recipeId = await this.insertRecipe(tx, recipe, userId);
      await this.insertIngredients(tx, recipeId, recipe.ingredients);
      await this.insertSteps(tx, recipeId, recipe.steps);
      return recipeId;
    });
  }

  /**
   * Inserts the recipe row (numeric fields are stringified for pg).
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
   * Edits a recipe's ingredients and/or steps in place (C6 — copy-on-write is
   * gone; the owner edits the canonical row). One transaction. Authorization is
   * the caller's concern (via {@link findOwner}).
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
