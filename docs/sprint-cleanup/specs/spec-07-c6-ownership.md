---
tags: [harvest, cleanup, spec, C6]
story: C6 — recipe ownership (drop saved_recipes + copy-on-write)
source_of_truth: docs/sprint-cleanup/DESIGN.md (Revision 2)
architect: docs/sprint-cleanup/ARCHITECT-REVIEW.md (N1, N2, C6 verified)
migration: 0006
---

# Spec 07 — C6: Recipe Ownership

## Summary

Move recipe ownership from the `saved_recipes` join to a single `recipes.user_id` owner
column, and delete copy-on-write. The owner (`recipes.user_id`) edits **in place**;
`cookbook_recipes` remains the save/organization mechanism. Non-owner or unknown-id
edit/delete returns **404** (don't leak existence — Architect N1). Reads stay open (any
authenticated caller can open any recipe).

`saved_recipes` and its two indexes are dropped; `schema/saved-recipes.ts` and its
re-export are removed; the stale "ownership lives in `saved_recipes`" comments are
corrected. Copy-on-write (`cloneRecipe`/`repointUser`/`countSavers`/`isSavedBy`/
`saveForUser`) is deleted. HTTP contracts are otherwise unchanged; the mobile
`app/recipe/[id].tsx` drops its fork handling (the id never changes now).

**Migration 0006 assumes `recipes` is empty** (adds `user_id NOT NULL`, no default;
drops `saved_recipes`). True pre-launch; on a populated dev/staging DB it drops the DB
rather than failing mid-migrate — wipe such an env, don't debug it (Architect risk 4).

`PublicRecipe` also gains `servings_estimated` + the 8 label-core macros +
`nutrition_source` (their columns arrive in migrations 0008 from C4/C5); this spec only
notes the projection additions where they intersect the ownership refactor — the column
definitions and compute belong to spec-04/spec-05.

## Acceptance Criteria

### Schema / migration 0006

- [ ] Migration **0006** adds `recipes.user_id uuid not null references users(id)` and index `recipes_user_idx on (user_id, created_at desc)`.
- [ ] Migration 0006 **drops** the `saved_recipes` table and both its indexes (`saved_recipes_user_recipe_uidx`, `saved_recipes_user_idx`).
- [ ] `server/src/db/schema/saved-recipes.ts` is deleted; the `export * from './saved-recipes.js'` line in `schema/index.ts:4` is removed; `SavedRecipe`/`NewSavedRecipe` no longer resolve anywhere.
- [ ] `recipes` schema gains `userId: uuid('user_id').notNull().references(() => users.id)` + the `recipes_user_idx` index; the stale comment `recipes.ts:5-6` ("ownership lives in `saved_recipes`") is corrected/removed (Architect N2).
- [ ] Stale "ownership lives in `saved_recipes`" comments corrected in `cookbooks.ts:5-7` and `cookbook-recipes.ts:8`.

### Repository

- [ ] `RecipeRepository.persist` sets `recipes.user_id = userId`; `saveForUser` (`:139-141`) is deleted and no longer called from `persist` (`:81`).
- [ ] `updateContent` edits **in place** — no clone, no repoint. `cloneRecipe` (`:218-251`), `repointUser` (`:254-266`), `countSavers` (`:212-215`) are deleted.
- [ ] `isSavedBy` (`:148-154`) and `saveForUser` (`:139-141`) are deleted.
- [ ] `removeForUser` (`:195-209`) becomes `deleteOwned(userId, id): boolean` — deletes the canonical `recipes` row when `user_id === userId`; children (`ingredients`, `recipe_steps`, `cookbook_recipes`, `import_job_recipes`) cascade (all FK `onDelete: 'cascade'` — Architect-verified). Returns `false` (→ 404) when the row is missing or not owned.
- [ ] New `findOwner(id): string | null` returns `recipes.user_id` or null for an unknown id.
- [ ] New `listOwned(userId): Recipe[]` (used by tests; **not exposed as an endpoint** — Q-03).

### Service / API

- [ ] `RecipeService.update` (`:38-42`) resolves ownership via `findOwner`: a non-owner or unknown id → **404 `NotFoundError`** (NOT 403 — Architect N1). Owner → edit in place; the returned id always equals the request id.
- [ ] `RecipeService.remove` (`:50-53`) → `deleteOwned`; not owned / unknown → 404.
- [ ] `cookbook-repository.setMembership` (`:118-125`) drops the `savedRecipes` insert (`:120`); membership is purely `cookbook_recipes`.
- [ ] `PublicRecipe` gains `servings_estimated` (C4), the 8 label-core macros, and `nutrition_source` (C5) — projection stubs land here; the values come from spec-04/spec-05.
- [ ] `GET /v1/recipes` is **not** added; `listOwned` exists but no route consumes it (Q-03).
- [ ] HTTP contracts otherwise unchanged (`PATCH`/`DELETE` bodies/responses identical; `PATCH` still returns `{ recipe }` with the same id).
- [ ] Mobile `app/recipe/[id].tsx` drops the fork branch at `:83` (`if (updated.id !== id) router.replace(...)`), since the id never changes.

