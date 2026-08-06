import { z } from 'zod';

// Domain model for a recipe row. Repositories parse rows into this at the
// boundary. `confidence` is stored as numeric → text by pg, hence a nullable
// string here.
export const RecipeSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sourceType: z.enum(['instagram', 'tiktok', 'facebook', 'pinterest', 'youtube', 'website', 'photo']),
  sourceUrl: z.string().nullable(),
  servings: z.number().int().nullable(),
  totalMinutes: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  confidence: z.string().nullable(),
  createdAt: z.date(),
});

export type Recipe = z.infer<typeof RecipeSchema>;

/** A recipe plus its ordered children — the aggregate a repository read returns. */
export interface RecipeDetail {
  recipe: Recipe;
  ingredients: { name: string; icon: string | null }[];
  steps: string[];
}

/** The public recipe shape returned to clients: snake_case, null fields omitted,
 * internal columns (confidence) dropped. Ingredients and steps come pre-ordered. */
export interface PublicRecipe {
  id: string;
  title: string;
  source_type: Recipe['sourceType'];
  source_url?: string;
  servings?: number;
  total_minutes?: number;
  image_url?: string;
  ingredients: { name: string; icon?: string }[];
  steps: string[];
}

/**
 * Maps a recipe aggregate to its public shape, dropping internal columns and
 * omitting null optionals (matching {@link toPublicJob}).
 * @param detail - The recipe plus its ordered ingredients and steps.
 * @returns The client-safe projection.
 */
export function toPublicRecipe(detail: RecipeDetail): PublicRecipe {
  const { recipe } = detail;
  const publicRecipe: PublicRecipe = {
    id: recipe.id,
    title: recipe.title,
    source_type: recipe.sourceType,
    ingredients: detail.ingredients.map((i) => (i.icon ? { name: i.name, icon: i.icon } : { name: i.name })),
    steps: detail.steps,
  };
  if (recipe.sourceUrl) publicRecipe.source_url = recipe.sourceUrl;
  if (recipe.servings != null) publicRecipe.servings = recipe.servings;
  if (recipe.totalMinutes != null) publicRecipe.total_minutes = recipe.totalMinutes;
  if (recipe.imageUrl) publicRecipe.image_url = recipe.imageUrl;
  return publicRecipe;
}
