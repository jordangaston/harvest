import type { Equipment, Essentiality } from '../schema.js';

/** Recipe-with-signals the engine consumes; WI-RANK-3 populates it from the DB. */
export type RankableRecipe = {
  id: string;
  createdAt: Date;
  costPerServingCents: number | null;
  difficultyBand: 'beginner' | 'intermediate' | 'advanced' | null;
  nrfScore: number | null;
  totalMinutes: number | null;
  categories: { cuisine: string[]; dishType: string[]; primaryIngredient: string[] };
  allergens: { contains: string[]; mayContain: string[]; complete: boolean };
  dietFit: Record<string, 'compatible' | 'incompatible' | 'unknown'>;
  // Equipment signal (WI-EQ-3): the recipe's rolled-up set with per-recipe essentiality, and
  // whether detection ran (false → the filter stays lenient).
  equipment: { equipment: Equipment; essentiality: Essentiality }[];
  equipmentComplete: boolean;
  popularity: number | null; // always null until the signal ships
};

export type RankedRecipe = { recipeId: string; score: number; breakdown: Record<string, number> };