### Tests

- [ ] Non-owner PATCH → 404; non-owner DELETE → 404 (Architect N1).
- [ ] Owner edit in place: PATCH keeps the same id; edited ingredient lines keep their amounts (parseable lines carry non-null `amount` — depends on spec-03/C3).
- [ ] Owner delete cascades cleanly (children gone, no FK error).
- [ ] All `saved_recipes` references removed across the test suite.
- [ ] `scaffold.test.ts` audit: asserts `recipes.user_id` column + `recipes_user_idx` index present; asserts no `saved_recipes` table and no `saved_recipes_user_idx` index.

## Files & functions touched (verified against code)

### Migration (new — 0006)

- `server/drizzle/0006_*.sql` (generated). `recipes` add `user_id` (not null, fk → users) + `recipes_user_idx`; **drop `saved_recipes`** (+ `saved_recipes_user_recipe_uidx`, `saved_recipes_user_idx`). Destructive, intended, no back-compat (DESIGN Deployment → Migrations, row 0006).

### `server/src/db/schema/`

- **`recipes.ts`** — add `userId: uuid('user_id').notNull().references(() => users.id)` (needs `users` import) + a table-config array with `index('recipes_user_idx').on(table.userId, table.createdAt.desc())`. Remove/replace the `:5-6` comment (Architect N2).
- **`saved-recipes.ts`** — **delete the file** (currently defines `savedRecipes` + `SavedRecipe`/`NewSavedRecipe`, `:7-26`).
- **`index.ts`** — delete line `:4` (`export * from './saved-recipes.js'`).
- **`cookbooks.ts:5-7`** and **`cookbook-recipes.ts:8`** — correct the "ownership … `saved_recipes`" comments (organization is `cookbook_recipes`; ownership is `recipes.user_id`).

### `server/src/repositories/recipe-repository.ts`

- Remove the `savedRecipes` import (`:3`).
- **`RecipeInput`** — no `userId` field needed (still passed as the `persist` arg); optionally document that `user_id` is set from the `userId` arg.
- **`persist` (`:76-84`)** — pass `userId` into `insertRecipe` so the row carries `user_id`; drop the `saveForUser` call (`:81`).
- **`insertRecipe` (`:92-106`)** — add `userId` param; write `userId: userId` in `.values({...})`.
- **`updateContent` (`:174-186`)** — drop the `countSavers`/`cloneRecipe`/`repointUser` branch; always edit in place (`replaceIngredients`/`replaceSteps` on `recipeId`). Signature no longer needs `userId` for the fork logic; the service does the owner check. Change the return type note: id is always the request id.
- **Delete**: `saveForUser` (`:139-141`), `isSavedBy` (`:148-154`), `countSavers` (`:212-215`), `cloneRecipe` (`:218-251`), `repointUser` (`:254-266`). `usersCookbookIds` (`:269-272`) is used by `removeForUser`/`repointUser`; keep only if `deleteOwned` still needs it — `deleteOwned` deletes the canonical row so `cookbook_recipes` cascades, meaning `usersCookbookIds` is no longer needed and can be deleted too.
- **`removeForUser` (`:195-209`) → `deleteOwned(userId, recipeId): boolean`** — `delete from recipes where id = recipeId and user_id = userId returning id`; return `deleted.length > 0`. Children cascade.
- **New `findOwner(recipeId): Promise<string | null>`** — `select user_id from recipes where id = recipeId`.
- **New `listOwned(userId): Promise<Recipe[]>`** — `select * from recipes where user_id = userId order by created_at desc`, `RecipeSchema.parse` each row. (Tests only — Q-03.)

### `server/src/services/recipe-service.ts`

- **`update` (`:38-42`)** — replace `isSavedBy` check with `findOwner`: `const owner = await this.recipes.findOwner(recipeId); if (owner !== userId) throw new NotFoundError();` (covers unknown id — `findOwner` returns null ≠ userId → 404, Architect N1). Then map `edit.ingredients` through `parseIngredientLine` (spec-03/C3 M2) and call `updateContent(recipeId, { ingredients, steps })`; return `this.get(recipeId)` (id unchanged). Update the TSDoc (currently says "copy-on-write" / "hasn't saved").
- **`remove` (`:50-53`)** — `const ok = await this.recipes.deleteOwned(userId, recipeId); if (!ok) throw new NotFoundError();`. Update TSDoc.

### `server/src/repositories/cookbook-repository.ts`

- Remove the `savedRecipes` import (`:3`).
- **`setMembership` (`:118-125`)** — delete the `tx.insert(savedRecipes)...` line (`:120`); membership is `cookbook_recipes` only.

### `server/src/models/recipe.ts`

- `PublicRecipe` (`:39-49`) + `toPublicRecipe` (`:57-71`) gain `servings_estimated` (spec-04), the 8 label-core macros + `nutrition_source` (spec-05). This spec only flags the shared touch point; the field definitions and mapping live in those specs.

