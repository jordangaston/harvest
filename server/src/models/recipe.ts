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

/** An ingredient row as read from the DB (pg `numeric` amount comes back as a string). */
export interface IngredientDetail {
  name: string;
  icon: string | null;
  quantityText: string | null;
  amount: string | null;
  unit: string | null;
}

/** A recipe plus its ordered children — the aggregate a repository read returns. */
export interface RecipeDetail {
  recipe: Recipe;
  ingredients: IngredientDetail[];
  steps: string[];
}

/** The public recipe shape returned to clients: snake_case, null fields omitted,
 * internal columns (confidence) dropped. Ingredients and steps come pre-ordered.
 * `amount` is a string (pg numeric), so the tap-in-step popover can show the exact amount. */
export interface PublicRecipe {
  id: string;
  title: string;
  source_type: Recipe['sourceType'];
  source_url?: string;
  servings?: number;
  total_minutes?: number;
  image_url?: string;
  ingredients: { name: string; icon?: string; quantity_text?: string; amount?: string; unit?: string }[];
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
    ingredients: detail.ingredients.map(toPublicIngredient),
    steps: detail.steps,
  };
  if (recipe.sourceUrl) publicRecipe.source_url = recipe.sourceUrl;
  if (recipe.servings != null) publicRecipe.servings = recipe.servings;
  if (recipe.totalMinutes != null) publicRecipe.total_minutes = recipe.totalMinutes;
  if (recipe.imageUrl) publicRecipe.image_url = recipe.imageUrl;
  return publicRecipe;
}

/** Projects one ingredient to its public shape, omitting null optionals. */
function toPublicIngredient(ing: IngredientDetail): PublicRecipe['ingredients'][number] {
  const out: PublicRecipe['ingredients'][number] = { name: ing.name };
  if (ing.icon) out.icon = ing.icon;
  if (ing.quantityText) out.quantity_text = ing.quantityText;
  if (ing.amount) out.amount = ing.amount;
  if (ing.unit) out.unit = ing.unit;
  return out;
}
