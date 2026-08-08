import { apiFetch } from "./client";
import type { ApiRecipe, RecipeCard } from "./types";

export async function getRecipe(id: string): Promise<ApiRecipe> {
  const { recipe } = await apiFetch<{ recipe: ApiRecipe }>(`/v1/recipes/${id}`);
  return recipe;
}

/**
 * The caller's whole library as cards (owned ∪ cookbook recipes), following the
 * `page_token` cursor to the end. `expand` adds ingredient names + cookbook ids so
 * the add-recipe sheet can filter client-side.
 */
export async function listRecipes(
  expand: string[] = ["ingredient_names", "cookbook_ids"],
): Promise<RecipeCard[]> {
  const all: RecipeCard[] = [];
  let token: string | null = null;
  do {
    const qs = new URLSearchParams({ page_size: "200" });
    if (expand.length) qs.set("expand", expand.join(","));
    if (token) qs.set("page_token", token);
    const page = await apiFetch<{ recipes: RecipeCard[]; page_token: string | null }>(`/v1/recipes?${qs}`);
    all.push(...page.recipes);
    token = page.page_token;
  } while (token);
  return all;
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
