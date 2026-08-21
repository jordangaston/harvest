import { apiFetch } from "./client";

/** One taste-picker option: the `value` a pick stores + the `label` shown. For an
 * ingredient, `value` is a base_ingredient_id (uuid); for cuisine/dish_type it's the slug. */
export interface TasteOption {
  value: string;
  label: string;
}
export interface TasteIngredientOption extends TasteOption {
  section: string;
}

/** The full taste-picker catalog served by `GET /v1/taste-options` (three facets). */
export interface TasteOptions {
  cuisines: TasteOption[];
  dish_types: TasteOption[];
  ingredients: TasteIngredientOption[];
}

/** Fetches the taste-picker catalog. Served once and cached (TanStack + AsyncStorage). */
export async function getTasteOptions(): Promise<TasteOptions> {
  const { taste_options } = await apiFetch<{ taste_options: TasteOptions }>("/v1/taste-options");
  return taste_options;
}
