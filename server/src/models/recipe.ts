import { z } from 'zod';
import { LABEL_CORE_KEYS } from './label-core.js';
import type { DifficultyBand } from '../schema.js';

export type { DifficultyBand };

/** The recipe difficulty signal (WI-DIFF-2): the continuous 0–100 `score`, its derived
 * `band`, and the per-step technique weights (1–5, index-aligned to the recipe's steps).
 * `stepTechniques` (WI-DIFF-5) carries the detected canonical technique names per step
 * (`[]` where none / keyword fallback ran) — the atom persisted so re-weighting the table
 * never re-calls the LLM; `stepDifficulties` stays the authority for weight. */
export interface RecipeDifficulty {
  score: number;
  band: DifficultyBand;
  stepDifficulties: number[];
  stepTechniques: string[][];
}

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
  nrfScore: z.string().nullable(),
  difficultyScore: z.string().nullable(),
  difficultyBand: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
  allergens: z.object({ contains: z.array(z.string()), mayContain: z.array(z.string()) }).nullable(),
  allergensComplete: z.boolean(),
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

/** A recipe's taste facets (WI-TS-1), each a list of controlled-vocabulary values.
 * The attach/persist shape the categorizer produces; empty arrays mean "none". */
export interface RecipeCategories {
  cuisine: string[];
  mealType: string[];
  dishType: string[];
  primaryIngredient: string[];
}

/** An empty facet set — the default when a recipe has no categories. */
export function emptyCategories(): RecipeCategories {
  return { cuisine: [], mealType: [], dishType: [], primaryIngredient: [] };
}

/** One diet's stored compatibility verdict + optional blocker (WI-DS-1). */
export interface RecipeDietVerdict {
  dietId: string;
  verdict: 'compatible' | 'incompatible' | 'unknown';
  blocker?: { kind: 'ingredient' | 'macro'; value: string; class?: string };
}

/** A recipe plus its ordered children — the aggregate a repository read returns.
 * `difficulty` is the reconstructed value object (null for a pre-feature recipe);
 * `stepDifficulties` is the per-step weight aligned to `steps` (null where unscored). */
export interface RecipeDetail {
  recipe: Recipe;
  ingredients: IngredientDetail[];
  steps: string[];
  categories: RecipeCategories;
  diets: RecipeDietVerdict[];
  difficulty: RecipeDifficulty | null;
  stepDifficulties: (number | null)[];
  /** The detected canonical technique names per step (WI-DIFF-5), aligned to `steps`;
   * null where a step stored no techniques. */
  stepTechniques: (string[] | null)[];
}

/** Nutrition-Facts label core on the public recipe (snake_case strings). `estimated`
 * is true when computed from ingredients, false when parsed from the source. */
export type PublicNutrition = {
  estimated: boolean;
  calories?: string;
  grams_of_fat?: string;
  grams_of_saturated_fat?: string;
  grams_of_carbohydrate?: string;
  grams_of_fiber?: string;
  grams_of_sugar?: string;
  grams_of_protein?: string;
  milligrams_of_sodium?: string;
};

/** The allergen profile on the public recipe (snake_case). Omitted entirely when the
 * stored profile is null; `complete: false` ⇒ non-listed allergens are undetermined. */
export type PublicAllergens = {
  contains: string[];
  may_contain: string[];
  complete: boolean;
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
  nrf_score?: number;
  difficulty?: { score: number; band: DifficultyBand };
  allergens?: PublicAllergens;
  categories: PublicCategories;
  /** Per-diet compatibility (WI-DS-1); empty when the signal was withheld. */
  diets: PublicDietVerdict[];
}

/** One diet verdict in the public shape (snake_case). Blocker present for `incompatible`. */
export interface PublicDietVerdict {
  diet_id: string;
  verdict: 'compatible' | 'incompatible' | 'unknown';
  blocker?: { kind: 'ingredient' | 'macro'; value: string; class?: string };
}

/** The public taste facets: snake_case facet keys, always present, arrays possibly
 * empty. The client (and later the ranking engine) reads recipe preference from here. */
export interface PublicCategories {
  cuisine: string[];
  meal_type: string[];
  dish_type: string[];
  primary_ingredient: string[];
}

/** A recipe as read for a list view (camelCase). `ingredientNames`/`cookbookIds`
 * are populated only when the caller expands them. */
export interface RecipeCard {
  id: string;
  title: string;
  imageUrl: string | null;
  totalMinutes: number | null;
  difficultyBand: DifficultyBand | null;
  ingredientNames?: string[];
  cookbookIds?: string[];
}

/** One page of recipe cards plus the cursor for the next page (null at the end). */
export interface RecipeCardPage {
  cards: RecipeCard[];
  pageToken: string | null;
}

/** The public recipe-card shape: snake_case, null/absent fields omitted. */
export interface PublicRecipeCard {
  id: string;
  title: string;
  image_url?: string;
  total_minutes?: number;
  difficulty_band?: DifficultyBand;
  ingredient_names?: string[];
  cookbook_ids?: string[];
}

/** Maps a recipe card to its public shape, omitting null/absent optionals. The card
 * carries the difficulty BAND only (a badge), never the raw score. */
export function toPublicRecipeCard(card: RecipeCard): PublicRecipeCard {
  const out: PublicRecipeCard = { id: card.id, title: card.title };
  if (card.imageUrl) out.image_url = card.imageUrl;
  if (card.totalMinutes != null) out.total_minutes = card.totalMinutes;
  if (card.difficultyBand) out.difficulty_band = card.difficultyBand;
  if (card.ingredientNames) out.ingredient_names = card.ingredientNames;
  if (card.cookbookIds) out.cookbook_ids = card.cookbookIds;
  return out;
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
    categories: {
      cuisine: detail.categories.cuisine,
      meal_type: detail.categories.mealType,
      dish_type: detail.categories.dishType,
      primary_ingredient: detail.categories.primaryIngredient,
    },
    diets: detail.diets.map((d) => (d.blocker ? { diet_id: d.dietId, verdict: d.verdict, blocker: d.blocker } : { diet_id: d.dietId, verdict: d.verdict })),
  };
  if (recipe.sourceUrl) publicRecipe.source_url = recipe.sourceUrl;
  if (recipe.servings != null) publicRecipe.servings = recipe.servings;
  if (recipe.totalMinutes != null) publicRecipe.total_minutes = recipe.totalMinutes;
  if (recipe.imageUrl) publicRecipe.image_url = recipe.imageUrl;
  const nutrition = toPublicNutrition(recipe);
  if (nutrition) publicRecipe.nutrition = nutrition;
  if (recipe.nrfScore != null) publicRecipe.nrf_score = Number(recipe.nrfScore);
  if (detail.difficulty) publicRecipe.difficulty = { score: detail.difficulty.score, band: detail.difficulty.band };
  if (recipe.allergens) {
    publicRecipe.allergens = {
      contains: recipe.allergens.contains,
      may_contain: recipe.allergens.mayContain,
      complete: recipe.allergensComplete,
    };
  }
  return publicRecipe;
}

/** Projects the nutrition columns to the public shape, or undefined when unknown.
 * `estimated` derives from `nutrition_source` (`'computed'` ⇒ true). Confidence is
 * never serialized. */
function toPublicNutrition(recipe: Recipe): PublicNutrition | undefined {
  if (!recipe.nutritionSource) return undefined;
  const nutrition: PublicNutrition = { estimated: recipe.nutritionSource === 'computed' };
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
