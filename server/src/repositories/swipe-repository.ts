import { and, eq, gte, or } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipeSwipes } from '../schema.js';
import { RecipeSwipeSchema, type RecipeSwipe } from '../models/recipe-swipe.js';

/** The write-side of a swipe (everything but the derived `userId`/`createdAt`). */
export interface SwipeInput {
  recipeId: string;
  direction: (typeof recipeSwipes.$inferInsert)['direction'];
  reason?: (typeof recipeSwipes.$inferInsert)['reason'];
  score: number;
  weights: RecipeSwipe['weights'];
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
      weights: input.weights,
      createdAt: new Date(),
    };
    const [row] = await this.db
      .insert(recipeSwipes)
      .values(values)
      .onConflictDoUpdate({
        target: [recipeSwipes.userId, recipeSwipes.recipeId],
        set: { direction: values.direction, reason: values.reason, score: values.score, weights: values.weights, createdAt: values.createdAt },
      })
      .returning();
    return RecipeSwipeSchema.parse(row);
  }

  /**
   * Recipe ids to exclude from the user's deck: every `like` (permanent) plus any
   * swipe at/after `cooldownCutoff` (recent dislikes rest before resurfacing).
   * @param cooldownCutoff - Swipes on/after this instant are still on cooldown.
   */
  async excludedRecipeIds(userId: string, cooldownCutoff: Date): Promise<Set<string>> {
    const rows = await this.db
      .select({ recipeId: recipeSwipes.recipeId })
      .from(recipeSwipes)
      .where(and(eq(recipeSwipes.userId, userId), or(eq(recipeSwipes.direction, 'like'), gte(recipeSwipes.createdAt, cooldownCutoff))));
    return new Set(rows.map((r) => r.recipeId));
  }
}
