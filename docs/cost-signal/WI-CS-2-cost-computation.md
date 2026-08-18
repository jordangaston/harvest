# WI-CS-2 — Cost computation: `CostEstimator` + `costStep`

## Background

With the price table seeded (WI-CS-1), computing a recipe's cost-per-serving reuses the exact path the
nutrition estimator already walks. `NutritionEstimator.run()` (`src/nutrition/nutrition-estimator.ts`)
loops the ingredients, calls `FoodMatcher.match(name)` → `{ fdcId, category, quality } | null`, then
`QuantityConverter.toGrams(amount, unit, match)` → `{ grams, quality } | null`. Cost swaps the nutrient
lookup for a price lookup: `grams / 100 × price_per_100g × CPI_FACTOR`, summed over priced ingredients,
divided by servings.

`costStep` slots into the import workflow after `nutritionStep`
(`src/workflows/import-workflow.ts`), as a **best-effort** step exactly like `dietStep` / `allergenStep`:
wrapped in try/catch, persists nulls on failure, never fails the import. `servings` is always ≥1 at this
point (ingest defaults to 4, flagged `servingsEstimated`). The output is an absolute value —
`cost_per_serving_cents` — plus `cost_coverage`; the ranker does its own bucketing (no band, no score).

See `docs/cost-signal/DESIGN.md` §2–3 for the full flow and math.

## Objective

Add `PriceRepository` (one-method repo over `fdc_food_price`) and `CostEstimator` (mirrors
`NutritionEstimator`), wire a best-effort `costStep` into the import workflow that persists
`cost_per_serving_cents` and `cost_coverage` to the recipe row. Define the `CPI_FACTOR` constant
(resolves Q-02).

## Acceptance Criteria

1. **`PriceRepository`.** Given a seeded `fdc_food_price`, when `pricePer100g(fdcId)` is called, then it
   returns the raw `price_per_100g` string, or `null` if the food has no price row. Follows the repo
   convention (`static create(db)`).
2. **Per-ingredient cost.** Given an ingredient that matches a food with price P (USD/100g) and converts
   to G grams, then its cost is `G / 100 × P × CPI_FACTOR` USD. An ingredient that fails to match, fails
   to convert (`toGrams` → null), or has no price row contributes **no cost and no priced grams**.
3. **Aggregate to per-serving.** `centsPerServing = round( totalUsd / servings × 100 )`, where
   `totalUsd` sums only priced ingredients. Given nothing prices (`convertibleGrams == 0`),
   `estimate()` returns `null`.
4. **Coverage.** `cost_coverage = pricedGrams / convertibleGrams`, a value in `(0, 1]`, stored as
   numeric-text. "Convertible grams" counts ingredients that matched **and** converted (whether or not a
   price was found), so coverage measures the priced fraction of what we could weigh.
5. **CPI factor (resolves Q-02).** A single `CPI_FACTOR` constant ages 2017–18 prices to present USD,
   applied at read time in `CostEstimator`. Value = BLS CPI-U food-at-home (series CUUR0000SAF11) current
   ÷ 2017–18 average, hardcoded with a citation comment and a
   `// ponytail: single national CPI factor; per-region or newer-cycle re-seed if accuracy demands.`
6. **Best-effort step.** Given `costStep` throws (e.g. price lookup error), then the recipe persists with
   `cost_per_serving_cents = null`, `cost_coverage = null`, one `outcome=error` log line, and the import
   still completes. On success it logs `cost=<cents> coverage=<frac> outcome=ok`.
7. **Persistence.** `costStep` writes the two `recipes` columns; a re-import overwrites them. No
   per-ingredient price rows are stored.

## Test Cases

### Test Case 1: Known recipe → expected cents-per-serving (AC 2, 3, 5)

**Preconditions:** `migratedFileDb()` with the WI-CS-1 price fixture (flour, chicken, olive oil priced).
A fixture recipe: "2 cups flour, 1 lb chicken, 2 tbsp olive oil", servings 4.
**Steps:** Call `CostEstimator.estimate(ingredients, 4)`.
**Expected Outcomes:** Returns a `centsPerServing` within a tolerance band of the hand-computed value
(grams via `QuantityConverter`, × price, × `CPI_FACTOR`, ÷ 4, ×100, rounded); `coverage == 1`.

### Test Case 2: One unpriced ingredient lowers coverage (AC 2, 4)

**Preconditions:** As Test Case 1, plus one ingredient matching the deliberately unpriced fixture food.
**Steps:** `estimate()`.
**Expected Outcomes:** `centsPerServing` reflects only the priced ingredients; `0 < coverage < 1`; the
unpriced ingredient's grams are excluded from the numerator but counted in `convertibleGrams`.

### Test Case 3: Nothing prices → null (AC 3)

**Preconditions:** A recipe whose ingredients match no priced food.
**Steps:** `estimate()`.
**Expected Outcomes:** Returns `null`; `costStep` persists both columns as null.

### Test Case 4: Oil goes through the volume→gram density path (AC 2)

**Preconditions:** "2 tbsp olive oil" (category *Fats and oils*, density 0.92 in `QuantityConverter`).
**Steps:** `estimate()`.
**Expected Outcomes:** Grams reflect the 0.92 density (not water); cost uses those grams. Confirms cost
reuses `QuantityConverter` unchanged.

### Test Case 5: Best-effort — a thrown lookup leaves cost null, import succeeds (AC 6)

**Preconditions:** Import workflow on `migratedFileDb()`; stub `PriceRepository.pricePer100g` to throw.
**Steps:** Run the import for a fixture recipe.
**Expected Outcomes:** Recipe persists; `cost_per_serving_cents`/`cost_coverage` null; one `outcome=error`
log line; import status is `ready`, not `failed`.

## Test Run

_To be filled during execution. Run: `npm test`, `npm run typecheck`._

## Deployment Strategy

Direct deploy behind the existing best-effort try/catch — a bad estimator persists nulls, never fails an
import. Deploy after WI-CS-1's migration + seed are live (so prices exist). To disable, no-op `costStep`.
New recipes price on import; existing recipes stay null until a backfill (WI-CS-2 optional follow-up: a
one-off script that re-runs `CostEstimator` over stored ingredients — no re-fetch, no LLM).

## Production Verification

### Production Verification 1: New import produces a plausible cost

**Preconditions:** WI-CS-1 seeded in prod; `costStep` deployed.
**Steps:** Import a known recipe (e.g. a simple pasta). Read the recipe row.
**Expected Outcomes:** `cost_per_serving_cents` is a plausible dollar-ish value (e.g. 50–800¢);
`cost_coverage` near 1 for a common-ingredient recipe; the `cost=… coverage=… outcome=ok` log line
appears.

### Production Verification 2: Coverage is healthy in aggregate

**Preconditions:** After a batch of imports.
**Steps:** Grep `costStep` logs for the median `coverage`.
**Expected Outcomes:** Median coverage is high (indicates the price table covers common foods). A
sustained low median flags missing prices or matching gaps.

## Production Verification Run

_To be filled during execution._
