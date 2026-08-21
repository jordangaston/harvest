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
  system: boolean; // Liked/Saved system cookbook, not user-created
};

export type CookbookView = {
  cookbook: { id: string; name: string };
  recipes: { id: string; title: string; image_url?: string }[];
};

export type GroceryAisle =
  | "produce"
  | "meat_seafood"
  | "dairy_eggs_fridge"
  | "bakery"
  | "pantry"
  | "herbs_spices"
  | "frozen"
  | "beverages"
  | "household"
  | "other";

export type ApiGroceryItem = {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  quantity_text: string | null;
  aisle: GroceryAisle;
  icon: string;
  checked: boolean;
  source_recipe_id: string | null;
  source_recipe_title: string | null;
  position: number;
};

/** One item to add — the manual sheet sends one, a recipe sends many. */
export type NewGroceryItem = {
  name: string;
  amount?: number | null;
  unit?: string | null;
  quantity_text?: string | null;
  source_recipe_id?: string | null;
};

/** The common-ingredients contract from GET /v1/ingredients/common. */
export type ApiCommonIngredient = {
  canonicalName: string;
  aisle: GroceryAisle;
  defaultUnit: string;
  iconKey: string;
};

// The authenticated user, from GET /v1/users/me. `name` is owned by Phone Auth
// (added to the projection when it merges); read it null-tolerant until then.
export type ApiMe = {
  id: string;
  phone: string;
  name?: string | null;
  finished_onboarding: boolean;
};

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** A recipe card from `GET /v1/recipes`. `ingredient_names`/`cookbook_ids` present only when expanded. */
export type RecipeCard = {
  id: string;
  title: string;
  image_url?: string;
  total_minutes?: number;
  // Deck-card badge fields (present on GET /v1/recipes/deck; absent on the plain library list).
  difficulty_band?: "beginner" | "intermediate" | "advanced";
  cost_per_serving_cents?: number | null;
  nrf_score?: number;
  meal_prep_fit?: "unsuitable" | "suitable" | "designed";
  equipment?: { equipment: string; essentiality: string }[];
  allergens?: string[];
  diets?: string[];
  nutrition?: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }; // per serving
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
