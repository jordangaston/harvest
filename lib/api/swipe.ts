import { apiFetch } from "./client";
import type { RecipeCard } from "./types";

/** One ranked deck card: the recipe plus its 0–100 score and per-signal breakdown. */
export interface ApiDeckCard {
  recipe: RecipeCard;
  score: number;
  breakdown: Record<string, number>;
}

export type SwipeDirection = "like" | "dislike" | "save";
export interface SwipeBody {
  direction: SwipeDirection;
  reason?: string;
  reason_detail?: string;
}

/**
 * The top `limit` unswiped ranked cards (no paging — the deck advances by swiping).
 * `categories` absent → the server applies the user's planned meal types; present (even empty)
 * → an explicit filter (`[]` = show-all), sent as `&categories=` so the server can tell them apart.
 */
export async function getDeck(limit = 5, categories?: string[]): Promise<ApiDeckCard[]> {
  const filter = categories === undefined ? "" : `&categories=${encodeURIComponent(categories.join(","))}`;
  const { recipes } = await apiFetch<{ recipes: ApiDeckCard[] }>(`/v1/recipes/deck?limit=${limit}${filter}`);
  return recipes;
}

/** Records a swipe (like → Liked, save → Saved, reasoned dislike → tuning). */
export async function recordSwipe(recipeId: string, body: SwipeBody): Promise<{ direction: SwipeDirection; reason: string | null; score: number }> {
  const { swipe } = await apiFetch<{ swipe: { direction: SwipeDirection; reason: string | null; score: number } }>(
    `/v1/recipes/${recipeId}/swipe`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return swipe;
}

/** Durable un-swipe: removes the swipe and reverses its cookbook filing (204). */
export async function unswipe(recipeId: string): Promise<void> {
  await apiFetch<void>(`/v1/recipes/${recipeId}/swipe`, { method: "DELETE" });
}
