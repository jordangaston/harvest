import { z } from 'zod';
import { LABEL_CORE_KEYS } from './label-core.js';

// Domain model for a recipe row. Repositories parse rows into this at the
// boundary. `confidence` and the nutrition macros are stored as numeric → text,
// hence nullable strings here. Timestamps come back as Dates via drizzle
// `mode: 'timestamp'`, so the `.date()` still holds.
export const RecipeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  sourceType: z.enum(['instagram', 'tiktok', 'facebook', 'pinterest', 'youtube', 'website', 'photo']),
  sourceUrl: z.string().nullable(),
  servings: z.number().int().nullable(),
  servingsEstimated: z.boolean(),
  totalMinutes: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  confidence: z.string().nullable(),
  calories: z.string().nullable(),
  gramsOfFat: z.string().nullable(),
  gramsOfSaturatedFat: z.string().nullable(),
  gramsOfCarbohydrate: z.string().nullable(),
  gramsOfFiber: z.string().nullable(),
  gramsOfSugar: z.string().nullable(),
  gramsOfProtein: z.string().nullable(),
  milligramsOfSodium: z.string().nullable(),
  nutritionSource: z.enum(['parsed', 'computed']).nullable(),
  createdAt: z.date(),
});

export type Recipe = z.infer<typeof RecipeSchema>;

/** An ingredient row as read from the DB (numeric amount comes back as a string). */
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

/** Nutrition-Facts label core on the public recipe (snake_case strings). */
export type PublicNutrition = {
  source: 'parsed' | 'computed';
  calories?: string;
  grams_of_fat?: string;
  grams_of_saturated_fat?: string;
  grams_of_carbohydrate?: string;
  grams_of_fiber?: string;
  grams_of_sugar?: string;
  grams_of_protein?: string;
  milligrams_of_sodium?: string;
};

/** The public recipe shape returned to clients: snake_case, null fields omitted,
 * internal columns (confidence) dropped. `nutrition` is present only when known. */
export interface PublicRecipe {
  id: string;
  title: string;
  source_type: Recipe['sourceType'];
  source_url?: string;
  servings?: number;
  servings_estimated: boolean;
  total_minutes?: number;
  image_url?: string;
  ingredients: { name: string; icon?: string; quantity_text?: string; amount?: string; unit?: string }[];
  steps: string[];
  nutrition?: PublicNutrition;
}

/** Maps the numeric recipe columns onto the snake_case label-core keys. */
const NUTRITION_COLUMN: Record<(typeof LABEL_CORE_KEYS)[number], keyof Recipe> = {
  calories: 'calories',
  grams_of_fat: 'gramsOfFat',
  grams_of_saturated_fat: 'gramsOfSaturatedFat',
  grams_of_carbohydrate: 'gramsOfCarbohydrate',
  grams_of_fiber: 'gramsOfFiber',
  grams_of_sugar: 'gramsOfSugar',
  grams_of_protein: 'gramsOfProtein',
  milligrams_of_sodium: 'milligramsOfSodium',
};

/**
 * Maps a recipe aggregate to its public shape, dropping internal columns and
 * omitting null optionals.
 * @param detail - The recipe plus its ordered ingredients and steps.
 * @returns The client-safe projection.
 */
export function toPublicRecipe(detail: RecipeDetail): PublicRecipe {
  const { recipe } = detail;
  const publicRecipe: PublicRecipe = {
    id: recipe.id,
    title: recipe.title,
    source_type: recipe.sourceType,
    servings_estimated: recipe.servingsEstimated,
    ingredients: detail.ingredients.map(toPublicIngredient),
    steps: detail.steps,
  };
  if (recipe.sourceUrl) publicRecipe.source_url = recipe.sourceUrl;
  if (recipe.servings != null) publicRecipe.servings = recipe.servings;
  if (recipe.totalMinutes != null) publicRecipe.total_minutes = recipe.totalMinutes;
  if (recipe.imageUrl) publicRecipe.image_url = recipe.imageUrl;
  const nutrition = toPublicNutrition(recipe);
  if (nutrition) publicRecipe.nutrition = nutrition;
  return publicRecipe;
}

/** Projects the nutrition columns to the public shape, or undefined when unknown. */
function toPublicNutrition(recipe: Recipe): PublicNutrition | undefined {
  if (!recipe.nutritionSource) return undefined;
  const nutrition: PublicNutrition = { source: recipe.nutritionSource };
  for (const key of LABEL_CORE_KEYS) {
    const value = recipe[NUTRITION_COLUMN[key]] as string | null;
    if (value != null) nutrition[key] = value;
  }
  return nutrition;
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
