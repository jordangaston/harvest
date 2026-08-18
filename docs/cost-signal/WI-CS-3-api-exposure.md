# WI-CS-3 — Expose cost on the recipe API

## Background

WI-CS-2 persists `cost_per_serving_cents` and `cost_coverage` on the recipe row. The ranker (and any
later cost UI) reads them through the public recipe API. This mirrors how `difficulty` is surfaced
today: the list endpoint carries the compact field for cards, the detail endpoint carries the full
object. The mapping happens in `toPublicRecipe` (`src/models/recipe.ts`), and the repository already
reads the recipe row that now includes these columns.

This is a small, additive change — the last step in the cost signal. See `docs/cost-signal/DESIGN.md`
§F-02.

## Objective

Add `cost_per_serving_cents` and `cost_coverage` to the public recipe shape so both `GET /v1/recipes`
(list) and `GET /v1/recipes/:id` (detail) return them. No new endpoints, no request/pagination change.

## Acceptance Criteria

1. **Public model.** The `PublicRecipe` type gains `cost_per_serving_cents: number | null` and
   `cost_coverage: number | null` (coverage parsed from numeric-text to a number, or null).
2. **Detail endpoint.** Given a recipe with a computed cost, when `GET /v1/recipes/:id` is called, then
   the body includes both fields with the stored values; when cost was not computed, both are `null`.
3. **List endpoint.** Given `GET /v1/recipes`, then each recipe card includes both fields. No change to
   the `page_token` pagination contract.
4. **No re-computation.** The fields are read straight from the recipe row via the existing repository
   read path; the API never invokes `CostEstimator`.

## Test Cases

### Test Case 1: Detail endpoint returns cost fields (AC 1, 2)

**Preconditions:** Integration test DB (`migratedFileDb()`) with a persisted recipe whose
`cost_per_serving_cents = 214`, `cost_coverage = "0.92"`.
**Steps:** `GET /v1/recipes/:id`.
**Expected Outcomes:** `200`; body has `cost_per_serving_cents: 214` and `cost_coverage: 0.92` (number).

### Test Case 2: Null cost round-trips as null (AC 2)

**Preconditions:** A persisted recipe with both cost columns null.
**Steps:** `GET /v1/recipes/:id`.
**Expected Outcomes:** `200`; both fields present and `null` (not omitted, not `0`).

### Test Case 3: List endpoint carries cost on each card (AC 3)

**Preconditions:** Two persisted recipes, one priced, one null.
**Steps:** `GET /v1/recipes`.
**Expected Outcomes:** `200`; each item includes both fields with the correct values; pagination
unchanged.

## Test Run

_To be filled during execution. Run: `npm test` (integration), `npm run typecheck`._

## Deployment Strategy

Direct deploy. Additive response fields are backwards-compatible; existing clients ignore unknown fields.
No migration, no flag. Deploy after WI-CS-2 so the fields carry real values (before that they serialize
as null, which is harmless).

## Production Verification

### Production Verification 1: Cost fields present in prod responses

**Preconditions:** WI-CS-1/2/3 deployed; at least one recipe imported after `costStep` shipped.
**Steps:** `GET /v1/recipes/:id` for that recipe and `GET /v1/recipes`.
**Expected Outcomes:** Both fields appear in the detail body and on each list card; a priced recipe shows
a non-null `cost_per_serving_cents` and `cost_coverage`.

## Production Verification Run

_To be filled during execution._
