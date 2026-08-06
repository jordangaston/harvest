import { z } from 'zod';

// Domain model for a cookbook row. Repositories parse rows into this at the
// boundary (matching UserSchema/RecipeSchema).
export const CookbookSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  createdAt: z.date(),
});

export type Cookbook = z.infer<typeof CookbookSchema>;

/** A cookbook plus its derived counts — what a list read returns. */
export interface CookbookSummary {
  cookbook: Cookbook;
  recipeCount: number;
  coverImageUrl: string | null;
}

/** The public cookbook shape: snake_case, null fields omitted. */
export interface PublicCookbook {
  id: string;
  name: string;
  recipe_count: number;
  cover_image_url?: string;
}

/**
 * Maps a cookbook summary to its public shape, omitting a null cover.
 * @param summary - The cookbook plus its recipe count and cover image.
 */
export function toPublicCookbook(summary: CookbookSummary): PublicCookbook {
  const pub: PublicCookbook = {
    id: summary.cookbook.id,
    name: summary.cookbook.name,
    recipe_count: summary.recipeCount,
  };
  if (summary.coverImageUrl) pub.cover_image_url = summary.coverImageUrl;
  return pub;
}
