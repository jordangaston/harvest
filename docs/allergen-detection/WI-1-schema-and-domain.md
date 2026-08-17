# WI-1 — Allergen schema, domain model, and migration

## Background

Harvest is adding a structured allergen signal to every recipe (design:
`docs/allergen-detection-design.md`). The signal targets the US FDA "Big 9" major food
allergens and attaches to the recipe row the same way nutrition does. This first work item
lays the foundation every later item builds on: the domain model, the two recipe columns, and
the FDC-keyed reference table — plus the generated migration. No detection or pipeline wiring
yet.

The signal is safety-adjacent: a false "allergen-free" is worse than a false positive, so the
model must make absence *derived* (not-detected ∧ complete coverage), never stored.

## Objective

Add the allergen domain model (`server/src/allergen/allergen.ts`), extend the `recipes` table
with `allergens` + `allergens_complete`, add the `fdc_food_allergen` reference table, and
generate the Drizzle migration. Ship the `mergePresence` helper with a unit test.

## Acceptance Criteria

1. Given the schema, `server/src/schema.ts` defines const arrays `MAJOR_ALLERGENS`
   (`milk, egg, fish, crustacean_shellfish, tree_nut, peanut, wheat, soybean, sesame`) and
   `ALLERGEN_PRESENCE` (`contains, may_contain`), and derives their union types.
2. Given the `recipes` table, it gains `allergens text` (JSON, nullable) and
   `allergens_complete integer` (boolean, not null, default `0`).
3. Given a new `fdc_food_allergen` table, it has columns `fdc_id` (int, fk → `fdc_foods.fdc_id`),
   `allergen` (enum `MAJOR_ALLERGENS`), `presence` (enum `ALLERGEN_PRESENCE`), `species`
   (text, nullable), compound PK `(fdc_id, allergen)`, and an index on `fdc_id`.
4. Given `server/src/allergen/allergen.ts`, it exports `Allergen`, `AllergenPresence`,
   `RecipeAllergens` (`{ presences: Partial<Record<Allergen, AllergenPresence>>; complete: boolean }`),
   and `mergePresence(a, b)` where `contains` always wins over `may_contain`.
5. Given `npm run db:generate`, a new migration appears in `server/drizzle/` adding the two
   recipe columns and the `fdc_food_allergen` table, and `npm run db:migrate` (or a test DB
   built by `migratedFileDb()`) applies cleanly.
6. Given the whole suite (`npm run test`), all tests pass, including a new
   `mergePresence` unit test.

## Test Cases

### Test Case 1: mergePresence precedence
**Preconditions:** `allergen.ts` implemented.
**Steps:** In `server/test/allergen.test.ts`, call `mergePresence` for every pair over
`{contains, may_contain}` in both orders.
**Expected Outcomes:** Any pair involving `contains` → `contains`; `(may_contain, may_contain)`
→ `may_contain`. Function is commutative.

### Test Case 2: Migration applies and columns exist
**Preconditions:** Migration generated.
**Steps:** Build a DB with `migratedFileDb()`; introspect the `recipes` and `fdc_food_allergen`
tables (e.g. `PRAGMA table_info`).
**Expected Outcomes:** `recipes` has `allergens` and `allergens_complete` (default 0);
`fdc_food_allergen` exists with the four columns and the compound PK.

### Test Case 3: allergens_complete defaults safe
**Preconditions:** Migrated DB.
**Steps:** Insert a `recipes` row via the existing repository without touching allergen columns.
**Expected Outcomes:** Row persists with `allergens = null` and `allergens_complete = 0`.

## Test Run

_To be filled during execution._ Expected: `npm run test` green.

## Deployment Strategy

Additive schema only — nullable column, a defaulted column, and a new table. Backwards
compatible: old code ignores the new columns. Migration ships ahead of any consuming code
(WI-3/WI-4). No feature flag needed; nothing reads the columns yet.

## Production Verification

### Production Verification 1: Migration applied, no regressions
**Preconditions:** Migration deployed to the Turso prod DB.
**Steps:** Inspect the deployed schema; import one recipe through the existing pipeline.
**Expected Outcomes:** `fdc_food_allergen` exists; new recipe rows show `allergens = null`,
`allergens_complete = 0`; existing import behavior unchanged.

## Production Verification Run

_To be filled during execution._
