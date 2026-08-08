import { apiFetch } from "./client";
import type { CommonIngredient } from "./types";

// Grocery owns `GET /v1/ingredients/common`. Until it ships, this hard-coded list
// backs the "Popular" grid. `apiFetch` throws on any non-2xx (incl. the 404 while
// the endpoint is absent), so we CATCH and fall back — a missing endpoint must never
// blank the Ingredients filter. iconKeys match `components/recime/recipes.ts`.
const FALLBACK: CommonIngredient[] = [
  { canonicalName: "Chicken", iconKey: "chicken" },
  { canonicalName: "Beef", iconKey: "beef" },
  { canonicalName: "Pork", iconKey: "pork" },
  { canonicalName: "Fish", iconKey: "fish" },
  { canonicalName: "Egg", iconKey: "egg" },
  { canonicalName: "Rice", iconKey: "rice" },
  { canonicalName: "Pasta", iconKey: "pasta" },
  { canonicalName: "Potato", iconKey: "potato" },
  { canonicalName: "Tomato", iconKey: "tomato" },
  { canonicalName: "Onion", iconKey: "onion" },
  { canonicalName: "Garlic", iconKey: "garlic" },
  { canonicalName: "Cheese", iconKey: "cheese" },
  { canonicalName: "Mushroom", iconKey: "mushroom" },
  { canonicalName: "Broccoli", iconKey: "broccoli" },
  { canonicalName: "Spinach", iconKey: "spinach" },
  { canonicalName: "Milk", iconKey: "milk" },
];

/** The common-ingredient list for the Popular grid; the hard-coded fallback on any error. */
export async function listCommonIngredients(): Promise<CommonIngredient[]> {
  try {
    const { ingredients } = await apiFetch<{ ingredients: CommonIngredient[] }>("/v1/ingredients/common");
    return ingredients?.length ? ingredients : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
