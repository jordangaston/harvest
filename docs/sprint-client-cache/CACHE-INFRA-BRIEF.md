# Client caching infra (Wave-2 prerequisite)

Shared client-side caching so the Harvest mobile app serves data from cache and **only refetches when it
changes**. This is a **prerequisite** the six Wave-2 tasks build on — keep it small, low-risk, and merge it to
`main` fast. Work in the `client-cache` worktree. Follow `CLAUDE.md` + `AGENTS.md` + the workflow rules.

## Decision (already made — build to it)
Use **TanStack Query (`@tanstack/react-query`)**, persisted to **AsyncStorage**, with a long `staleTime` so
cached data is served without refetching until a mutation **invalidates** its key.

## Build
1. **Add deps** — `@tanstack/react-query` + `@tanstack/react-query-persist-client` +
   `@tanstack/query-async-storage-persister` (or the current equivalent). **Verify Expo SDK 54 / RN 0.81
   compatibility against the versioned Expo docs before installing** (per `AGENTS.md`). `@react-native-async-storage/async-storage`
   is already used by onboarding — reuse it.
2. **Provider** — wrap the app root (`app/_layout.tsx`) in `QueryClientProvider` + `PersistQueryClientProvider`
   (AsyncStorage persister). Default query options: a long `staleTime` (e.g. 5–30 min or `Infinity` for rarely-
   changing data; document the choice), a sane `gcTime`, `retry` modest. Fire-and-forget; no UI/motion change.
3. **Query keys** — `lib/queryKeys.ts`: a keys factory per resource used across Wave 2 —
   `cookbooks`, `cookbook(id)`, `recipes` (owned list), `recipe(id)`, `mealPlan(weekStart)`, `groceries`,
   `commonIngredients`, `me`. Document the convention.
4. **Reference pattern (prove it end-to-end)** — convert the existing reads in `lib/api` to hooks:
   `useCookbooks()`, `useRecipe(id)` (whatever the recipes screen + recipe detail already fetch), and migrate
   those screens to the hooks so nothing regresses and the pattern is real. Include **one `useMutation` example
   that invalidates the right key** (e.g. `createCookbook` → `invalidateQueries(queryKeys.cookbooks)`).
   Do NOT refactor screens the Wave-2 tasks own — just the couple of existing reads, as the template.
5. **Pattern doc** — `docs/client-caching.md`: how a Wave-2 Lead adds a `useQuery` hook + invalidates on its
   mutations, the key conventions, and the "long staleTime + invalidate-on-change" model. This is what the six
   Leads follow. Link it from `CLAUDE.md`'s reference list.

## Done
Whole test suite still green (offline); the app **runs on the booted iOS simulator** and demonstrably serves
cached data (e.g. revisiting the recipes screen loads cookbooks from cache, and creating a cookbook invalidates
+ refetches). Open a **PR against `main`**. Write a short `SPRINT-REPORT.md` + `POSTMORTEM.md`. Report
`worker_done` with the PR link, the deps added, the pattern-doc path, and the sim-demo evidence. Decide-and-log
blockers; don't stop. **No new feature scope** — provider + keys + the reference pattern + the doc only.
