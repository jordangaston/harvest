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
  source: z.enum(['generated', 'manual']),
  createdAt: z.date(),
});

export type MealPlanEntry = z.infer<typeof MealPlanEntrySchema>;
export type MealSlot = MealPlanEntry['meal'];
export type MealPlanSource = MealPlanEntry['source'];

/** An entry joined with its recipe's card — what a plan read returns. */
export interface MealPlanEntryView {
  id: string;
  date: string;
  meal: MealSlot;
  position: number;
  source: MealPlanSource;
  recipe: { id: string; title: string; image_url?: string };
}

/** The public entry shape returned to clients (snake_case; already card-shaped). */
export type PublicMealPlanEntry = MealPlanEntryView;
