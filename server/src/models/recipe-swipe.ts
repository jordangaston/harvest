import { z } from 'zod';

// Swipe enum tuples, re-declared here (repo convention: the model validates
// independently of the Drizzle table).
const SWIPE_DIRECTIONS = ['like', 'dislike', 'save'] as const;
const SWIPE_REASONS = ['too_expensive', 'too_hard', 'too_slow', 'disliked_ingredient', 'not_nutritious', 'other'] as const;

/** A captured swipe: the direction, optional dislike reason, and the score snapshot. */
export const RecipeSwipeSchema = z.object({
  userId: z.string(),
  recipeId: z.string(),
  direction: z.enum(SWIPE_DIRECTIONS),
  reason: z.enum(SWIPE_REASONS).nullable(),
  score: z.number(),
  createdAt: z.date(),
});

export type RecipeSwipe = z.infer<typeof RecipeSwipeSchema>;