### `server/src/api/app.ts`

- No route added (`GET /v1/recipes` deferred — Q-03). Correct the stale `PATCH`/`DELETE` doc-comments (`:135-152`) that say "copy-on-write" / "the caller's copy" / "hasn't saved" to reflect owner-only-in-place + 404.

### Mobile — `app/recipe/[id].tsx`

- Remove the fork branch at `:83` (`if (updated.id !== id) router.replace(...) // copy-on-write forked`) — the id is stable now. The rest of the edit/delete flow is unchanged.

## Implementation notes (from DESIGN.md)

- **Owner column + join is the convention, not a contradiction** (DESIGN Entities / Decisions "C6 owner column"): `recipes.user_id` = one creator/editor; `cookbook_recipes` = many savers. Matches `server/CLAUDE.md` "shared ownership = canonical entity + join."
- **404, never 403** for non-owner or unknown id (DESIGN "Edit / delete" + APIs; Architect N1): don't leak existence. `findOwner` returning null (unknown id) and returning another user's id both funnel to 404.
- **Cascades verified** (Architect "Verified"): `ingredients`, `recipe_steps`, `cookbook_recipes`, `import_job_recipes` all FK `recipes` with `onDelete: 'cascade'`. Owner-delete of the canonical row is clean — confirmed in `ingredients.ts:9`, `cookbook-recipes.ts:18`, `saved-recipes.ts:16` (being dropped).
- **Migration 0006 assumes empty `recipes`** (DESIGN Tables → saved_recipes, Deployment; Architect risk 4): `user_id NOT NULL` with no default. Pre-launch only.
- **`listOwned` built but not exposed** (Q-03): tests use it; no screen consumes an owned list — `app/(app)/recipes.tsx` lists cookbooks.

## Test cases (offline — never hit the network)

### Integration — `server/tests/integration/recipe.test.ts` (rewrite the CoW sections)

- **Drop** the "forks a private clone when another user also saved it" test (`:129-153`) and the "edits in place when the caller is the only saver" test's reliance on saver-count semantics.
- **Non-owner PATCH → 404** (Architect N1): owner persists a recipe; a stranger PATCHes → 404. (Replaces `:155-167`, which asserted "hasn't saved" 404 — the assertion stays 404 but the reason is now ownership.)
- **Non-owner DELETE → 404**: owner persists; stranger DELETEs → 404. (Adapts `:186-191`.)
- **Owner edit in place**: owner PATCHes `{ steps: [...] }` → 200, `recipe.id === recipeId` (same id, no fork). Owner PATCHes `{ ingredients: ["2 cups flour"] }` → the returned/persisted ingredient carries `amount === "2"`, `unit === "cup"` (edited lines keep amounts — depends on spec-03).
- **Owner delete cascades**: owner persists a recipe with ingredients + steps + a cookbook membership; owner DELETEs → 204; assert `ingredients`, `recipe_steps`, `cookbook_recipes` rows for that recipe are gone; a second DELETE → 404.
- **Remove all `savedRecipes`** from imports, the `beforeEach` cleanup (`:8-13`, `:52-60`), and every assertion in this file. `persist` no longer writes a `saved_recipes` row.

### Integration — remove `savedRecipes` across the suite

Delete `savedRecipes` imports/inserts/deletes/assertions in:
`recipe.test.ts`, `parse-persist.test.ts` (`:4`, `:27`, `:49`, `:57-59`), `cookbook.test.ts`, `import.test.ts`, `user-repository.test.ts`, `phone-auth.test.ts`. Where a test asserted a save-join row (e.g. `parse-persist.test.ts:49` "one join in a transaction"), replace with an assertion that the persisted `recipes` row has `user_id === userId`.

### Integration — `server/tests/integration/scaffold.test.ts` (update the schema audit)

- **Tables (`:30-39`)**: drop `'saved_recipes'` from the `arrayContaining`.
- **Indexes (`:44-48`)**: replace `'saved_recipes_user_idx'` with `'recipes_user_idx'` in the `indexname in (...)` list (keep count consistent).
- **Add**: assert the `recipes.user_id` column exists (`select column_name from information_schema.columns where table_name='recipes' and column_name='user_id'`).
- **Add**: assert **no** `saved_recipes` table (not in `pg_tables`) and **no** `saved_recipes_user_idx` index.

(The `scaffold.test.ts` enum/`nutrition_source`/`foods`-absence assertions are added by spec-05; only the ownership-related audit changes live here.)

## Out of scope

- The C4 `servings_estimated` column and C5 nutrition columns / `nutrition_source` enum + compute (migrations 0008; spec-04/spec-05). This spec only lists the `PublicRecipe` projection additions where they touch the ownership refactor.
- Onboarding enum columns (C2, migration 0007).
- Exposing `GET /v1/recipes` (Q-03 — deferred).
- A "save someone else's recipe" flow (future `cookbook_recipes` row on an un-owned recipe — schema already allows it, not built).
- Any change to read authorization (`GET /v1/recipes/:id` stays open).
