import { apiFetch } from "./client";
import type { ApiRecipe } from "./types";

export async function getRecipe(id: string): Promise<ApiRecipe> {
  const { recipe } = await apiFetch<{ recipe: ApiRecipe }>(`/v1/recipes/${id}`);
  return recipe;
}

/** Edits the recipe in place and returns the updated recipe. */
export async function updateRecipe(id: string, edit: { ingredients?: string[]; steps?: string[] }): Promise<ApiRecipe> {
  const { recipe } = await apiFetch<{ recipe: ApiRecipe }>(`/v1/recipes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(edit),
  });
  return recipe;
}

export async function deleteRecipe(id: string): Promise<void> {
  await apiFetch<void>(`/v1/recipes/${id}`, { method: "DELETE" });
}

/** Sets which of the caller's cookbooks hold this recipe (also saves it to the library). */
export async function setRecipeCookbooks(recipeId: string, cookbookIds: string[]): Promise<string[]> {
  const { cookbook_ids } = await apiFetch<{ cookbook_ids: string[] }>(`/v1/recipes/${recipeId}/cookbooks`, {
    method: "PUT",
    body: JSON.stringify({ cookbook_ids: cookbookIds }),
  });
  return cookbook_ids;
}
