import { z } from 'zod';

// Domain model for a recipe row. Repositories parse rows into this at the
// boundary. `confidence` is stored as numeric → text by pg, hence a nullable
// string here.
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
