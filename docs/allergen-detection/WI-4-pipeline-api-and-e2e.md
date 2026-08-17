# WI-4 — Pipeline integration, persistence, API surface, and e2e

**Depends on:** WI-1 (schema/domain), WI-3 (detector). Live e2e also depends on WI-2 (real seed).

## Background

The detector (WI-3) must run at ingest and its result must reach the recipe row and the API,
mirroring nutrition end to end. This work item adds the best-effort `allergenStep`, the persist
mapping, the API surface, the graceful-degradation guarantee, monitoring, and the two e2e
tiers. See "Use Case Implementations", "APIs", "Monitoring", and "Testing" in
`docs/allergen-detection-design.md`.

## Objective

Wire `AllergenDetector` into `import-workflow.ts` as `allergenStep` (after `nutritionStep`,
before persist), persist `allergens` + `allergens_complete`, surface them on `PublicRecipe`,
emit metrics, and cover it with integration + e2e tests.

## Acceptance Criteria

1. Given `import-workflow.ts`, a new `allergenStep` runs after `nutritionStep` and before
   persist, using a per-recipe `try/catch` so one failure withholds only that recipe's profile.
2. Given a detection failure (thrown error), the recipe still persists with `allergens = null`,
   `allergens_complete = 0`, and the import job reaches `ready` — mirroring the nutrition
   graceful-degradation behavior (commit `4c99de0`).
3. Given persistence, `RecipeInput` carries the allergen profile and `recipe-repository`'s
   `allergenColumns()` writes `allergens` (JSON) + `allergens_complete` in the existing recipe
   transaction. `null` profile → `null` JSON + `0` complete.
4. Given the recipe read, `PublicRecipe` exposes `allergens` as
   `{ contains: string[], may_contain: string[], complete: boolean }`, snake_case, omitted when
   the profile is null (matching the `nutrition`/`nrf_score` convention).
5. Given monitoring, the step emits `allergen_detect_outcome{detected|withheld|error}`,
   `allergen_coverage_complete{true|false}`, and `allergen_annotation_gap`, plus a per-recipe
   log line mirroring the nutrition step.
6. Given the suite, integration tests pass, the offline golden corpus (WI-3) is wired into the
   full persist path, and the live e2e corpus asserts allergens on imported rows.

## Test Cases

### Test Case 1: Attach at ingest (integration)
**Preconditions:** `migratedFileDb()` + fixture catalog + annotations; a recipe with milk + peanut.
**Steps:** Run the import pipeline through persist; read the recipe row.
**Expected Outcomes:** `allergens = {contains:["milk","peanut"], mayContain:[]}`,
`allergens_complete = 1`.

### Test Case 2: Detection error does not fail import (integration)
**Preconditions:** Force `AllergenDetector.detect` to throw.
**Steps:** Run the pipeline.
**Expected Outcomes:** Recipe persists with `allergens = null`, `allergens_complete = 0`; job
status `ready`; nutrition unaffected.

### Test Case 3: API surface
**Preconditions:** A recipe with a profile and one with `null`.
**Steps:** `GET` each recipe.
**Expected Outcomes:** First returns the `allergens` object snake_case; second omits `allergens`
entirely.

### Test Case 4: Live pipeline e2e
**Preconditions:** `tests/e2e/` corpus extended with `expectedAllergens`; real seeded catalog.
**Steps:** `npm run test:e2e` importing the corpus recipes end to end.
**Expected Outcomes:** Each imported row's allergen set matches `expectedAllergens`.

## Test Run

_To be filled during execution._

## Deployment Strategy

The step is best-effort and additive; the worst case is a withheld profile (safe: reads
undetermined). Deploy after WI-1/WI-2/WI-3. No flag required, but the seed (WI-2) must be in
place first or every recipe reads `complete = false` until it is. Rollback: revert code; the
columns go inert and existing rows read undetermined — no false "allergen-free" is possible.

## Production Verification

### Production Verification 1: Real imports carry allergens
**Preconditions:** Deployed; catalog seeded.
**Steps:** Import a known peanut recipe and a known all-vegetable recipe.
**Expected Outcomes:** Peanut recipe → `contains` includes `peanut`; veg recipe →
`complete = true` with no major allergen. `allergen_detect_outcome{error}` rate < 1%.

### Production Verification 2: Graceful degradation holds
**Preconditions:** Deployed.
**Steps:** Monitor `allergen_detect_outcome` and import-success rate over the first day.
**Expected Outcomes:** Import success rate unchanged from pre-deploy; `error`/`withheld` recipes
still persist and reach `ready`.

## Production Verification Run

_To be filled during execution._
