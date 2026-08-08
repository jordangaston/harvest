# Sprint report — Client caching infra

**Goal.** Ship shared client-side caching so the app serves data from cache and refetches only when it
changes — the prerequisite the six Wave-2 tasks build on. Small, low-risk, merge fast.

## What shipped

TanStack Query v5, persisted to AsyncStorage.

- **Deps** — `@tanstack/react-query`, `@tanstack/react-query-persist-client`,
  `@tanstack/query-async-storage-persister` (all `5.101.4`), and
  `@react-native-async-storage/async-storage` `2.2.0` (the Expo SDK-54 pin).
- **Provider** — `PersistQueryClientProvider` wraps the app root in `app/_layout.tsx`.
- **Config** — `lib/queryClient.ts`: `staleTime` 5 min, `gcTime` 24 h, `retry` 1, AsyncStorage persister
  (`maxAge` 24 h).
- **Keys** — `lib/queryKeys.ts`: a factory for every Wave-2 resource (`cookbooks`, `cookbook(id)`,
  `recipes`, `recipe(id)`, `mealPlan(weekStart)`, `groceries`, `commonIngredients`, `me`).
- **Reference pattern** — `lib/api/hooks.ts`: `useCookbooks()`, `useRecipe(id)` reads and a
  `useCreateCookbook()` mutation that invalidates `queryKeys.cookbooks` on success.
- **Migrated screens** (proof, not new scope) — `app/(app)/recipes.tsx` (drops manual fetch/focus-refetch
  for `useCookbooks()`), `app/recipe/[id].tsx` (`useRecipe(id)` + write-through on edit + invalidate on
  delete), `NewCookbookSheet` (the mutation hook), `CookbookPickerSheet` (invalidate on save).
- **Docs** — `docs/client-caching.md`, linked from `CLAUDE.md`.

## Verification

- **Types** — `tsc --noEmit` clean.
- **Tests** — full server suite green offline: **23 files, 86 tests passed** (`server` is the only test
  suite; the change is client-only, no regression).
- **Simulator demo** (iPhone 16 Pro, Expo Go SDK 54, against a live backend on the healthy local
  Postgres):
  1. Recipes screen loads cookbooks via `useCookbooks()` → server logs `GET /v1/cookbooks`.
  2. Create "Week" cookbook → `POST /v1/cookbooks` then an automatic `GET /v1/cookbooks` (the
     `invalidateQueries` refetch); the cookbook appears.
  3. **Cold-restart the app** → the cookbook renders immediately from the AsyncStorage-persisted cache
     with **zero** network calls (GET count stays at 2). This is "serves cached data" proven.

  Screenshots + server request log in the worker scratchpad (`04-recipes`, `09-created`,
  `11-cached-final`).

## Scope held

Provider + keys + reference hooks + doc only. No Wave-2 feature work; no screens the Wave-2 tasks own were
refactored.
