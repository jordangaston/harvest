import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys";
import { listCookbooks, createCookbook } from "./cookbooks";
import { getRecipe, listRecipes } from "./recipes";
import { getMe, deleteAccount } from "./me";
import { listMealPlan, addMealPlanEntry, removeMealPlanEntry } from "./meal-plan";
import {
  listGroceries,
  addGroceryItems,
  patchGroceryItem,
  deleteGroceryItem,
  listCommonIngredients,
} from "./groceries";
import { getDeck, recordSwipe, unswipe, type SwipeBody } from "./swipe";
import { getPreferences, updatePreferences, type ApiPreferences } from "./preferences";
import type { ApiMealPlanEntry, MealSlot, NewGroceryItem } from "./types";

/**
 * Read hooks — the reference pattern for Wave 2. A `useQuery` wraps an existing
 * `lib/api` read under its `queryKeys` entry; the long `staleTime` in
 * `queryClient` serves cache on revisit. See `docs/client-caching.md`.
 */
export function useCookbooks() {
  return useQuery({ queryKey: queryKeys.cookbooks, queryFn: listCookbooks });
}

export function useRecipe(id: string) {
  return useQuery({ queryKey: queryKeys.recipe(id), queryFn: () => getRecipe(id), enabled: !!id });
}

/** The authenticated user (id, phone, and — once Phone Auth merges — name). */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe });
}

/**
 * Deletes the account. The caller owns teardown ordering (clear cache → clear
 * session → navigate) because a stray protected refetch after the user is gone
 * would re-provision a new user via `apiFetch`; the hook only runs the request.
 */
export function useDeleteAccount() {
  return useMutation({ mutationFn: deleteAccount });
}

/**
 * Mutation hook — the reference pattern for writes. On success it invalidates
 * the key its write changed, so every mounted `useCookbooks()` refetches.
 */
export function useCreateCookbook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCookbook,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cookbooks }),
  });
}

/** The grocery list. The common-ingredients catalog is static, so it caches long. */
export function useGroceries() {
  return useQuery({ queryKey: queryKeys.groceries, queryFn: listGroceries });
}

/* ---------- Meal plan ---------- */

/** The caller's entries for the Mon–Sun week starting at `weekStart` (YYYY-MM-DD). */
export function useMealPlanWeek(weekStart: string, endDate: string) {
  return useQuery({
    queryKey: queryKeys.mealPlan(weekStart),
    queryFn: () => listMealPlan(weekStart, endDate),
    enabled: !!weekStart,
  });
}

/** The whole library as cards (expanded), for the add-recipe sheet. */
export function useLibraryCards() {
  return useQuery({ queryKey: queryKeys.recipes, queryFn: () => listRecipes() });
}

/** The Popular common-ingredient list (endpoint + hard-coded fallback). */
export function useCommonIngredients() {
  return useQuery({ queryKey: queryKeys.commonIngredients, queryFn: listCommonIngredients });
}

/* ---------- Swipe deck & preferences ---------- */

/** The caller's ranked swipe deck (top `limit`). Re-fetches after a preferences save invalidates it. */
export function useDeck(limit = 5) {
  return useQuery({ queryKey: queryKeys.deck, queryFn: () => getDeck(limit) });
}

/**
 * Records a swipe. Success doesn't invalidate the deck — the in-hand batch is never reshuffled
 * (design O-02); the swiped recipe is excluded at the next fetch. The screen drives optimistic UI.
 */
export function useSwipe() {
  return useMutation({
    mutationFn: ({ recipeId, ...body }: { recipeId: string } & SwipeBody) => recordSwipe(recipeId, body),
  });
}

/** Durable un-swipe (backtrack). */
export function useUnswipe() {
  return useMutation({ mutationFn: (recipeId: string) => unswipe(recipeId) });
}

/** The caller's full preference model (cold-start defaults if never saved). */
export function usePreferences() {
  return useQuery({ queryKey: queryKeys.preferences, queryFn: getPreferences });
}

/** Persists preferences; invalidates `preferences` (reseed) and `deck` (next fetch re-ranks). */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiPreferences) => updatePreferences(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.preferences });
      qc.invalidateQueries({ queryKey: queryKeys.deck });
    },
  });
}

/** Every grocery write invalidates the one list key, so mounted lists refetch. */
export function useAddGroceryItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: NewGroceryItem[]) => addGroceryItems(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.groceries }),
  });
}

export function usePatchGroceryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; checked?: boolean; amount?: number | null; unit?: string | null }) =>
      patchGroceryItem(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.groceries }),
  });
}

export function useDeleteGroceryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGroceryItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.groceries }),
  });
}

/* ---------- Meal plan writes ---------- */

/**
 * Adds a meal-plan entry. Invalidates the whole `mealPlan` key space so any cached
 * week refetches — the entry's week may not be the one currently shown (add-from-recipe).
 */
export function useAddMealPlanEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, meal, recipeId }: { date: string; meal: MealSlot; recipeId: string }) =>
      addMealPlanEntry(date, meal, recipeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mealPlan"] }),
  });
}

/**
 * Removes an entry from the shown week, optimistically. Snapshots the week's cache,
 * drops the row immediately, restores it on error, and reconciles on settle.
 */
export function useRemoveMealPlanEntry(weekStart: string) {
  const qc = useQueryClient();
  const key = queryKeys.mealPlan(weekStart);
  return useMutation({
    mutationFn: (entryId: string) => removeMealPlanEntry(entryId),
    onMutate: async (entryId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ApiMealPlanEntry[]>(key);
      qc.setQueryData<ApiMealPlanEntry[]>(key, (old) => (old ?? []).filter((e) => e.id !== entryId));
      return { previous };
    },
    onError: (_err, _entryId, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["mealPlan"] }),
  });
}
