---
tags: [harvest, cost-signal], tdd
summary: "Cost-to-make ranking signal — technical design document"
locked: false
---

# Cost-to-Make Signal — Design

Estimate what it costs to make a recipe, as an **absolute cost-per-serving in USD**, computed
offline at ingest and stored on the recipe. The ranker reads the raw figure and buckets it itself;
this signal ships no score and no bins.

**Market:** United States, USD. National-average retail prices. No regional or store-level pricing in v1.

**The one-paragraph version.** We already match every recipe ingredient to a USDA FNDDS food and
convert it to grams to estimate nutrition (`FoodMatcher` + `QuantityConverter`, run in `nutritionStep`).
Cost is the same path with one more table: seed USDA ERS **Purchase to Plate National Average Prices**
(price per 100 edible grams, keyed to FNDDS `food_code`) into an `fdc_food_price` table keyed to
`fdc_id` — exactly as the allergen catalog seeds `fdc_food_allergen`. For each ingredient:
`grams ÷ 100 × price_per_100g`, summed, aged forward by one CPI factor, divided by servings. No live
dependency, ~330 KB of public-domain data, no new matching machinery.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Use Case Implementations

IDs:
- **F-01** — Compute cost-per-serving at ingest and persist it on the recipe.
- **F-02** — Expose cost-per-serving to the API so the ranker can bucket it.
- **O-01** — Price one ingredient (name + amount + unit → USD).
- **O-02** — Seed the price table offline.

## Compute cost at ingest — Implements F-01

`costStep` runs after `nutritionStep` (which has already proven every ingredient can be matched and
converted). It is **best-effort**, mirroring `dietStep`/`allergenStep`: on any error it logs and
persists nulls, and the import still completes.

~~~mermaid
sequenceDiagram
    participant W as import-workflow (costStep)
    participant CE as CostEstimator
    participant FM as FoodMatcher
    participant QC as QuantityConverter
    participant PR as PriceRepository
    participant DB as recipes row

    W->>CE: estimate(ingredients, servings)
    loop each ingredient
        CE->>FM: match(name)
        FM-->>CE: {fdcId, category, quality} | null
        CE->>QC: toGrams(amount, unit, match)
        QC-->>CE: {grams, quality} | null
        CE->>PR: pricePer100g(fdcId)
        PR-->>CE: price (text USD) | null
        note over CE: usd = grams/100 × price × CPI_FACTOR<br/>track priced grams vs total grams
    end
    CE-->>W: {centsPerServing, coverage} | null
    note over W: coverage = pricedGrams / convertibleGrams
    W->>DB: cost_per_serving_cents, cost_coverage
~~~

**Aggregation (O-02 math), per recipe:**
- `totalUsd = Σ (grams_i / 100 × price_i × CPI_FACTOR)` over ingredients that matched **and** had a price.
- `centsPerServing = round(totalUsd / servings × 100)`. `servings` is always ≥1 (ingest defaults to 4,
  flagged `servingsEstimated`).
- `coverage = pricedGrams / convertibleGrams` — the fraction of gram-weight we actually priced. This is
  the honesty signal; it replaces a fake "confidence score."
- If `convertibleGrams == 0` (nothing matched/converted), return `null` → columns stay null.

## Expose cost — Implements F-02

`toPublicRecipe` adds `cost_per_serving_cents` and `cost_coverage` to both the list and detail
responses, exactly as `difficulty_band` is surfaced today. No UI is in scope; the ranker (and any later
cost badge) reads these fields and decides its own buckets and coverage threshold.

---

# Entities

~~~mermaid
classDiagram
    class Recipe {
        +int servings
        +bool servingsEstimated
        +int costPerServingCents
        +number costCoverage
    }
    class Ingredient {
        +string name
        +string amount
        +string unit
    }
    class FdcFood {
        +int fdcId
        +string foodCode
        +string category
    }
    class FdcFoodPrice {
        +int fdcId
        +string foodCode
        +number pricePer100g
        +string method
        +string sourceCycle
    }
    Recipe "1" --> "*" Ingredient : has
    Ingredient ..> FdcFood : matched at ingest (not stored)
    FdcFood "1" --> "0..1" FdcFoodPrice : priced by
~~~

The ingredient→food match stays ephemeral (as it already is for nutrition) — we store the aggregate on
the recipe, not a per-ingredient price row. Per-ingredient cost is recomputable from stored inputs; a
breakdown table is out of scope until a use case needs it.

