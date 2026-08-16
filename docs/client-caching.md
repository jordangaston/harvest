# Client caching pattern

The app caches server data with [TanStack Query](https://tanstack.com/query/latest),
persisted to `AsyncStorage`. Read once, serve from cache, and refetch only when a
mutation says the data changed. Every Wave-2 screen follows this pattern.

## The model

- **Long `staleTime`.** A read stays "fresh" for 5 minutes (`lib/queryClient.ts`).
  Revisiting a screen inside that window renders from cache with no network call.
- **Invalidate on change.** A mutation that changes a resource calls
  `invalidateQueries` on that resource's key. Every mounted query for it refetches;
  the next visit to any other screen refetches on mount.
- **Persisted.** The cache is written to `AsyncStorage`, so a cold launch shows the
  last-known data immediately, then refetches if stale.

This means: no manual `useEffect(fetch)`, no focus-refetch, no hand-rolled loading
state. The hook owns it.

## Keys

`lib/queryKeys.ts` holds every cache key. List keys are a bare tuple; item keys
append the id.

```ts
queryKeys.cookbooks        // ["cookbooks"]
queryKeys.cookbook(id)     // ["cookbook", id]
queryKeys.recipe(id)       // ["recipe", id]
```

Never write a key inline. Add the resource to `queryKeys` and reference it, so a
mutation and its query always agree on the key.

## Adding a read

Wrap the existing `lib/api` function in a `useQuery` under its key. Put the hook in
`lib/api/hooks.ts`.

```ts
export function useCookbooks() {
  return useQuery({ queryKey: queryKeys.cookbooks, queryFn: listCookbooks });
}

// For an item read, pass the id and gate on it:
export function useRecipe(id: string) {
  return useQuery({ queryKey: queryKeys.recipe(id), queryFn: () => getRecipe(id), enabled: !!id });
}
```

In the screen, read `data` (it is `undefined` until the first load resolves):

```ts
const { data: cookbooks } = useCookbooks();
```

## Adding a write

Wrap the mutating `lib/api` call in a `useMutation` and invalidate the key it
changed. This is the whole freshness mechanism — get the key right.

```ts
export function useCreateCookbook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCookbook,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cookbooks }),
  });
}
```

Invalidate every key the write touches. Saving a recipe into a cookbook changes each
cookbook's `recipe_count`, so it invalidates `queryKeys.cookbooks`
(`CookbookPickerSheet`). Deleting a recipe invalidates `queryKeys.cookbooks` and
removes `queryKeys.recipe(id)` (`app/recipe/[id].tsx`).

When you already hold the fresh object (e.g. an edit endpoint returns it), write it
straight into the cache instead of refetching:

```ts
qc.setQueryData(queryKeys.recipe(id), updated);
```

## Reference implementations

- Read list — `useCookbooks()` in `app/(app)/recipes.tsx`
- Read item — `useRecipe(id)` in `app/recipe/[id].tsx`
- Mutation + invalidate — `useCreateCookbook()` in `components/recime/NewCookbookSheet.tsx`
- Imperative invalidate / write-through — `app/recipe/[id].tsx`, `CookbookPickerSheet`

## Setup

- Deps: `@tanstack/react-query`, `@tanstack/react-query-persist-client`,
  `@tanstack/query-async-storage-persister`, `@react-native-async-storage/async-storage`.
- Provider: `PersistQueryClientProvider` wraps the app root in `app/_layout.tsx`.
- Config: `lib/queryClient.ts` (client, persister, `staleTime`/`gcTime`).
