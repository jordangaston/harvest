import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipeSwipes } from '../schema.js';
import { RecipeSwipeSchema, type RecipeSwipe } from '../models/recipe-swipe.js';

/** The write-side of a swipe (everything but the derived `userId`/`createdAt`). */
export interface SwipeInput {
  recipeId: string;
  direction: (typeof recipeSwipes.$inferInsert)['direction'];
  reason?: (typeof recipeSwipes.$inferInsert)['reason'];
  score: number;
}

/** Captured swipes: the feedback log that drives the deck and later ranking. */
export class SwipeRepository {
  constructor(private readonly db: Database) {}

  static create(db: Database): SwipeRepository {
    return new SwipeRepository(db);
  }

  /**
   * Records (or re-records) a swipe. Re-swiping the same recipe overwrites the row
   * (pk `(user_id, recipe_id)`), refreshing direction/reason/snapshot and `created_at`.
   * @returns The persisted swipe, parsed at the domain boundary.
   */
  async upsert(userId: string, input: SwipeInput): Promise<RecipeSwipe> {
    const values = {
      userId,
      recipeId: input.recipeId,
      direction: input.direction,
      reason: input.reason ?? null,
      score: input.score,
      createdAt: new Date(),
    };
    const [row] = await this.db
      .insert(recipeSwipes)
      .values(values)
      .onConflictDoUpdate({
        target: [recipeSwipes.userId, recipeSwipes.recipeId],
        set: { direction: values.direction, reason: values.reason, score: values.score, createdAt: values.createdAt },
      })
      .returning();
    return RecipeSwipeSchema.parse(row);
  }

  /**
   * Removes the `(user, recipe)` swipe if present, returning the removed row (or null) so the
   * caller can reverse any cookbook filing. Idempotent — deleting a non-existent swipe is a no-op.
   */
  async delete(userId: string, recipeId: string): Promise<RecipeSwipe | null> {
    const [row] = await this.db
      .delete(recipeSwipes)
      .where(and(eq(recipeSwipes.userId, userId), eq(recipeSwipes.recipeId, recipeId)))
      .returning();
    return row ? RecipeSwipeSchema.parse(row) : null;
  }

  /**
   * Recipe ids to exclude from the user's deck: every `like`/`save` (permanent) plus any
   * swipe at/after `cooldownCutoff` (recent dislikes rest before resurfacing).
   * @param cooldownCutoff - Swipes on/after this instant are still on cooldown.
   */
  async excludedRecipeIds(userId: string, cooldownCutoff: Date): Promise<Set<string>> {
    const rows = await this.db
      .select({ recipeId: recipeSwipes.recipeId })
      .from(recipeSwipes)
      .where(and(eq(recipeSwipes.userId, userId), or(inArray(recipeSwipes.direction, ['like', 'save']), gte(recipeSwipes.createdAt, cooldownCutoff))));
    return new Set(rows.map((r) => r.recipeId));
  }
}
