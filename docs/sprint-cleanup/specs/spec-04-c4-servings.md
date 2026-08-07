---
tags: [harvest, cleanup, spec, C4]
story: C4 — servings estimate
source_of_truth: docs/sprint-cleanup/DESIGN.md (Revision 2)
architect: docs/sprint-cleanup/ARCHITECT-REVIEW.md (Q-04)
migration: 0008 (shared with C5)
---

# Spec 04 — C4: Servings Estimate

## Summary

When a source carries no serving count, we still want a usable number for scaling. Add
`recipes.servings_estimated boolean not null default false`. At the persist chokepoint
`toRecipeInput`, when `data.servings` is absent, set `servings = 4` **and**
`servings_estimated = true`; when the source gave a yield, parse it and leave
`servings_estimated = false`. `PublicRecipe` surfaces the flag so the client knows the
number is a guess.

The estimate is a **flat constant `4`** (founder decision Q-04), not a heuristic. A
weight-based heuristic needs the food catalog and is over-scoped for C4; scaling is pure
multiplication. Mark the constant with a `ponytail:` note and its upgrade path.

## Acceptance Criteria

- [ ] Migration **0008** (shared with C5) adds `recipes.servings_estimated boolean not null default false`.
- [ ] The Drizzle `recipes` schema (`server/src/db/schema/recipes.ts`) has `servingsEstimated: boolean('servings_estimated').notNull().default(false)`.
- [ ] `toRecipeInput` (`import-pipeline.ts:408`) sets `servings = 4, servingsEstimated = true` when `data.servings` is falsy; sets `servings = parseInt(data.servings)`, `servingsEstimated = false` when a yield is present and parses to a positive integer.
- [ ] `RecipeInput` (`recipe-repository.ts:9-19`) gains `servingsEstimated: boolean`; `insertRecipe` (`:92-106`) writes the column.
- [ ] `RecipeSchema` (`models/recipe.ts:6-16`) gains `servingsEstimated: z.boolean()`.
- [ ] `PublicRecipe` (`models/recipe.ts:39-49`) gains `servings_estimated: boolean`; `toPublicRecipe` (`:57-71`) always emits it (it is non-null).
- [ ] Integration: an imported recipe with no `recipeYield` persists `servings = 4` and `servings_estimated = true`; one with a yield persists the parsed number and `servings_estimated = false`.

## Files & functions touched (verified against code)

### Migration (new — 0008, shared with C5)

- `server/drizzle/0008_*.sql` (generated). Adds `servings_estimated boolean not null default false` to `recipes`. **Additive, back-compat** (DESIGN Deployment → Migrations table, row for 0008). C5's enum + 8 nutrient columns land in the same migration.

### `server/src/db/schema/recipes.ts`

- Add `servingsEstimated: boolean('servings_estimated').notNull().default(false)` (needs the `boolean` import from `drizzle-orm/pg-core`, currently imports `numeric, timestamp` etc. at `:2`). Sits alongside `servings` (`:12`).

### `server/src/pipeline/import-pipeline.ts`

- **`toRecipeInput` (`:408-420`)** — replace the current `servings` line (`:413`):
  ```
  servings: data.servings ? parseInt(data.servings, 10) || undefined : undefined,
  ```
  with logic that yields both `servings` and `servingsEstimated`:
  - if `data.servings` parses to a positive integer → `{ servings: n, servingsEstimated: false }`.
  - else → `{ servings: 4, servingsEstimated: true }`. // ponytail: flat constant-4 estimate; a weight-based heuristic needs the food catalog and is over-scoped for C4 — upgrade if users complain (Q-04).

### `server/src/repositories/recipe-repository.ts`

- **`RecipeInput` (`:9-19`)** — add `servingsEstimated: boolean`.
- **`insertRecipe` (`:92-106`)** — add `servingsEstimated: recipe.servingsEstimated` to the insert `.values({...})`.
- (`cloneRecipe` at `:218-251` is deleted by C6/spec-07; no C4 change needed there.)

### `server/src/models/recipe.ts`

- **`RecipeSchema` (`:6-16`)** — add `servingsEstimated: z.boolean()`.
- **`PublicRecipe` (`:39-49`)** — add `servings_estimated: boolean`.
- **`toPublicRecipe` (`:57-71`)** — set `publicRecipe.servings_estimated = recipe.servingsEstimated` unconditionally (non-null field).

## Implementation notes (from DESIGN.md)

- **Flat `4`, not a heuristic** (DESIGN Decisions / Open Questions Q-04, Architect Q-04): "Accept flat `servings = 4` + the boolean. A weight-based heuristic needs the food catalog and is over-scoped for C4; scaling is pure multiplication." Keep the `ponytail:` note (DESIGN Q-04: "keep the `ponytail:` note").
- **Where** (DESIGN "Import & persist", note over `toRecipeInput`): "C4 — servings null → 4, servings_estimated=true." The estimate is applied at the persist chokepoint, after the adapter, so both LLM and JSON-LD paths get it.
- **Source of the yield string**: `data.servings` originates from `mapRecipe`'s `recipeYield` mapping (`website.ts:126-127`) for JSON-LD and from the LLM `servings` field otherwise. Absent yield ⇒ absent `data.servings` ⇒ estimate.
- **Scaling is out of scope** — DESIGN and Architect Q-04 both note scaling is pure client-side multiplication; C4 only supplies an honest starting number + the flag.

## Test cases (offline — never hit the network)

### Integration — `server/tests/integration/parse-persist.test.ts` (extend)

- **No-yield → estimate.** Persist via a `RecipeInput` (or a stubbed import) whose extracted data has no `servings`; assert the `recipes` row has `servings = 4` and `servings_estimated = true`. (Covers AC: no-`recipeYield` → 4 + estimated.)
- **With yield → parsed, not estimated.** Persist extracted data with `servings = "6"`; assert the row has `servings = 6` and `servings_estimated = false`. (Covers AC: parsed number + estimated=false.)
- **Public projection.** `GET /v1/recipes/:id` (or `toPublicRecipe` directly) returns `servings_estimated` in the body for both cases.

Note: the existing `RECIPE` fixtures in `parse-persist.test.ts:7-14` and `recipe.test.ts:17-24` must add `servingsEstimated` to satisfy the new `RecipeInput` field (a compile requirement, folded into these edits).

## Out of scope

- Any weight-based or ingredient-based serving heuristic (Q-04 — flat 4).
- Client-side scaling math (pure multiplication; no server work).
- The 8 nutrition columns / `nutrition_source` enum that ride in migration 0008 (C5 — spec-05).
- The `user_id` column / `saved_recipes` drop (C6 — spec-07, migration 0006).
- Any change to the `recipeYield` parsing in `mapRecipe` — C4 consumes `data.servings` as-is.
