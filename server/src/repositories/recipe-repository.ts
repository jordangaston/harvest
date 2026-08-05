import { db, type Database } from '../db/index.js';
import { recipes, ingredients, recipeSteps, savedRecipes } from '../db/schema/index.js';
import type { SourceType } from '../db/schema/enums.js';
import { RecipeSchema } from '../models/recipe.js';
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
}
