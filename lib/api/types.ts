// Wire shapes from the Harvest API — snake_case, matching the server projections.

export type SourceType = "instagram" | "tiktok" | "facebook" | "pinterest" | "youtube" | "website" | "photo";
export type JobStatus = "queued" | "running" | "ready" | "failed";

export type ImportJob = {
  id: string;
  status: JobStatus;
  progress: number;
  source_type: SourceType;
  error_code?: string;
  recipe_id?: string;
  /** All recipes an import produced, in order (a slideshow yields several). */
  recipe_ids?: string[];
};

export type ApiIngredient = {
  name: string;
  icon?: string;
  quantity_text?: string;
  amount?: string;
  unit?: string;
};

export type ApiRecipe = {
  id: string;
  title: string;
  source_type: SourceType;
  source_url?: string;
  servings?: number;
  total_minutes?: number;
  image_url?: string;
  ingredients: ApiIngredient[];
  steps: string[];
};

export type ApiCookbook = {
  id: string;
  name: string;
  recipe_count: number;
  cover_image_url?: string;
};

export type CookbookView = {
  cookbook: { id: string; name: string };
  recipes: { id: string; title: string; image_url?: string }[];
};

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** A recipe card from `GET /v1/recipes`. `ingredient_names`/`cookbook_ids` present only when expanded. */
export type RecipeCard = {
  id: string;
  title: string;
  image_url?: string;
  total_minutes?: number;
  ingredient_names?: string[];
  cookbook_ids?: string[];
};

/** A meal-plan entry from `GET /v1/meal-plan`. */
export type ApiMealPlanEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  meal: MealSlot;
  position: number;
  recipe: { id: string; title: string; image_url?: string };
};

/** A common ingredient for the "Popular" filter grid (Grocery owns the endpoint). */
export type CommonIngredient = {
  canonicalName: string;
  iconKey?: string;
};