---

# Tables

## fdc_food_price (new)

Mirrors `fdc_food_allergen`: one row per priced FNDDS food, keyed to `fdc_id`, derived offline from the
already-seeded `fdc_foods`. Store the **raw** PP-NAP fields at lowest granularity so later work
(re-inflation, per-region factors, a newer cycle) rebuilds without re-sourcing.

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| fdc_id | integer | pk, fk → fdc_foods.fdc_id | Runtime lookup key |
| food_code | text | not null | 8-digit FNDDS/WWEIA code; PP-NAP join key |
| price_per_100g | text | not null | Raw PP-NAP `price_100gm`, USD, 2017–18 dollars (numeric-as-text, matching `fdc_food_nutrient.amount_per_100g`) |
| method | text | | PP-NAP derivation (`direct` / `alternative` / `fndds recipe`) — provenance |
| source_cycle | text | not null | e.g. `2017-2018` |

No `price_per_100g_cents` column: CPI aging and cents rounding happen at read time in `CostEstimator`
(one constant, easy to re-tune without a re-seed).

## recipes (changes)

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| cost_per_serving_cents | integer | nullable | Absolute USD cents per serving. Null when unpriceable |
| cost_coverage | text | nullable | Fraction 0–1 of gram-weight priced (numeric-as-text) |

Both nullable and best-effort, exactly like `difficulty_score` / `allergens`. No `cost_band` column —
the ranker bins the raw cents itself.

## Indices

None required for v1. The ranker reads cost off already-fetched recipe rows; there is no "recipes under
$X" query yet. Add an index on `cost_per_serving_cents` only when such a query appears (YAGNI — matches
how difficulty indexed only `difficulty_band`, the field actually filtered on).

---

# Modules

~~~mermaid
classDiagram
    class CostEstimator {
        +estimate(ingredients, servings) RecipeCost?
    }
    class PriceRepository {
        +pricePer100g(fdcId) string?
    }
    class FoodMatcher {
        +match(name) FoodMatch?
    }
    class QuantityConverter {
        +toGrams(amount, unit, match) GramQuantity?
    }
    CostEstimator --> FoodMatcher : reuse
    CostEstimator --> QuantityConverter : reuse
    CostEstimator --> PriceRepository : new
~~~

`CostEstimator` is a near-copy of `NutritionEstimator` (loop, match, toGrams) with the nutrient lookup
swapped for `PriceRepository.pricePer100g`. `PriceRepository` is a one-method repo over `fdc_food_price`
(`static create(db)`, matching the repo convention). `FoodMatcher` and `QuantityConverter` are reused
unchanged.

> Optimization deferred: `nutritionStep` already computes `(fdcId, grams)` per ingredient. Threading
> that into `costStep` would avoid re-matching, but re-matching is a local FTS query — cheap. Keep the
> steps independent and testable until profiling says otherwise.

`RecipeCost = { centsPerServing: number; coverage: number }`.

---

# APIs

## Get recipe `GET /v1/recipes/:id` (change)

Adds two fields to the existing recipe body:

- `cost_per_serving_cents`: int | null
- `cost_coverage`: number | null  (0–1)

## List recipes `GET /v1/recipes` (change)

Each card gains the same two fields. No request or pagination change.

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| F-01 compute at ingest | Flow | | x | |
| F-02 expose to API | Flow | | x | |
| O-01 price one ingredient | Op | x | | |
| O-02 seed price table | Op | x | | |

## Test Approach

**Unit (`CostEstimator`, offline).** Extend the `fdc-foods` fixture with a handful of prices (flour,
chicken, olive oil, an unpriced food). Assert: a known recipe hits an expected cents-per-serving;
coverage < 1 when one ingredient is unpriced; `null` when nothing prices; oil goes through the
volume→gram density path; CPI factor is applied. Use `migratedFileDb()` — no network, per the server
testing convention.

**Unit (seed, O-02).** Feed a 3-row PP-NAP fixture and a 3-food FNDDS fixture to the seed's pure
mapping; assert the `food_code → fdc_id` join and idempotent insert. Don't test libSQL's
`onConflictDoNothing` — that's a third-party guarantee.

**Integration (F-01/F-02).** Run the import workflow against a fixture recipe on `migratedFileDb()` with
the price fixture seeded; assert the persisted `cost_per_serving_cents` / `cost_coverage` and that they
appear in the `GET /v1/recipes/:id` body. Assert a price-lookup throw leaves cost null and the import
still succeeds (best-effort).

