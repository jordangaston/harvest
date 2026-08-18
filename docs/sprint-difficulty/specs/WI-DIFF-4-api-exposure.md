# WI-DIFF-4 — Expose difficulty on the recipe API

## Background

WI-DIFF-3 persists and reads difficulty onto `RecipeDetail`. This work item projects it onto the public
API so clients (and later the ranking engine) can see the signal. Per the design
(`docs/design-recipe-difficulty-signal.md`, APIs): the recipe **detail** gains a `difficulty` object;
the **card** gains the band only (a card shows a badge, not the number). Per-step difficulty stays
stored-but-unexposed for now (Q-06) — `steps` remains `string[]`.

Precedent: `nrf_score` is stored numeric→text and projected as a `number` via `toPublicRecipe`; the
same mapping applies to `difficulty.score`.

## Objective

1. `PublicRecipe` gains `difficulty?: { score: number; band: 'beginner'|'intermediate'|'advanced' }`,
   present only when the recipe is scored (null → omitted, matching the null-optional convention).
2. `toPublicRecipe` maps `RecipeDetail.difficulty` → `PublicRecipe.difficulty` (score as `number`).
3. `PublicRecipeCard` gains `difficulty_band?: string`; `listCards` selects `recipes.difficultyBand`
   and `toPublicRecipeCard` includes it when present. `RecipeCard` gains `difficultyBand: string|null`.
4. Tests for the projections and the list/detail endpoints.

## Acceptance Criteria

1. **Detail exposure.** Given a scored recipe, when `GET /v1/recipes/:id` returns, then
   `recipe.difficulty = { score: <number 0–100>, band: <"beginner"|"intermediate"|"advanced"> }`.
2. **Detail omission.** Given an un-scored (null) recipe, when `GET /v1/recipes/:id` returns, then
   `difficulty` is absent (not `null`), matching how `nutrition`/`nrf_score` omit.
3. **Card exposure.** Given a scored recipe, when `GET /v1/recipes` returns its card, then
   `difficulty_band` is the band string; an un-scored recipe's card omits `difficulty_band`.
4. **Card excludes the raw score.** Given any card, when returned, then it carries no numeric
   difficulty score — only the band.
5. **Score type.** Given the detail projection, when serialized, then `difficulty.score` is a JSON
   number (not the stored string), like `nrf_score`.
6. **Suite green.** New projection/endpoint tests and the existing suite pass.

## Test Cases

### Test Case 1: toPublicRecipe projection (unit)
**Preconditions:** A `RecipeDetail` with `difficulty = { score: 55.6, band: 'intermediate', stepDifficulties: [...] }`.
**Steps:** Call `toPublicRecipe`.
**Expected Outcomes:** `result.difficulty = { score: 55.6, band: 'intermediate' }`. With
`difficulty: null`, `result.difficulty` is undefined.

### Test Case 2: toPublicRecipeCard projection (unit)
**Preconditions:** A `RecipeCard` with `difficultyBand: 'advanced'` and one with `null`.
**Steps:** Call `toPublicRecipeCard` on each.
**Expected Outcomes:** First → `difficulty_band: 'advanced'`; second → key absent.

### Test Case 3: GET /v1/recipes/:id (integration)
**Preconditions:** Persist a scored recipe (reuse WI-DIFF-3 path) in the test db.
**Steps:** `GET /v1/recipes/:id`.
**Expected Outcomes:** Response `recipe.difficulty` present with numeric `score` and a valid `band`;
`steps` remains a string array (no per-step difficulty exposed).

### Test Case 4: GET /v1/recipes (integration)
**Preconditions:** A scored and an un-scored recipe in the library.
**Steps:** `GET /v1/recipes`.
**Expected Outcomes:** Scored card has `difficulty_band`; un-scored card omits it; no raw score on any
card.

## Deployment Strategy

Direct deploy after WI-DIFF-3. Purely additive to the read contract (new optional response fields);
clients ignoring them are unaffected. No migration. Rollback: revert the projection; the columns remain.

## Production Verification

### Production Verification 1: API shows difficulty
**Preconditions:** Deployed; a scored recipe from a live import.
**Steps:** `GET /v1/recipes/:id` and `GET /v1/recipes` for that user.
**Expected Outcomes:** Detail carries the `difficulty` object; the card carries `difficulty_band`; an
older un-scored recipe omits both.
