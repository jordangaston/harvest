import { eq, and, desc, or, exists, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipes, ingredients, recipeSteps, recipeCategories, recipeDiets, cookbooks, cookbookRecipes, type SourceType } from '../schema.js';
import {
  RecipeSchema,
  emptyCategories,
  type Recipe,
  type RecipeDetail,
  type RecipeCategories,
  type RecipeDietVerdict,
  type RecipeCard,
  type RecipeCardPage,
  type RecipeDifficulty,
} from '../models/recipe.js';
import type { StructuredIngredient } from '../parse/ingredient.js';
import type { Nutrition } from '../models/label-core.js';
import type { Allergen, RecipeAllergens } from '../allergen/allergen.js';
import type { DietCompat } from '../diet/diet.js';
import type { RecipeCost } from '../price/cost-estimator.js';
import { mapIngredientIcon } from '../parse/icons.js';

/** Maps a `RecipeCategories` key to its `recipe_categories.facet` enum value. */
const FACET_BY_KEY = {
  cuisine: 'cuisine',
  mealType: 'meal_type',
  dishType: 'dish_type',
  primaryIngredient: 'primary_ingredient',
} as const;

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
  nrfScore?: number;
  allergens: RecipeAllergens | null;
  /** Taste facets (WI-TS-1). Omit for "no categories" — persists zero rows. */
  categories?: RecipeCategories;
  /** Diet compatibility (WI-DS-1). Omit/null for "withheld" — persists zero rows. */
  diets?: DietCompat | null;
  /** Difficulty signal (WI-DIFF-3). Omit when scoring was skipped/failed — persists
   * null columns and null per-step difficulties. `stepDifficulties` aligns to `steps`. */
  difficulty?: RecipeDifficulty;
  /** Cost signal (WI-CS-2). Null/omit when unpriceable — persists null columns. */
  cost?: RecipeCost | null;
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
      .select({ text: recipeSteps.text, difficulty: recipeSteps.difficulty, techniques: recipeSteps.techniques })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(recipeSteps.position);
    const categories = await this.categoriesByRecipe(recipeId);
    const diets = await this.dietsByRecipe(recipeId);
    const recipe = RecipeSchema.parse(row);
    const stepDifficulties = steps.map((s) => s.difficulty);
    const stepTechniques = steps.map((s) => s.techniques);
    return {
      recipe,
      ingredients: ings,
      steps: steps.map((s) => s.text),
      categories,
      diets,
      difficulty: toDifficulty(recipe, stepDifficulties, stepTechniques),
      stepDifficulties,
      stepTechniques,
    };
  }

  /** Reads a recipe's diet verdicts (WI-DS-1), ordered by diet id for determinism. */
  private async dietsByRecipe(recipeId: string): Promise<RecipeDietVerdict[]> {
    const rows = await this.db
      .select({
        dietId: recipeDiets.dietId,
        verdict: recipeDiets.verdict,
        blockerKind: recipeDiets.blockerKind,
        blockerValue: recipeDiets.blockerValue,
        blockerClass: recipeDiets.blockerClass,
      })
      .from(recipeDiets)
      .where(eq(recipeDiets.recipeId, recipeId))
      .orderBy(recipeDiets.dietId);
    return rows.map((r) => {
      const verdict: RecipeDietVerdict = { dietId: r.dietId, verdict: r.verdict };
      if (r.blockerKind && r.blockerValue) {
        verdict.blocker = { kind: r.blockerKind, value: r.blockerValue, ...(r.blockerClass ? { class: r.blockerClass } : {}) };
      }
      return verdict;
    });
  }

  /** Reads a recipe's taste facets, bucketed by facet into `RecipeCategories`.
   * Ordered by (facet, value) so the arrays are deterministic. */
  private async categoriesByRecipe(recipeId: string): Promise<RecipeCategories> {
    const rows = await this.db
      .select({ facet: recipeCategories.facet, value: recipeCategories.value })
      .from(recipeCategories)
      .where(eq(recipeCategories.recipeId, recipeId))
      .orderBy(recipeCategories.facet, recipeCategories.value);
    const categories = emptyCategories();
    const BUCKET = { cuisine: categories.cuisine, meal_type: categories.mealType, dish_type: categories.dishType, primary_ingredient: categories.primaryIngredient };
    for (const { facet, value } of rows) BUCKET[facet].push(value);
    return categories;
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
    await this.insertSteps(tx, recipeId, recipe.steps, recipe.difficulty?.stepDifficulties, recipe.difficulty?.stepTechniques);
    await this.insertCategories(tx, recipeId, recipe.categories);
    await this.insertDiets(tx, recipeId, recipe.diets);
    return recipeId;
  }

  /**
   * Bulk-inserts the recipe's diet verdicts — one row per diet (WI-DS-1). No-op when
   * withheld. `onConflictDoNothing` keeps a workflow replay idempotent.
   * @param tx - Active transaction client.
   * @param recipeId - Parent recipe.
   * @param diets - The classifier result; null/undefined means "withheld".
   */
  private async insertDiets(tx: Tx, recipeId: string, diets?: DietCompat | null): Promise<void> {
    if (!diets) return;
    const rows = Object.entries(diets.fit).map(([dietId, verdict]) => {
      const blocker = diets.blockers[dietId];
      return {
        recipeId,
        dietId,
        verdict,
        blockerKind: blocker?.kind ?? null,
        blockerValue: blocker?.value ?? null,
        blockerClass: blocker?.class ?? null,
      };
    });
    if (rows.length === 0) return;
    await tx.insert(recipeDiets).values(rows).onConflictDoNothing();
  }

  /**
   * Bulk-inserts the recipe's taste facets — one row per (facet, value). No-op when
   * absent or all-empty. `onConflictDoNothing` keeps a workflow replay idempotent.
   * @param tx - Active transaction client.
   * @param recipeId - Parent recipe.
   * @param categories - The facet value lists; undefined means "none".
   */
  private async insertCategories(tx: Tx, recipeId: string, categories?: RecipeCategories): Promise<void> {
    if (!categories) return;
    const rows = (Object.keys(FACET_BY_KEY) as (keyof RecipeCategories)[]).flatMap((key) =>
      categories[key].map((value) => ({ recipeId, facet: FACET_BY_KEY[key], value })),
    );
    if (rows.length === 0) return;
    await tx.insert(recipeCategories).values(rows).onConflictDoNothing();
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
        nrfScore: recipe.nrfScore != null ? String(recipe.nrfScore) : null,
        difficultyScore: recipe.difficulty ? String(recipe.difficulty.score) : null,
        difficultyBand: recipe.difficulty?.band ?? null,
        costPerServingCents: recipe.cost?.centsPerServing ?? null,
        costCoverage: recipe.cost != null ? String(recipe.cost.coverage) : null,
        ...nutritionColumns(recipe.nutrition),
        ...allergenColumns(recipe.allergens),
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
   * Bulk-inserts step rows; no-op if empty. Each row carries its WI-DIFF-3 per-step
   * difficulty, index-aligned to `steps`; null when the recipe has no difficulty.
   * @param tx - Active transaction client.
   * @param recipeId - Parent recipe.
   * @param steps - Step text; array order becomes `position`.
   * @param difficulties - Per-step weights aligned to `steps`, or undefined when unscored.
   * @param techniques - Per-step detected technique names (WI-DIFF-5) aligned to `steps`;
   *   an empty/absent row stores null, so an un-detected step reads back as null.
   */
  private async insertSteps(tx: Tx, recipeId: string, steps: string[], difficulties?: number[], techniques?: string[][]): Promise<void> {
    if (steps.length === 0) return;
    await tx.insert(recipeSteps).values(
      steps.map((text, i) => {
        const t = techniques?.[i];
        return { recipeId, position: i, text, difficulty: difficulties?.[i] ?? null, techniques: t && t.length ? t : null };
      }),
    );
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
        difficultyBand: recipes.difficultyBand,
        costPerServingCents: recipes.costPerServingCents,
        costCoverage: recipes.costCoverage,
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
      const card: RecipeCard = { id: r.id, title: r.title, imageUrl: r.imageUrl, totalMinutes: r.totalMinutes, difficultyBand: r.difficultyBand, costPerServingCents: r.costPerServingCents, costCoverage: r.costCoverage == null ? null : Number(r.costCoverage) };
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

/** Reconstructs the WI-DIFF-3/5 difficulty value object from the stored recipe columns,
 * or null for a pre-feature recipe (columns null). `stepDifficulties` drops the nulls —
 * a scored recipe has a weight on every stored step — and `stepTechniques` stays aligned
 * to it (a null techniques row → `[]`). */
function toDifficulty(
  recipe: Recipe,
  stepDifficulties: (number | null)[],
  stepTechniques: (string[] | null)[],
): RecipeDifficulty | null {
  if (recipe.difficultyScore == null || recipe.difficultyBand == null) return null;
  return {
    score: Number(recipe.difficultyScore),
    band: recipe.difficultyBand,
    stepDifficulties: stepDifficulties.filter((d): d is number => d != null),
    stepTechniques: stepTechniques.map((t) => t ?? []),
  };
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
    nutritionSource: (nutrition ? (nutrition.estimated ? 'computed' : 'parsed') : null) as 'parsed' | 'computed' | null,
  };
}

/**
 * The allergen columns for an insert. A null profile (withheld) stores null JSON +
 * `complete = false`; else the presences bucket into `contains` / `may_contain` lists.
 * A false-absent is impossible: an unrecognized ingredient only drops `complete`.
 */
function allergenColumns(a: RecipeAllergens | null) {
  if (!a) return { allergens: null, allergensComplete: false };
  const contains: Allergen[] = [];
  const mayContain: Allergen[] = [];
  for (const [allergen, presence] of Object.entries(a.presences) as [Allergen, string][]) {
    (presence === 'contains' ? contains : mayContain).push(allergen);
  }
  return { allergens: { contains, mayContain }, allergensComplete: a.complete };
}
