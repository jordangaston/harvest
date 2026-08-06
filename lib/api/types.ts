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
