import { z } from 'zod';

/** Domain model for a meal-plan entry row. `date` is an absolute calendar date
 * (pg `date` → 'YYYY-MM-DD' string); there is no timezone. */
export const MealPlanEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  date: z.string(),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  recipeId: z.string().uuid(),
  position: z.number().int(),
  // WI-MP-1: how the entry got here, and its leftover-batch grouping (null = single serve).
  source: z.enum(['manual', 'generated']),
  batchId: z.string().nullable(),
  createdAt: z.date(),
});

export type MealPlanEntry = z.infer<typeof MealPlanEntrySchema>;
export type MealSlot = MealPlanEntry['meal'];

/** The subset of a MealPlanEntry the generator supplies to persist (WI-MP-1): which recipe fills
 * which slot, plus an optional leftover-batch grouping. Derived from MealPlanEntry so it stays in
 * lockstep with the model — the repository owns the rest (`id`, `position`, `source`, `createdAt`). */
export type GeneratedMealPlanEntry = Pick<MealPlanEntry, 'date' | 'meal' | 'recipeId'> &
  Partial<Pick<MealPlanEntry, 'batchId'>>;

/** An entry joined with its recipe's card — what a plan read returns. */
export interface MealPlanEntryView {
  id: string;
  date: string;
  meal: MealSlot;
  position: number;
  recipe: { id: string; title: string; image_url?: string };
}

/** The public entry shape returned to clients (snake_case; already card-shaped). */
export type PublicMealPlanEntry = MealPlanEntryView;
