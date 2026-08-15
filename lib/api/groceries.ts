import { apiFetch } from "./client";
import type { ApiGroceryItem, ApiCommonIngredient, NewGroceryItem } from "./types";

export async function listGroceries(): Promise<ApiGroceryItem[]> {
  const { items } = await apiFetch<{ items: ApiGroceryItem[] }>("/v1/grocery_items");
  return items;
}

/** Adds one or many items; the server resolves aisle/icon + default unit and merges. */
export async function addGroceryItems(items: NewGroceryItem[]): Promise<ApiGroceryItem[]> {
  const res = await apiFetch<{ items: ApiGroceryItem[] }>("/v1/grocery_items", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  return res.items;
}

export async function patchGroceryItem(
  id: string,
  patch: { checked?: boolean; amount?: number | null; unit?: string | null },
): Promise<ApiGroceryItem> {
  const { item } = await apiFetch<{ item: ApiGroceryItem }>(`/v1/grocery_items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return item;
}

export async function deleteGroceryItem(id: string): Promise<void> {
  await apiFetch<void>(`/v1/grocery_items/${id}`, { method: "DELETE" });
}

/** The common-ingredients catalog for the add picker (static; cached long). */
export async function listCommonIngredients(): Promise<ApiCommonIngredient[]> {
  const { ingredients } = await apiFetch<{ ingredients: ApiCommonIngredient[] }>("/v1/ingredients/common");
  return ingredients;
}
