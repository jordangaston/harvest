import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys";
import { listCookbooks, createCookbook } from "./cookbooks";
import { getRecipe } from "./recipes";
import {
  listGroceries,
  addGroceryItems,
  patchGroceryItem,
  deleteGroceryItem,
  listCommonIngredients,
} from "./groceries";
import type { NewGroceryItem } from "./types";

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

export function useCommonIngredients() {
  return useQuery({ queryKey: queryKeys.commonIngredients, queryFn: listCommonIngredients });
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
