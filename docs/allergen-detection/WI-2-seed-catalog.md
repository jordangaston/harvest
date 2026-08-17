# WI-2 — Seed the allergen catalog (`build-allergen-catalog.ts`)

**Depends on:** WI-1 (table + domain types).

## Background

`fdc_food_allergen` (WI-1) is the single source of allergen mapping, keyed to the FDC catalog.
It is populated offline, mirroring `server/scripts/build-fdc-catalog.ts`: an env-var data
source, a pure row-mapping function, and batched idempotent inserts. See the "Seeding the
allergen catalog" section of `docs/allergen-detection-design.md`.

Because the coverage guarantee is structural — a recognized food always resolves to a defined
allergen set — the seed's correctness is the safety surface (design Q-01). It runs *after* the
FDC catalog seed, since it reads `fdc_foods`.

## Objective

Add `server/scripts/build-allergen-catalog.ts` and its config, driven by a pure
`toAllergenRows(food)` mapping, that annotates every FDC food and batch-inserts into
`fdc_food_allergen`. Unit-test the mapping offline.

## Acceptance Criteria

1. Given `server/src/allergen/allergen-catalog.ts` (config), it exports const
   `ALLERGEN_BY_CATEGORY` (FDC WWEIA category → `{allergen, presence}[]`), the species term
   lists `TREE_NUT_SPECIES` / `FISH_TERMS` / `CRUSTACEAN_TERMS`, and `ALLERGEN_OVERRIDES`
   (keyed by `fdc_id`). All const config, no loose strings.
2. Given `toAllergenRows(food)`, it returns `{fdcId, allergen, presence, species?}[]` by:
   (a) category base rows, (b) scanning `food.descriptionNormalized` for species terms to
   add/confirm rows with `species`, (c) applying `ALLERGEN_OVERRIDES[fdcId]` last (add or
   remove). A food with no allergen returns `[]`.
3. Given `toAllergenRows`, it reuses `normalize()` for any term matching so scans align with
   how `description_normalized` was built by the FDC seed.
4. Given the script, it reads `fdc_foods` from the DB (Turso creds via env, like the FDC seed),
   maps each food, and inserts rows in batches of 500 with `.onConflictDoNothing()`.
5. Given the script is run twice, the second run is a no-op (idempotent).
6. Given `tsx server/scripts/build-allergen-catalog.ts`, it logs a count of seeded rows and
   exits 0.
7. Given the suite, a `toAllergenRows` unit test passes and the full suite stays green.

## Test Cases

### Test Case 1: Category base mapping
**Preconditions:** `allergen-catalog.ts` + `toAllergenRows` implemented.
**Steps:** Call `toAllergenRows` on a fixture `SurveyFood` with `category: "Cheese"` and a
plain description.
**Expected Outcomes:** Returns `[{allergen:'milk', presence:'contains', ...}]`.

### Test Case 2: Species refinement
**Preconditions:** As above.
**Steps:** Call on a food `category: "Nuts and seeds"`, `description: "Cashews, dry roasted"`.
**Expected Outcomes:** Returns a `tree_nut` row with `species: 'cashew'`.

### Test Case 3: Override wins
**Preconditions:** `ALLERGEN_OVERRIDES` contains an `almond milk` fdc_id → `tree_nut`, remove `milk`.
**Steps:** Call on that food (whose description would otherwise trip a `milk` rule).
**Expected Outcomes:** Returns `tree_nut`, not `milk`.

### Test Case 4: No allergen → empty
**Preconditions:** As above.
**Steps:** Call on `category: "Vegetables"`, `description: "Carrots, raw"`.
**Expected Outcomes:** Returns `[]`.

### Test Case 5: Idempotent insert
**Preconditions:** Migrated DB seeded with a few `fdc_foods`.
**Steps:** Run the seed's insert path twice against the same DB.
**Expected Outcomes:** Row count identical after both runs; no error.

## Test Run

_To be filled during execution._

## Deployment Strategy

Offline data seed, run as a deploy step after `build-fdc-catalog.ts` and before code that reads
the table (WI-3/WI-4). Re-runnable whenever the config changes. No app-code risk; the table is
unread until WI-3 ships.

## Production Verification

### Production Verification 1: Prod catalog annotated
**Preconditions:** Seed run against the prod DB after the FDC catalog.
**Steps:** Query `fdc_food_allergen` row counts and spot-check known foods (a cheese → milk, a
salmon → fish, a cashew → tree_nut).
**Expected Outcomes:** Non-zero rows; spot checks correct; `allergen_annotation_gap` metric
(WI-4) within expected range.

## Production Verification Run

_To be filled during execution._