## Test Infrastructure

Add prices to the existing `fdc-foods.fixture.ts` and a small `pp-nap.fixture.ts`. No new harness.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Add `fdc_food_price`; add `cost_per_serving_cents`, `cost_coverage` to `recipes` | yes (additive, nullable) |
| 2 | data | Run `build-ingredient-prices.ts` once against Turso (after `build-fdc-catalog.ts`) | yes (idempotent) |

Additive and nullable, so old code runs against the new schema and vice versa. New columns stay null
until `costStep` ships and recipes are re-imported; a one-off backfill script can populate existing
recipes (same estimator, no re-fetch — reads stored ingredients).

## Deploy Sequence

Migration → seed script → deploy `costStep`. Seeding before the code means the first import already
prices. Order matches nutrition/allergen precedent.

## Rollback Plan

Ship `costStep` behind the same best-effort try/catch every enrichment step uses — a bad estimator
persists nulls, never fails an import. To disable, no-op `costStep`. Columns and the price table are
inert additive data; leave them. No data rollback needed.

---

# Monitoring

## Metrics

Follow the existing pattern: one structured log line per recipe from `costStep`, not new infra.

| Name | Type | Use Case | Description |
|---|---|---|---|
| cost log line | log | F-01 | `cost=<cents> coverage=<frac> outcome=ok\|error` per recipe |

`coverage` is the field to watch: a sustained low median means the price table or matching is missing
common foods. No alert/dashboard in v1 — read it from logs like difficulty and diet.

---

# Decisions

## Where ingredient prices come from: seeded offline PP-NAP table

**Framework:** Direct criterion — Harvest's stated offline-first precedent (the nutrition seed) plus
simplicity. Each alternative is scored against: offline-first fit, simplicity, accuracy, maintenance,
freshness.

**Choice: seed USDA ERS Purchase to Plate National Average Prices (PP-NAP) offline.** It is the only
dataset that is US national-average, **priced per 100 edible grams**, and **keyed to the same FNDDS
food-id family the app already seeds** — so it reuses the existing match+convert path with zero new
matching machinery. ~330 KB CSV, public domain, no caching/redistribution restriction. It wins on
offline-first fit (identical to nutrition), simplicity (one table + one estimator), and maintenance
(re-run a script). Its ceilings are known and cheap to hold: data is 2017–18 (one CPI factor ages it
forward — the price *ratios* between foods, which is what a signal needs, are stable), and it prices
~3,200 as-consumed foods rather than brand SKUs (a feature for a "national average" signal).

### Alternatives Considered
- **Live grocery/pricing API at ingest (Kroger Products / Spoonacular price breakdown):** Rejected.
  Adds a network dependency to ingest against the offline-seed precedent, and both **forbid persistent
  caching** (Spoonacular ≤1h; Kroger ToS) — so they can't even back a cached signal, only on-demand
  refresh. Kroger is per-store (needs a location); Spoonacular is a paid quota. Higher accuracy on
  paper, but the mapping step is the error source, not the price source (see below), so the gain is
  small and the cost is a permanent live dependency.
- **Hybrid (seed + live refresh):** Rejected for v1 as premature. It only pays off once we want
  localized/current prices, which is explicitly out of scope. The seed table is the substrate a hybrid
  would build on later — this design doesn't foreclose it.
- **LLM price estimation:** Rejected. Non-deterministic, unauditable dollar figures, a per-recipe token
  cost, and no ground truth — strictly worse than a public government price table for a numeric signal.

The literature is unanimous that ingredient **parsing** is solved (F1 ~0.95–0.98) and the accuracy
bottleneck is **mapping a free-text ingredient to a priced item** (F1 ~0.35 when mapping to live retail
SKUs). Mapping to ~3,200 generic as-consumed foods is a far coarser, easier target than SKU matching,
and we already do exactly this mapping for nutrition — so the hard part is already built and tuned.

### Documentation
- PP-NAP data + downloads: https://www.ers.usda.gov/data-products/purchase-to-plate
- Methodology (TB-1955): https://ers.usda.gov/sites/default/files/_laserfiche/publications/99295/TB-1955.pdf
- CSV: https://ers.usda.gov/webdocs/DataFiles/105537/pp_national_average_prices_csv.zip

## Store an absolute value, not a score or band

