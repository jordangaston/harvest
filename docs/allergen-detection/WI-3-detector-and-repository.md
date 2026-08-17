# WI-3 — AllergenRepository and AllergenDetector

**Depends on:** WI-1 (table + domain). Uses fixtures for tests, not the WI-2 seed.

## Background

With the table and domain in place, this work item builds the detection logic. Per the design,
detection reuses the nutrition pipeline's parts: `FoodMatcher` recognizes each ingredient and
resolves its `fdc_id`; `fdc_food_allergen` supplies the allergen set. There is no new matcher
and no free-text lexicon. See "Modules" and "detect() contract" in
`docs/allergen-detection-design.md`.

The safety rule lives here: an ingredient `FoodMatcher` cannot match contributes no positive
and leaves `complete = false`, so its allergens read *undetermined*, never *absent*.

## Objective

Add `AllergenRepository.allergensFor(fdcId)` and `AllergenDetector.detect(ingredients)`, with an
offline golden-corpus test that asserts exact allergen sets.

## Acceptance Criteria

1. Given `server/src/allergen/allergen-repository.ts`, `AllergenRepository.create(db)` exposes
   `allergensFor(fdcId): AllergenHit[]` reading `fdc_food_allergen`.
2. Given `server/src/allergen/allergen-detector.ts`, `AllergenDetector.create(db)` exposes
   `detect(ingredients: StructuredIngredient[]): RecipeAllergens | null`.
3. Given a matched ingredient, its allergens come from `allergensFor(match.fdcId)`; a
   `medium`-quality match downgrades `contains` → `may_contain`.
4. Given presences across ingredients, they merge via `mergePresence` (`contains` beats
   `may_contain`); only detected allergens appear in `presences`.
5. Given coverage, `complete = ingredients.every(recognized)` where `recognized = FoodMatch is
   high|medium`. An unmatched ingredient sets `complete = false` and adds no positive.
6. Given an empty ingredient list, `detect` returns `null`.
7. Given the suite, unit + golden-corpus tests pass and the full suite stays green.

## Test Cases

### Test Case 1: Detect positives (unit)
**Preconditions:** `migratedFileDb()` seeded with `seedFdcFixture()` + `seedAllergens()` fixture
rows (milk food → milk, peanut food → peanut).
**Steps:** `detect(["1 cup milk", "2 tbsp peanut butter"])`.
**Expected Outcomes:** `presences = {milk: contains, peanut: contains}`, `complete = true`.

### Test Case 2: Coverage asymmetry (the critical test)
**Preconditions:** Fixture DB; one ingredient name that `FoodMatcher` cannot match.
**Steps:** `detect(["1 cup milk", "3 sprigs zzzq unknownherb"])`.
**Expected Outcomes:** `presences = {milk: contains}`, `complete = false`. No allergen is
reported absent.

### Test Case 3: Merge precedence across ingredients
**Preconditions:** Fixture where one food yields `may_contain X` and another yields `contains X`.
**Steps:** `detect` over both.
**Expected Outcomes:** `presences[X] = contains`.

### Test Case 4: Empty list
**Steps:** `detect([])`.
**Expected Outcomes:** returns `null`.

### Test Case 5: Golden corpus (exact-set e2e, offline)
**Preconditions:** `test/fixtures/allergen-recipes.json` labeled corpus; fixture catalog +
annotations seeded.
**Steps:** For each case run the real `AllergenDetector` and compare to `expect`.
**Expected Outcomes:** Exact set equality on `contains`, `mayContain`, and `complete` for every
case — including `almond milk → tree_nut` (not milk), `soy sauce → soybean + wheat`,
all-veg recipe → `complete = true` with no allergens, `coconut → no allergen`.

## Test Run

_To be filled during execution._

## Deployment Strategy

Pure library code, unreferenced until WI-4 wires it into the pipeline. Ships with no runtime
effect. No flag needed.

## Production Verification

Covered indirectly via WI-4 (the detector only runs in prod once the pipeline calls it).
Verification of detection quality is WI-4's live-pipeline check.

## Production Verification Run

_To be filled during execution._
