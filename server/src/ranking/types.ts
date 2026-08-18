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
  popularity: number | null; // always null until the signal ships
};

export type RankedRecipe = { recipeId: string; score: number; breakdown: Record<string, number> };