The ranker owns bucketing (it doesn't exist yet, and diet/difficulty both hand it raw values). We store
`cost_per_serving_cents` (absolute USD) and `cost_coverage` (trust signal). No `cost_band`, no 0–100
normalization — that would bake a policy the ranker should own.

## Age prices with one CPI factor at read time

PP-NAP is 2017–18. `CostEstimator` multiplies by a single `CPI_FACTOR` constant (BLS CPI-U food-at-home,
current ÷ 2017–18 average; ≈1.3 today — set and cite the exact BLS ratio at build).
`// ponytail: single national CPI factor; per-region or newer-cycle re-seed if accuracy demands.`
Read-time (not seed-time) so re-tuning is a one-line change, no re-seed.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Does the FNDDS Survey JSON (`FoodData_Central_survey_food_json`) carry `foodCode` per food? The current `build-fdc-catalog.ts` reads only `fdcId`. The price seed needs `foodCode` to join PP-NAP → `fdc_id`. | open | If present: read `food.foodCode` in the seed and join. If absent: use the FNDDS "At A Glance" ingredient files or the FDC API to map `fdc_id ↔ food_code`. Verify against the real 66 MB JSON before building. |
| Q-02 | Exact `CPI_FACTOR` value: pull the current BLS CPI-U food-at-home (series CUUR0000SAF11) ÷ 2017–18 average at build time. | open | Compute and hardcode with a citation comment. |
| Q-03 | Do any PP-NAP `price_100gm` values round to sub-cent per gram in a way that matters for cheap staples? Storing as text preserves precision; confirm cents rounding only happens once, at the per-serving total. | open | Keep raw text; round only `centsPerServing`. Spot-check flour/salt in the fixture test. |

---

# Accuracy, confidence, and scope

**Expected accuracy.** Good enough to **bucket** a recipe (cheap / moderate / splurge), not to quote an
exact grocery receipt. PP-NAP's price tool covered 97% of foods by grams eaten in WWEIA/NHANES, and
prices as-consumed weight — which aligns with how we already resolve ingredients to as-consumed FNDDS
grams for nutrition. The dominant error is the ingredient→food match (the same match nutrition already
lives with) and volume→gram density; both are visible through `cost_coverage`. Treat per-serving dollars
as ±30–40%, reliable at the bucket level.

**Confidence signal.** `cost_coverage` (fraction of gram-weight priced) travels with every estimate. A
ranker should ignore cost when coverage is low (e.g. < 0.7) rather than trust a figure built from a
third of the recipe.

**Main failure modes.**
- *Unmatched or unpriced ingredient* → excluded, coverage drops. Honest, visible.
- *Wrong volume→gram density* (uses one per-category density) → a "1 cup" of a mis-categorized food is
  mispriced. Same limitation nutrition already accepts.
- *As-purchased vs as-consumed weight* → PP-NAP prices edible/cooked weight; a raw purchased quantity
  with heavy refuse ("1 whole chicken", "2 lb bone-in") underprices the refuse. Ceiling: no
  purchase-weight conversion (the PPC factors are restricted). Upgrade path: license the PPC crosswalk.
- *Unknown servings* → ingest defaults to 4 (`servingsEstimated`), so per-serving is off by the true/4
  ratio for those recipes. Inherited, not introduced.
- *Stale prices* → national 2017–18 + CPI; misses regional and current spikes. Upgrade path below.

**Out of scope for v1 (with ceilings and upgrade paths):**
- **Regional / store-level prices.** Ceiling: national average only. Upgrade: Kroger Products API or an
  F-MAP area factor layered on the same table.
- **Current/live prices.** Ceiling: 2017–18 + one CPI factor. Upgrade: re-seed the next PP-NAP cycle
  (2021–23, expected no earlier than spring 2027), or a hybrid live refresh.
- **As-purchased / package pricing and waste.** Ceiling: edible-weight only. Upgrade: PPC conversion
  factors (restricted-access).
- **Brand/SKU-level pricing** and shopping-list totals. Out entirely — this is a national-average
  cooking-cost signal, not a grocery cart.
- **Non-USD / other regions**, and any **cost UI** (badge, filter). This story delivers the signal and
  its API fields; rendering and ranker weighting are separate stories.
- **Per-ingredient cost breakdown table.** Recomputable from stored inputs; add only when a use case
  needs it.

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-18 | Cost-Signal Lead | Initial draft |
