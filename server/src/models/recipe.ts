import { z } from 'zod';

// Domain model for a recipe row. Repositories parse rows into this at the
// boundary. `confidence` is stored as numeric → text by pg, so it's a nullable
// string here; toPublicRecipe coerces it to a number for the API.
export const RecipeSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sourceType: z.enum(['instagram', 'tiktok', 'facebook', 'pinterest', 'website', 'photo']),
  sourceUrl: z.string().nullable(),
  servings: z.number().int().nullable(),
  totalMinutes: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  confidence: z.string().nullable(),
  createdAt: z.date(),
});

export type Recipe = z.infer<typeof RecipeSchema>;

export interface PublicRecipe {
  id: string;
  title: string;
  source_type: Recipe['sourceType'];
  source_url?: string;
  servings?: number;
  total_minutes?: number;
  image_url?: string;
  confidence?: number;
}

/** Maps a recipe row to its public shape, dropping every null field. */
export function toPublicRecipe(recipe: Recipe): PublicRecipe {
  const publicRecipe: PublicRecipe = {
    id: recipe.id,
    title: recipe.title,
    source_type: recipe.sourceType,
  };
  if (recipe.sourceUrl) publicRecipe.source_url = recipe.sourceUrl;
  if (recipe.servings != null) publicRecipe.servings = recipe.servings;
  if (recipe.totalMinutes != null) publicRecipe.total_minutes = recipe.totalMinutes;
  if (recipe.imageUrl) publicRecipe.image_url = recipe.imageUrl;
  if (recipe.confidence != null) publicRecipe.confidence = Number(recipe.confidence);
  return publicRecipe;
}
