import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys";
import { listCookbooks, createCookbook } from "./cookbooks";
import { getRecipe } from "./recipes";

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
