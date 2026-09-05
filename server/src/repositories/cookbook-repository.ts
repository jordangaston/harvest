import { and, eq, inArray, desc } from 'drizzle-orm';
import type { Database } from '../db.js';
import { cookbooks, cookbookRecipes, recipes } from '../schema.js';
import { CookbookSchema, type Cookbook, type CookbookSummary } from '../models/cookbook.js';
import { CookbookExistsError } from '../errors.js';

/** A drizzle transaction client — the type passed to each write in a transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Named cookbooks and their recipe membership. A cookbook is owner-scoped; the
 * recipes it holds are the shared canonical entities (organization, not ownership).
 */
export class CookbookRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database): CookbookRepository {
    return new CookbookRepository(db);
  }

  /**
   * Creates a cookbook for the user.
   * @param userId - Owner.
   * @param name - Display name (already trimmed/validated non-empty).
   * @returns The created cookbook.
   * @throws {CookbookExistsError} 409 if the user already owns a cookbook with that name.
   */
  async create(userId: string, name: string): Promise<Cookbook> {
    try {
      const [row] = await this.db.insert(cookbooks).values({ userId, name }).returning();
      return CookbookSchema.parse(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new CookbookExistsError();
      throw error;
    }
  }

  /**
   * Lists the user's cookbooks (newest first) with a recipe count and a cover image
   * (the most recently added recipe's image). One left-joined query, reduced in memory.
   * @param userId - Owner.
   */
  async listForUser(userId: string): Promise<CookbookSummary[]> {
    const rows = await this.db
      .select({
        id: cookbooks.id,
        userId: cookbooks.userId,
        name: cookbooks.name,
        systemSlug: cookbooks.systemSlug,
        createdAt: cookbooks.createdAt,
        recipeId: cookbookRecipes.recipeId,
        imageUrl: recipes.imageUrl,
      })
      .from(cookbooks)
      .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
      .leftJoin(recipes, eq(recipes.id, cookbookRecipes.recipeId))
      .where(eq(cookbooks.userId, userId))
      .orderBy(desc(cookbooks.createdAt), desc(cookbookRecipes.createdAt));

    const byId = new Map<string, CookbookSummary>();
    for (const row of rows) {
      let summary = byId.get(row.id);
      if (!summary) {
        summary = {
          cookbook: CookbookSchema.parse({ id: row.id, userId: row.userId, name: row.name, systemSlug: row.systemSlug, createdAt: row.createdAt }),
          recipeCount: 0,
          coverImageUrl: null,
        };
        byId.set(row.id, summary);
      }
      if (row.recipeId) {
        summary.recipeCount += 1;
        if (!summary.coverImageUrl && row.imageUrl) summary.coverImageUrl = row.imageUrl;
      }
    }
    return [...byId.values()];
  }

  /**
   * Fetches one of the caller's cookbooks with its recipes (newest first).
   * @param userId - Owner; a cookbook that isn't theirs reads as null.
   * @param cookbookId - Cookbook to fetch.
   * @returns The cookbook plus its recipe cards, or null if not found/owned.
   */
  async getForUser(
    userId: string,
    cookbookId: string,
  ): Promise<{ cookbook: Cookbook; recipes: { id: string; title: string; image_url?: string }[] } | null> {
    const [row] = await this.db
      .select()
      .from(cookbooks)
      .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.userId, userId)));
    if (!row) return null;
    const recipeRows = await this.db
      .select({ id: recipes.id, title: recipes.title, imageUrl: recipes.imageUrl })
      .from(cookbookRecipes)
      .innerJoin(recipes, eq(recipes.id, cookbookRecipes.recipeId))
      .where(eq(cookbookRecipes.cookbookId, cookbookId))
      .orderBy(desc(cookbookRecipes.createdAt));
    return {
      cookbook: CookbookSchema.parse(row),
      recipes: recipeRows.map((r) => (r.imageUrl ? { id: r.id, title: r.title, image_url: r.imageUrl } : { id: r.id, title: r.title })),
    };
  }

  /**
   * Returns the id of the caller's cookbook marked with `system_slug=slug`, lazily
   * creating it (with `name`) if absent. Idempotent via the unique `(user, slug)` index.
   * @param slug - The system marker (e.g. 'liked').
   * @param name - Display name used only when creating.
   */
  async ensureSystemCookbook(userId: string, slug: string, name: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: cookbooks.id })
      .from(cookbooks)
      .where(and(eq(cookbooks.userId, userId), eq(cookbooks.systemSlug, slug)));
    if (existing) return existing.id;
    // Idempotent under a concurrent first-like: onConflictDoNothing lets the loser of the
    // (user, slug) unique-index race fall through to re-read the winner's row, not 500.
    await this.db.insert(cookbooks).values({ userId, name, systemSlug: slug }).onConflictDoNothing();
    const [row] = await this.db
      .select({ id: cookbooks.id })
      .from(cookbooks)
      .where(and(eq(cookbooks.userId, userId), eq(cookbooks.systemSlug, slug)));
    return row!.id;
  }

  /** The recipe ids in the caller's system cookbook of `slug` (e.g. 'liked'/'saved'); empty when
   *  the cookbook doesn't exist yet. Read-only — used to tier meal-plan candidates. */
  async systemCookbookRecipeIds(userId: string, slug: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ recipeId: cookbookRecipes.recipeId })
      .from(cookbooks)
      .innerJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
      .where(and(eq(cookbooks.userId, userId), eq(cookbooks.systemSlug, slug)));
    return new Set(rows.map((r) => r.recipeId));
  }

  /** Idempotently files a recipe into a cookbook (no-op if already a member). */
  async addRecipe(userId: string, cookbookId: string, recipeId: string): Promise<void> {
    await this.db.insert(cookbookRecipes).values({ cookbookId, recipeId }).onConflictDoNothing();
  }

  /** Idempotently un-files a recipe from a cookbook (no-op if not a member). */
  async removeRecipe(userId: string, cookbookId: string, recipeId: string): Promise<void> {
    await this.db
      .delete(cookbookRecipes)
      .where(and(eq(cookbookRecipes.cookbookId, cookbookId), eq(cookbookRecipes.recipeId, recipeId)));
  }

  /**
   * Sets the caller's cookbook membership for a recipe: makes membership exactly
   * `cookbookIds` (restricted to the caller's own cookbooks — ids they don't own are
   * ignored). Filing a recipe into a cookbook IS the save (C6). One transaction.
   * @param userId - Owner.
   * @param recipeId - Recipe to file (must already exist; checked by the service).
   * @param cookbookIds - The complete set of the caller's cookbooks the recipe should sit in.
   * @returns The applied cookbook ids (owned subset).
   */
  async setMembership(userId: string, recipeId: string, cookbookIds: string[]): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const owned = await this.ownedIds(tx, userId, cookbookIds);
      await this.replaceMembership(tx, userId, recipeId, owned);
      return owned;
    });
  }

  /** Filters `cookbookIds` down to the ones the user actually owns. */
  private async ownedIds(tx: Tx, userId: string, cookbookIds: string[]): Promise<string[]> {
    if (cookbookIds.length === 0) return [];
    const rows = await tx
      .select({ id: cookbooks.id })
      .from(cookbooks)
      .where(and(eq(cookbooks.userId, userId), inArray(cookbooks.id, cookbookIds)));
    return rows.map((r) => r.id);
  }

  /**
   * Makes the recipe's membership across the caller's cookbooks exactly `owned`:
   * drops rows for the caller's other cookbooks, adds the missing ones.
   */
  private async replaceMembership(tx: Tx, userId: string, recipeId: string, owned: string[]): Promise<void> {
    const usersCookbooks = await tx.select({ id: cookbooks.id }).from(cookbooks).where(eq(cookbooks.userId, userId));
    const toRemove = usersCookbooks.map((c) => c.id).filter((id) => !owned.includes(id));
    if (toRemove.length > 0) {
      await tx
        .delete(cookbookRecipes)
        .where(and(eq(cookbookRecipes.recipeId, recipeId), inArray(cookbookRecipes.cookbookId, toRemove)));
    }
    if (owned.length > 0) {
      await tx
        .insert(cookbookRecipes)
        .values(owned.map((cookbookId) => ({ cookbookId, recipeId })))
        .onConflictDoNothing();
    }
  }
}

/**
 * Delta (a): narrows a thrown value to a libSQL UNIQUE-constraint violation (not
 * the Postgres SQLSTATE `23505`). @libsql/client throws a `LibsqlError` whose
 * `code` is `SQLITE_CONSTRAINT` (rawCode 2067) and whose message is
 * `SQLITE_CONSTRAINT: UNIQUE constraint failed: <cols>`. drizzle may wrap it, so
 * walk the `.cause` chain and match on the `UNIQUE constraint failed` message —
 * the discriminator that separates a duplicate name from any other constraint.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e != null; e = (e as { cause?: unknown }).cause) {
    if (typeof e !== 'object') continue;
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes('UNIQUE constraint failed')) return true;
  }
  return false;
}
