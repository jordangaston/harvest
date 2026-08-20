import { z } from 'zod';

// Swipe enum tuples, re-declared here (repo convention: the model validates
// independently of the Drizzle table).
const SWIPE_DIRECTIONS = ['like', 'dislike', 'save'] as const;
const SWIPE_REASONS = ['too_expensive', 'too_hard', 'too_slow', 'disliked_ingredient', 'not_nutritious', 'other'] as const;

const weight = () => z.number().int().min(0).max(3);

/** A captured swipe: the direction, optional dislike reason, and the scored snapshot. */
export const RecipeSwipeSchema = z.object({
  userId: z.string(),
  recipeId: z.string(),
  direction: z.enum(SWIPE_DIRECTIONS),
  reason: z.enum(SWIPE_REASONS).nullable(),
  score: z.number(),
  weights: z.object({
    cost: weight(),
    difficulty: weight(),
    nutrition: weight(),
    affinity: weight(),
    time: weight(),
    popularity: weight(),
    mealPrep: weight(),
  }),
  createdAt: z.date(),
});

export type RecipeSwipe = z.infer<typeof RecipeSwipeSchema>;
