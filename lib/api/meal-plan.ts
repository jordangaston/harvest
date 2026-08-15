import { apiFetch } from "./client";
import type { ApiMealPlanEntry, MealSlot } from "./types";

/** The caller's entries for an inclusive date range (both YYYY-MM-DD). */
export async function listMealPlan(start: string, end: string): Promise<ApiMealPlanEntry[]> {
  const { entries } = await apiFetch<{ entries: ApiMealPlanEntry[] }>(
    `/v1/meal-plan?start=${start}&end=${end}`,
  );
  return entries;
}

/** Assigns a recipe to a (date, meal) slot; returns the created entry. */
export async function addMealPlanEntry(date: string, meal: MealSlot, recipeId: string): Promise<ApiMealPlanEntry> {
  const { entry } = await apiFetch<{ entry: ApiMealPlanEntry }>("/v1/meal-plan", {
    method: "POST",
    body: JSON.stringify({ entry: { date, meal, recipe_id: recipeId } }),
  });
  return entry;
}

/** Removes one of the caller's entries. */
export async function removeMealPlanEntry(id: string): Promise<void> {
  await apiFetch<void>(`/v1/meal-plan/${id}`, { method: "DELETE" });
}
