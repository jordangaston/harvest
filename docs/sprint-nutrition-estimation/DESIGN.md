---
tags: [project], tdd
summary: "Nutrition estimation for imported recipes — technical design document"
locked: false
---

# Nutrition Estimation

Many imported recipes arrive with no nutrition data. This feature estimates the eight label-core
macros for those recipes from their ingredient lines (matched against USDA's FNDDS food dataset,
seeded offline), and computes a single **NRF nutrient-density score** for every recipe. It is
**best-effort**: confidence signals are computed to decide what to trust and kept server-side;
ingredients we cannot match or convert are excluded, never guessed. The user sees only that a value
was estimated.

The design is deliberately small, with one deliberate exception: we **store the full FNDDS nutrient
panel** (65 nutrients per food), not just the eight we score on, so future features build on seeded
data with no re-seed — reference data kept at the lowest granularity. Everything *else* is minimal:
**a two-table catalog + seed script, one workflow step, an estimator, a pure NRF function, and one
recipe field** (`nrf_score`). No new nutrition type — "estimated" is a boolean on the existing
`Nutrition` model — and we store the raw score; bucketing it to a tier and generating a
plain-language "why" are deferred. The importer already parses ingredient lines into `(amount, unit, name)`;
the `recipes` table already holds the eight macro columns and a `nutrition_source` enum whose unused
`'computed'` value *is* the estimated flag. Nothing calls the network. If the reader finishes
thinking "that's it?", the design succeeded.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Use Case Implementations

The feature has one backend Flow (estimate during import) and one client Flow (display). Two
Operations — match and convert — carry the interesting internals.

## Estimate Nutrition During Import — Implements F-01

A single new step sits between recipe resolution and persistence. For **every** recipe it matches
each ingredient to an FDC food (yielding gram weights, food categories, and the produce fraction) and
computes the health score. It **additionally estimates the macros only when the recipe has no
authoritative (parsed) nutrition** — a recipe whose page published `schema.org/NutritionInformation`
keeps its authoritative macros and is still matched-and-scored. The step makes no network call; it
reads the seeded FDC catalog from the local database.

~~~mermaid
sequenceDiagram
    participant WF as importWorkflow
    participant EST as nutritionStep
    participant NE as NutritionEstimator
    participant FM as FoodMatcher
    participant QC as QuantityConverter
    participant FR as FdcFoodRepository
    participant PS as persistStep

    WF->>WF: resolveRecipes(material) → recipes[]
    WF->>EST: nutritionStep(recipes)

    rect rgb(240, 248, 255)
    note over EST,NE: For EVERY recipe
    EST->>NE: run(ingredients, servings, parsedNutrition?)
    loop each ingredient
        NE->>FM: match(name)
        FM->>FR: search(tokens)  [FTS5, ORDER BY bm25()]
        FR-->>FM: ranked candidates
        FM-->>NE: FoodMatch{ fdcId, category, quality } | null
        NE->>QC: toGrams(amount, unit, match)
        QC-->>NE: grams | null (unconvertible)
    end
    alt no parsed nutrition
        note over NE: aggregate macros × grams/100, ÷ servings<br/>(confidence decides withhold / omit, internal)
    else parsed nutrition present
        note over NE: keep authoritative macros
    end
    note over NE: nrfScore(nutrient panel %DV, calories) → number
    NE-->>EST: { nutrition{ values, estimated }, nrfScore }
    end

    EST-->>WF: recipes[] enriched
    WF->>PS: persistStep(recipes)
    note over PS: one transaction: recipe (macros + nutrition_source +<br/>nrf_score) + ingredients + steps
~~~

**Extensions**

- *Recipe already has parsed nutrition* → macros are kept as-is, but the recipe is still matched and
  scored so it gets an `nrf_score`.
- *No ingredient matches* → no score and, if nutrition was also absent, no estimate — the recipe
  persists without a verdict rather than a fabricated one. See
  [Decision: Withhold rather than guess](#withhold-an-estimate-rather-than-guess).
- *Some ingredients unmatched* → excluded from the totals, never guessed; the estimate and score
  still persist, and the lower coverage is emitted to metrics (not stored).

## Match an Ingredient to an FDC Food — Implements O-01

Deterministic: normalize the food name, then look it up against the seeded FNDDS catalog's
normalized descriptions. One source, so one lookup. No embeddings, no LLM, no network.

~~~mermaid
sequenceDiagram
    participant FM as FoodMatcher
    participant NM as normalize()
    participant FR as FdcFoodRepository

    FM->>NM: normalize("all-purpose flour, sifted")
    note over NM: lowercase · drop parenthetical · strip prep/descriptor<br/>words (sifted, chopped, fresh…) · singularize · tokenize
    NM-->>FM: tokens ["flour","all","purpose"]
    FM->>FR: search(tokens)  [FTS5 MATCH, ORDER BY bm25()]
    FR-->>FM: candidates ranked by bm25()
    FM-->>FM: high if ≥ accept · low if ≥ flag · else unmatched (reject)
~~~

## Convert an Ingredient Quantity to Grams — Implements O-02

The catalog stores nutrients per 100 g, so every ingredient must reach a gram weight. Conversion
is tiered by how certain it is, and the tier sets the conversion's contribution to confidence.

~~~mermaid
sequenceDiagram
    participant QC as QuantityConverter
    participant GT as gram table

    QC->>QC: classify(unit)
    alt mass unit (g, kg, oz, lb)
        QC-->>QC: exact constant × amount  (high)
    else volume unit (tsp, tbsp, cup, ml, l)
        QC->>GT: density(matched food category)
        GT-->>QC: g/ml (default 1.0 = water)
        QC-->>QC: ml × density  (medium)
    else count / no unit (2 eggs, 1 onion, "a pinch")
        QC->>GT: per-item grams(food)
        alt known per-item weight
            GT-->>QC: grams  (low)
        else unknown
            GT-->>QC: null → unconvertible (flag, exclude)
        end
    end
~~~

## Display Estimated vs Authoritative Nutrition — Implements F-02

The client does no per-serving math — the server returns per-serving values already. For v1 the
screen simply renders the macros; the health verdict UI (a tier chip and its "why") is **deferred**
with the tier and reasons, so nothing user-facing consumes `nrf_score` yet. Macros render identically
whether authoritative or estimated; the only tell that a value was estimated is a small, unobtrusive
**ⓘ icon** — no prominent "estimated" badge, no confidence numbers, those live server-side.

~~~mermaid
sequenceDiagram
    participant App as Recipe screen
    participant API as GET /v1/recipes/:id

    App->>API: fetch recipe
    API-->>App: recipe + nutrition{ estimated, values }

    App->>App: render macros plainly (per-serving, as received)
    opt nutrition.estimated = true
        App->>App: show small ⓘ icon by the Nutrition heading
        note over App: tap ⓘ → tooltip: "Estimated from this recipe's<br/>ingredients — approximate."<br/>(mentions serving size if servings_estimated)
    end
~~~

The ⓘ is deliberately quiet — a `bg-cream` tooltip on a dim scrim (AGENTS.md), Reduce-Motion honored
on open. The tier/reason UI (a golden-hour chip on `bg-card`, a plain-language phrase, on cards and
detail) lands in the later iteration that buckets `nrf_score` and generates reasons.

---

# Entities

The domain gains two persisted concepts: `FdcFood` (a seeded FNDDS food) and `FdcFoodNutrient` (one
per-100 g value per food per nutrient — the full 65-nutrient panel). There is **one `Nutrition`
model for both authoritative and estimated values** — the eight per-serving macros plus an
`estimated` boolean. Estimated nutrition is not a separate type; it is a `Nutrition` with
`estimated = true`. The health score lives on `Recipe` as a single numeric `nrfScore` (its tier and
reasons are derived later, not stored). `Recipe`, `Ingredient`, and `Nutrition` already exist (with
the additions below); `FdcFood` and `FdcFoodNutrient` are new.

`IngredientMatch` is deliberately **not** modeled here — it is a transient value inside the
estimator (an ingredient's resolution to a food + grams + category + quality), never persisted or
returned, so it earns no place in the domain.

~~~mermaid
classDiagram
    class Recipe {
        +string title
        +int servings
        +bool servingsEstimated
        +Nutrition nutrition
        +float nrfScore
    }
    class Ingredient {
        +string name
        +string amount
        +string unit
    }
    class Nutrition {
        +float calories
        +float protein
        +float fat
        +float saturatedFat
        +float carbohydrate
        +float fiber
        +float sugar
        +float sodium
        +bool estimated
    }
    class FdcFood {
        +int fdcId
        +string description
        +string descriptionNormalized
        +string category
    }
    class FdcFoodNutrient {
        +int fdcId
        +string nutrientNumber
        +float amountPer100g
    }

    Recipe "1" --> "*" Ingredient : has
    Recipe "1" --> "0..1" Nutrition : parsed or estimated
    FdcFood "1" --> "*" FdcFoodNutrient : full panel
    Recipe ..> FdcFood : matched for macros + tier + produce (transient)
~~~

`nrfScore` is the raw NRF number (see [Health Score](#health-score)); a tier is a later bucketing of
it. The eight `Nutrition` macros are eight of the food's `FdcFoodNutrient` rows, read by nutrient
number. The `estimated` boolean persists via the existing `nutrition_source` column (`computed` ⇒
`estimated = true`), so no schema change is needed to carry it.

---

# Tables

The catalog is **one source — FDC's FNDDS (Survey) dataset** — split across two tables: a food row,
and a normalized nutrient row per (food, nutrient). We store the **full 65-nutrient panel**, not just
the eight macros we score on today, so future features (micronutrient display, an NRF upgrade, an
omega-3 term, allergen/diet filters) read already-seeded data with no re-seed. See
[Decision: FNDDS + store granular](#one-complete-source-fndds-stored-at-full-nutrient-granularity).

## fdc_foods (new)

One row per FNDDS food. No nutrient values here — those live in `fdc_food_nutrient`.

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| fdc_id | integer | pk | FDC's own id |
| description | text | not null | e.g. "Fish, salmon, Atlantic, cooked" |
| description_normalized | text | not null | lowercased, prep-words stripped, singularized (match key) |
| category | text | | FNDDS `wweiaFoodCategory` — drives density lookup (and available for future category-based features) |
| portions | text (json) | | `[{description, gramWeight}]` from FNDDS `foodPortions` (household measures live in `portionDescription`) |

## fdc_food_nutrient (new)

The granular store — one row per food per nutrient, the whole panel. ~5,431 foods × 65 nutrients ≈
**350k rows**, trivial for SQLite. The estimator and scorer read the subset they need
(`WHERE nutrient_number IN (…)`); everything else sits ready for later.

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| fdc_id | integer | not null, fk → fdc_foods | |
| nutrient_number | text | not null | FDC nutrient number (e.g. `203` protein, `328` vitamin D, `621` DHA) |
| amount_per_100g | text | not null | value per 100 g (`pg numeric → text`) |

Primary key `(fdc_id, nutrient_number)`; index on `(fdc_id)` for the per-food read. The eight
label-core macros are just eight of these nutrient numbers; the health score reads a dozen or so.

The `amount_per_100g` values are stored granularly; the **meaning** of each number is not. Two
mappings live **in code, not DB tables**:

- **nutrient number → name + unit** — a small static enum (extends `label-core.ts`), e.g.
  `FDC_NUTRIENT = { PROTEIN: '203', VITAMIN_D: '328', DHA: '621', … }`. Only ~a dozen numbers matter
  to the code; the seed uses them to read values, and any future display picks up names there. A
  ~150-row reference table would be over-built for a static list.
- **food category → health-score credit** — a code/config map (`{ 'Fish': +credit, 'Dark-green
  vegetables': +credit, … }`), the dietician-tunable table from [Health Score](#health-score). The
  `fdc_foods.category` **string** is stored (FNDDS gives category descriptions directly, so no
  number→name lookup is needed); only the string → points mapping is code.

### Indices

| Name | Columns | Unique | Notes |
|---|---|---|---|
| fdc_foods_norm_idx | (description_normalized) | no | normalized-name lookup |
| fdc_food_nutrient_pk | (fdc_id, nutrient_number) | yes | one value per food/nutrient; also the per-food read path |

Matching uses a SQLite **FTS5** virtual table over `description_normalized`, mirroring `fdc_foods`
(`content='fdc_foods'`), queried with `MATCH … ORDER BY bm25()` for a ranked score. FTS5 configures
**one tokenizer per table**, so Porter-stemming and trigram are alternatives, not a stack. Because
`normalize()` already does the stemming work (prep-word stripping, singularization) before text
reaches the index, the table uses the **trigram** tokenizer for the thing we can't do ourselves —
substring and typo tolerance ("mozzarela" → "mozzarella"). If trigram's looser matching costs
precision, the fallback is `unicode61` on our already-normalized text. FTS5 and both tokenizers ship
in libSQL; no extension to install. See
[Decision: Deterministic matching](#deterministic-normalization--catalog-lookup-for-ingredient-to-food-matching).

## recipes (changed)

The eight macro columns, `confidence`, `servings`, `servings_estimated`, and the
`nutrition_source` enum (`parsed | computed`) **already exist** (schema.ts:97–125). We add exactly
one field. Confidence and per-ingredient match quality are **not** stored — transient inputs to the
withhold decision and to metrics.

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| nrf_score | text | | The raw NRF number (`pg numeric → text`). Computed for any recipe with nutrition; null when nutrition (or calories) is absent. See [Health Score](#health-score). |

Storing the **raw score**, not a derived tier, is deliberate (store-granular): the tier is a later
bucketing and the reasons a later derivation, both recomputable from `nrf_score` + the stored panel
without re-scoring. Both `parsed` and `computed` recipes carry it identically.

---

# Modules

`NutritionEstimator` orchestrates the per-recipe work — match every ingredient, convert to grams,
estimate macros when unparsed, then score. `FoodMatcher` and `QuantityConverter` are its
collaborators; `FdcFoodRepository` reads the seeded catalog. `nrfScore()` is a pure function over the
matched food's nutrient panel + calories, used by both estimated and parsed recipes. The classes
follow the repo's class-with-`static create()` convention (server/CLAUDE.md).

~~~mermaid
classDiagram
    class NutritionEstimator {
        +run(ingredients, servings, parsed?) RecipeNutrition
    }
    class FoodMatcher {
        +match(name) FoodMatch | null
    }
    class QuantityConverter {
        +toGrams(amount, unit, match) number | null
    }
    class FdcFoodRepository {
        <<interface>>
        +search(tokens) FdcFood[]
        +nutrients(fdcId) Map~number,number~
    }
    class nrfScore {
        <<pure function>>
        +nrfScore(nutrientsPer100g, calories) number
    }

    NutritionEstimator --> FoodMatcher : uses
    NutritionEstimator --> QuantityConverter : uses
    NutritionEstimator --> nrfScore : uses
    NutritionEstimator --> FdcFoodRepository : reads nutrient panel
    FoodMatcher --> FdcFoodRepository : queries
    QuantityConverter --> FdcFoodRepository : reads portions/category
~~~

~~~mermaid
flowchart LR
    A[Ingredient name/amount/unit] -->|name| B[FoodMatcher]
    B -->|FoodMatch + fdcId| C[QuantityConverter]
    A -->|amount, unit| C
    C -->|grams| D[NutritionEstimator]
    D -->|nutrient panel %DV + calories| G[nrfScore]
    G -->|number| D
    D -->|"nutrition{ values, estimated } + nrf_score"| F[persistStep]
~~~

`normalize()` is a pure function shared by the seed script and `FoodMatcher`, so a recipe name and
a catalog description normalize identically — the single chokepoint that keeps match keys consistent
(harvest-principles: "fix at the single chokepoint"). `nrfScore()` is likewise the one place a recipe
becomes a score, so parsed and estimated nutrition score by the identical rule.

---

# APIs

No new endpoints. The existing recipe reads (`GET /v1/recipes`, `GET /v1/recipes/:id`) already
serialize `nutrition` via `toPublicNutrition` (models/recipe.ts:153). Two additive changes: replace
the nutrition `source` field with a plain `estimated` boolean, and add `nrf_score`. **Confidence is
never serialized** — it stays server-side.

## Get Recipe `GET /v1/recipes/:id`

Returns a recipe with its ingredients, steps, and nutrition. `nutrition` is present only when known.

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - recipe: object
        - … existing fields …
        - servings: int
        - servings_estimated: bool — the serving count itself was guessed
        - nrf_score: number — the raw NRF nutrient-density score; omitted when nutrition (or calories) is absent. Not rendered in v1; present for the deferred tier UI
        - nutrition: object
            - estimated: bool — `true` when computed from ingredients, `false` when parsed from the source
            - calories, grams_of_fat, grams_of_saturated_fat, grams_of_carbohydrate, grams_of_fiber, grams_of_sugar, grams_of_protein, milligrams_of_sodium: string — per serving; a macro is omitted when no matched food reported it

The macro payload is identical for authoritative and estimated nutrition; only `estimated` differs,
and the client shows the ⓘ icon when it is `true`. `nrf_score` is also returned on the list/card
endpoint so the later tier UI can render cards without fetching detail. Confidence is never
serialized.

---

# Health Score

Every recipe with nutrition gets a single numeric **NRF score** — a nutrient-density value computed
from its components. We **store the raw number** (`nrf_score`); bucketing it into a tier and
generating a plain-language "why" are deferred to a later iteration (both are recomputable from the
stored panel at any time). Storing the granular score, not a lossy label, is the point.

## Why NRF (and why now)

NRF (Nutrient-Rich Foods index) scores a food as **nutrients to encourage minus nutrients to limit,
each expressed as a percent of its Daily Value, per 100 kcal**. We rejected it earlier for one
reason: it needs micronutrients we didn't have. That objection is gone — we now **store the full
FNDDS panel** (99% coverage). With the data in hand, NRF is the better engine: it credits **fish by
its actual omega-3 and vitamin D** (100% covered for fish) rather than the category-credit proxy we
had invented, and it is a validated nutrient-density model. The one cost — its components ("high in
magnesium") are less self-explanatory — is deferred with the reasons.

## The calculator

`nrfScore(nutrientsPer100g, calories)` is one pure function reading the stored nutrient panel:

```
nrf = Σ_encourage min(100, nutrientᵢ / DVᵢ × 100)  −  Σ_limit (nutrientⱼ / MRVⱼ × 100)     per 100 kcal
```

- **Encourage** and **limit** nutrient sets, and their `DV` / `MRV` reference values, are a **code
  config table** (extends the `FDC_NUTRIENT` enum). The limiters are the standard three (saturated
  fat, added→total sugar, sodium).
- The **nutrient set is the one open decision** (Q-04): NRF9.3 omits omega-3/vitamin D, so to credit
  fish we use an extended set (NRF11.3 + omega-3, say) — which the full panel now supports. Dietician
  signs off the set and the DV table.
- Per 100 kcal makes it portion-independent; `calories > 0` required, else no score.

The result is a single number stored as `nrf_score`. No produce fraction, no category credit — NRF
scores real nutrients, so both Nutri-Score artifacts are gone.

## Deferred: tier + reasons

Kept out of v1 deliberately:

- **Tier** (`indulgent / healthish / healthy`) is a later bucketing of `nrf_score`, its cutoffs
  calibrated on a labeled recipe set (Q-04). Storing the raw score means we can re-bucket without
  re-scoring.
- **Reasons** (a plain-language "why") are generated later from the stored components. They are
  harder under NRF than Nutri-Score, which is another reason to defer rather than ship a weak version.

## Missing data, and the honest ceiling

A null nutrient contributes nothing to its NRF term — we never invent a value. FNDDS's 99% coverage
makes that rare. The remaining ceiling: an estimated recipe with sparse ingredient matches scores
less reliably (the ⓘ affordance flags it; the e2e test surfaces low-coverage recipes), and NRF still
uses total sugar as the added-sugar proxy (slightly over-penalizing whole fruit and plain dairy).
Directional-by-design, accepted for a best-effort score (Q-04).

## Where it runs

Matching → `nrfScore()` runs inside the import workflow; `nrf_score` is written in the same
`persistStep` transaction as the macros. It is a pure function of already-computed values — no
network, no step of its own. Existing recipes imported before this sprint gain a score only on
re-import; backfill is out of scope (Q-03).

---

# Testing

Estimation is pure, deterministic, and offline, so it is almost entirely unit-testable. No test
touches the network. Unit and integration tests run against a small fixture catalog; the **e2e
matching test runs against the real seeded catalog** to surface real-world gaps.

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| F-01: Estimate during import | Flow | | x | |
| O-01: Match ingredient to food | Op | x | | x (real recipes, real seed) |
| O-02: Convert quantity to grams | Op | x | | |
| O-03: NRF score from components | Op | x | | |
| F-02: Display macros + estimated flag | Flow | | | x (existing sim walkthrough) |

## Test Approach

### Unit Tests

- **`normalize()`** — descriptor stripping and singularization: "all-purpose flour, sifted" and
  the catalog's "Flour, wheat, all-purpose…" normalize to overlapping tokens; a keep-case
  ("to taste" is not dropped from a real name). One drop-case + one keep-case per rule
  (harvest-principles: safe transforms).
- **`FoodMatcher.match`** — bm25 quality thresholds (high/medium/low/unmatched) against a fixture
  catalog of a dozen FNDDS foods; a clean hit, a fuzzy/typo hit, and a no-match.
- **`QuantityConverter.toGrams`** — mass exact; volume via density default and category override;
  count via per-item table; unconvertible → null.
- **`NutritionEstimator`** — aggregation math (per-100g × grams, ÷ servings), confidence driving the
  withhold-on-empty case, unmatched exclusion. Also the *skip* case: a recipe with parsed nutrition
  keeps its macros but is still matched and scored.
- **`nrfScore(nutrientsPer100g, calories)`** — %DV terms capped at 100; encourage-minus-limit sum;
  per-100-kcal normalization (and no score when `calories = 0`); a nutrient-dense food (e.g. salmon,
  via its omega-3/vitamin D in the panel) outscores a calorie-dense low-nutrient one.

### Integration Tests

- **`nutritionStep` inside the import pipeline** — extends the existing offline pipeline
  test (test/import-pipeline.test.ts) with a `StubExtractor` recipe that has ingredients but no
  parsed nutrition; assert the persisted recipe has `nutrition_source='computed'`, populated macro
  columns, and an `nrf_score`. A second recipe *with* parsed nutrition asserts macros are untouched
  but the score is still computed. Runs against the migrated `file:` libSQL test DB.

### End-to-End Tests

- **Ingredient→food matching over real recipes (O-01)** — the gap-finder. It reuses the **same
  recipes that power the importer's e2e test**, persisted to a JSON fixture (`test/fixtures/e2e-recipes.json`)
  so the test skips the import step and loads recipes directly. Each recipe's ingredients run through
  the estimator against the **real seeded `fdc_foods` catalog**, and the test reports, per recipe,
  which ingredients matched (and at what quality) and which went unmatched. Its assertion is a
  coverage floor (e.g. "≥ X% of ingredients match across the corpus"), not exact macro values —
  because there is no accuracy SLA, the point is to **surface gaps** (a normalizer miss, a missing
  synonym) against real messy text, not to pin numbers. New recipes added to the importer's e2e set
  flow in by re-exporting the fixture.

Per server/CLAUDE.md we do **not** test that FDC returns valid data or that WDK replays a step —
third-party guarantees.

## Test Infrastructure

- **Fixture catalog** — a ~12-food `fdc_foods` + `fdc_food_nutrient` seed inserted by the test
  helper for unit/integration tests, covering a produce food, a fish food, and a fatty/salty food so
  the tier and reason cases are exercised.
- **Real-seed harness for the e2e matcher** — seeds the full `fdc_foods` from the on-disk exports
  once (reused across the corpus), plus a small exporter that dumps the importer's e2e recipes to
  `e2e-recipes.json`. Both are the only new test infrastructure this feature needs.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Create `fdc_foods` + `fdc_food_nutrient` (+ FTS5 mirror) | yes — additive |
| 2 | schema | Add `recipes.nrf_score` (nullable text) | yes — additive, nullable |
| 3 | data | Seed both catalog tables from the FNDDS (Survey) JSON export — full nutrient panel (offline script) | yes — insert-only |

Migrations are generated with `drizzle-kit generate` then applied with `drizzle-kit migrate`
(never hand-applied DDL). The FTS5 virtual table and its triggers ship as a hand-written SQL
migration alongside the generated ones. All three changes are additive; each generated migration
adds only (no drop+add on one table), so codegen stays non-interactive in CI
(harvest-principles: stage destructive-plus-additive changes).

## Deploy Sequence

Single service. Schema migrations 1–2 deploy before the code that writes `nrf_score`. The seed
(3) is an offline script run once against the target database; it is idempotent (`INSERT … ON
CONFLICT(fdc_id) DO NOTHING`), so a re-run is safe.

## Rollback Plan

The code degrades cleanly without the catalog: if `fdc_foods` is empty, every ingredient is
unmatched and `nutritionStep` withholds the estimate — recipes still import, just without
computed nutrition or a score. To roll back the code, redeploy the prior build; the new catalog
tables and the nullable `nrf_score` column are inert (only the new code reads or writes them) and
can be dropped later. No data migration to reverse — estimation never mutates authoritative
(`parsed`) nutrition, and existing recipes stay untouched (this sprint does not backfill; see Open
Questions).

---

# Monitoring

Estimation runs inside the import workflow, which already logs per-step (`[step] …`). One counter
answers "is F-01 working?"; the rest is existing import observability.

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| nutrition_estimate_outcome | counter | F-01 | Tagged `computed` \| `withheld` \| `skipped_parsed`. Withheld/computed ratio is the feature's health signal. |
| nutrition_ingredient_match | counter | O-01 | Tagged by `quality` (high/medium/low/unmatched). The unmatched rate tells us where the catalog or normalizer needs work. |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| `withheld / (computed+withheld)` over 1h | > 0.5 | warn |

A high withhold rate means matching or conversion regressed (e.g., a bad seed) — worth a look,
not a page. This is best-effort with no accuracy SLA, so nothing pages.

## Logging

`nutritionStep` logs one line per recipe at info: recipe id, matched/total ingredient
count, and outcome. Low cardinality; no per-ingredient logging in the hot path.

---

# Decisions

## Deterministic normalization + catalog lookup for ingredient-to-food matching

**Framework:** Binstack — priorities, in order: (1) underwhelming simplicity / fewest moving
parts, (2) determinism & testability, (3) a usable per-match confidence signal, (4) match quality
on messy names, (5) cost.

| Option | (1) Simplicity | (2) Determinism | (3) Confidence | (4) Quality | (5) Cost |
|---|---|---|---|---|---|
| **Deterministic normalize + FTS5 lookup** | ✅ one pure fn + one query | ✅ fully | ✅ score → bucket | ⚠️ good on a small catalog | ✅ free |
| Embedding / vector similarity | ❌ embed model + vector index + build step | ✅ | ✅ cosine → bucket | ✅ | ⚠️ infra |
| LLM-assisted mapping | ❌ per-ingredient prompt | ❌ non-deterministic | ⚠️ self-reported | ✅ | ❌ network call/ingredient |

**Choice:** Deterministic normalization + SQLite **FTS5** lookup over the single FNDDS catalog. It
is the only option that materially wins the top priority: the catalog is ~5,400 static rows, small
enough that a normalized-token lookup is both sufficient and trivially inspectable. FTS5 ships
inside libSQL — no new dependency — and gives what the design needs in the box: `bm25()` relevance
ranking (the numeric match score, priority 3) and a choice of tokenizer. FTS5 allows one tokenizer
per table, so Porter-stemming and trigram are alternatives; since `normalize()` already stems, the
table uses **trigram** for substring/typo tolerance (`unicode61` the precision fallback).
Determinism (priority 2) falls out for free — the same ingredient
always yields the same match, so the whole pipeline unit-tests without mocks or network. On
priority 4, a small curated catalog of whole foods plays to deterministic matching's strengths and
away from its weakness (huge noisy corpora).

The sprint's deep-research pass recommended this approach after adversarial verification: for
a small static FDC catalog, "deterministic normalization + SQLite FTS5 lookup (with bm25 ranking,
Porter or trigram tokenizer) is the simplest approach that clears the bar, and it is the one
directly supported by evidence." The same research found the LLM-mapping evidence targets a
different problem shape (branded-product label parsing at web scale, needing fine-tuning), with no
measured accuracy benefit at this catalog size — so an LLM stays a fallback for the flagged tail
only, not the primary matcher.

Neither richer option earns its complexity here. Embeddings solve a recall problem a ~5k whole-
foods catalog does not have, and add a model, a vector index, and a build step. An LLM adds a
non-deterministic network call per ingredient — against both the simplicity mandate and the repo's
"no network in tests" rule — to solve a matching problem the normalizer already handles. An LLM
remains a plausible *future* escalation for the unmatched tail, but YAGNI for v1
(server/CLAUDE.md: "don't build infra before something uses it").

### Alternatives Considered
- **Embedding/vector similarity:** over-built for a small static catalog; adds a model + index + build step.
- **LLM-assisted mapping:** non-deterministic, a network call per ingredient, untestable offline; reserve for the unmatched tail later.
- **pg_trgm trigram matching:** unavailable — the DB is SQLite/libSQL, not Postgres (schema.ts:1–13).

### Documentation
- FDC FNDDS (Survey) dataset: https://fdc.nal.usda.gov/download-datasets
- SQLite FTS5: https://www.sqlite.org/fts5.html

## One complete source (FNDDS), stored at full nutrient granularity

**Framework:** Binstack — priorities: (1) complete nutrient coverage (a foundation to build on),
(2) simplicity (one source, no fallback), (3) fits the recipe-ingredient use case, (4) validated.

**Choice:** Seed **FDC's FNDDS (Survey) dataset** as the single source, and store the **full
65-nutrient panel** per food in a normalized `fdc_food_nutrient` table — not just the eight macros
we score on today.

The measured case is overwhelming. FNDDS (5,432 foods) carries the identical complete panel for
**every** food: **99% coverage on every nutrient** — the full NRF15 set *and* omega-3 — versus SR
Legacy's holes (vitamin D 66%, omega-3 74%, complete-NRF15 only 54%) and Foundation's near-total
sparsity (0% complete for even NRF9.3). For **fish**, FNDDS reports vitamin D, DHA, EPA, and B12 at
**100%** — the exact nutrients SR Legacy missed on salmon. So one FNDDS source resolves fish, reaches
NRF15, and **deletes both the dual-dataset fallback and the Atwater calorie edge case** (FNDDS
reports energy for 99% of foods).

Storing the whole panel — not the scored subset — follows the founder's rule: **keep reference data
at the lowest granularity as a foundation to build on.** It is static seed data, so "store
everything" costs one bigger table, not ongoing complexity, and it future-proofs micronutrient
display, an NRF upgrade, a real omega-3 fish term, and diet/allergen filters with no re-seed. This
reverses the earlier draft's "eight denormalized macro columns" — right *only* if we would forever
score on eight; the granularity principle says don't lock a data asset to today's feature.

**Trade-offs, honestly:** FNDDS values are *derived/imputed* (survey modeling), not each freshly
analyzed — completeness over analytical pedigree, the right call for a best-effort feature. It has
fewer distinct foods than SR Legacy (5,432 vs 7,793) with survey-style names, so whether it matches
raw *ingredient* text as well is the open risk — the e2e matching test (O-01) measures it, and if
breadth drops we add SR Legacy back as a **matching-only** fallback (Q-06).

### Alternatives Considered
- **Foundation primary + SR Legacy fallback (the original mandate):** Foundation is 0% complete for NRF and sparse even on calories/sugar; the pairing forced a food-level fallback + Atwater derivation and still could not reach micronutrients. FNDDS supersedes both.
- **Denormalized eight macro columns:** right only if we never store more than eight; rejected under the store-granular principle.
- **Branded Foods / commercial APIs (Nutritionix, Edamam):** label-only or paid/rate-limited, and renting queried answers violates "own the granular data."

## A small static unit→gram table, not FDC foodPortions

**Framework:** Direct criterion — use the data that exists.

The catalog stores nutrients per 100 g, so quantities must reach grams. FNDDS `foodPortions` carry a
`portionDescription` ("1 cup", "1 fillet", "1 large") plus a `gramWeight` — genuine household
measures, unlike SR Legacy's "undetermined" portions — so they are usable where a portion's
description matches the ingredient's unit. But they don't cover every unit on every food, so a
compact static table backs them up.

**Choice:** Use the matched food's `foodPortions` `gramWeight` **when a portion description matches
the ingredient's unit** (grams = amount × gramWeight), and fall back to a compact static table
otherwise. Mass units (g, kg, oz, lb) convert by exact constant (high confidence). Volume units
(tsp, tbsp, cup, ml, l) convert via a small density table keyed on the matched food's category,
defaulting to water (1 g/ml) when unknown (medium confidence). Count/no-unit ("2 eggs", "1 onion",
"a pinch") uses a matching `each`/`large` portion when present, else a short per-item table;
otherwise the ingredient is unconvertible and flagged. This keeps the one genuinely fuzzy step —
volume→mass — small, explicit, and confidence-tagged.


The deep-research pass reached the same shape ("use foodPortions gramWeight where available, fall
back to generic density tables") and stressed that portion coverage is partial, so
double-digit-percent error in the conversion step is irreducible however good the matcher — which is
why every converted quantity carries a conversion-quality tier into the confidence rollup.

### Alternatives Considered
- **Rely solely on `foodPortions`:** FNDDS portions are real household measures but don't cover every unit on every food, so a static density/mass table still backs them up for the misses.

## Withhold an estimate rather than guess

**Framework:** Direct criterion — the feature's stated contract.

When no ingredient matches, or the recipe has no servings to divide by, the step **withholds** the
estimate (`nutrition_source` stays null) rather than persist a fabricated number. A recipe with
no nutrition badge is honest; a confidently wrong calorie count is a defect. This is the same "never
destroy good data / never fabricate" discipline the import filters already follow
(harvest-principles).

## Confidence from match + conversion quality

**Framework:** Direct criterion — the confidence must reflect what could actually go wrong.

Each ingredient carries a **match quality** and a **conversion quality**; the two combine to a
per-ingredient weight. Match quality comes from the FTS5 `bm25()` score against thresholds — the
research's accept / flag / reject tiering (`high` / `low` / `unmatched`), a middle band as `medium`
— **tuned empirically against a labeled sample of real imported recipes, not fixed universal
cutoffs** (Q-01). A recipe's confidence is the quality-weighted coverage of its ingredients,
bucketed high/medium/low.

Note a simplification FNDDS buys us: because it reports **every** nutrient for **every** food (99%),
the "matched food doesn't report this macro" case — which previously made confidence differ *per
macro* — essentially disappears. Confidence is now driven by **matching and unit conversion**, not
by nutrient sparsity, so the per-macro numbers are near-identical and collapse to one recipe-level
signal. The per-ingredient rollup still runs (a null macro is still stored null, never a fabricated
0), but there's no longer a sparse-nutrient story to tell.

**These signals stay internal.** Per founder feedback they are neither persisted nor returned by the
API. They drive three server-side decisions and nothing else: *withhold* the whole estimate when
nothing matches, *omit* an individual macro whose coverage is empty (store null, never a fabricated
0), and feed the `nutrition_ingredient_match` metric and the e2e gap test. The user is told only
that a value was estimated (the ⓘ icon), not how confident each macro is. See
[Confidence propagation](#appendix-b--confidence-propagation) for the exact rollup.

## One `Nutrition` model with an `estimated` flag — not a separate estimated type

**Framework:** Direct criterion — model the domain, don't duplicate it.

Estimated and authoritative nutrition are the same eight per-serving macros; the only difference is
provenance. Modeling them as two types (`Nutrition` + `NutritionEstimate`) would duplicate the
shape and force every reader — the API serializer, the health scorer, the client — to branch on
which one they hold.

**Choice:** One `Nutrition` model carries the eight macros plus an `estimated` boolean (and the
health tier). Estimation produces a `Nutrition` with `estimated = true`; parsing produces one with
`estimated = false`. The boolean persists through the existing `nutrition_source` column
(`computed` ⇒ `estimated`), so there is no new storage for it and no migration. The health scorer
and the API treat both identically. `IngredientMatch` — an ingredient's transient resolution to a
food — is a local value inside the estimator, not a domain entity, because nothing persists or
returns it.

### Alternatives Considered
- **Separate `NutritionEstimate` / `IngredientMatch` entities:** duplicate the macro shape and leak match internals into the domain and API; collapsed to a flag on `Nutrition` per founder feedback.

## Health score: NRF, unlocked by storing the full panel

**Framework:** Direct criterion — pick the most principled score whose data we now have; store the
number, defer the presentation.

**Choice:** Compute and store the **NRF (Nutrient-Rich Foods) score** — Σ encourage nutrients (as
%DV, capped at 100) minus Σ limiters (sat fat, sugar, sodium), per 100 kcal.

This **reverses an earlier decision** in this doc, and the reversal is honest: we first chose
Nutri-Score specifically *because we lacked micronutrient data*, which forced a produce/category
proxy and left oily fish under-credited. Two things then changed:

1. **We decided to store the full FNDDS nutrient panel** (99% coverage). NRF's blocking objection —
   missing micronutrients, a normalized table, seeding cost — evaporated. The data is already there.
2. **The founder chose to store the raw score and defer the tier + reasons.** NRF's one weakness vs
   Nutri-Score — its components are less self-explanatory — only bites at *explanation* time, which
   we're deferring. So the trade Nutri-Score won on no longer applies to v1.

With those changes, NRF is strictly better here: it credits **fish by its real omega-3 and vitamin D**
(100% covered for fish in FNDDS) instead of the category-credit hack, it is a validated
nutrient-density model, and it reads straight from the stored panel. The category credit, produce
fraction, and Nutri-Score point bands are all **removed** — NRF scores nutrients, not food groups.

The open sub-decision is the **nutrient set + DV/MRV table** (Q-04): NRF9.3 omits omega-3/vitamin D,
so crediting fish means an extended set (e.g. NRF11.3 + omega-3). The full panel supports any set;
the dietician signs off which nutrients and which Daily Values.

### Alternatives Considered
- **Nutri-Score 2023 + a fish category credit (the prior choice):** correct while we stored only macros; made obsolete once we store the full panel and defer explanation — NRF credits fish by real nutrients rather than a category proxy.
- **Bucket to a tier now instead of storing the raw score:** lossy; storing the number lets us re-bucket and calibrate later without re-scoring (store-granular principle).
- **LLM health judgment:** non-deterministic, networked, untestable, opaque; against every value in this design.

### Documentation
- NRF index (Fulgoni, Keast & Drewnowski 2009): the qualifying/disqualifying nutrient sets and DV basis.
- Nutri-Score (the superseded choice): https://en.wikipedia.org/wiki/Nutri-Score

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Exact score thresholds for high/medium/low match quality — to be tuned against a sample of real imported recipes before launch. | open | |
| Q-02 | Density table breadth: ship water-default + a handful of high-impact categories (oils, flours, sugars, liquids), or a fuller table? Start minimal; widen if the unmatched/low rate warrants. | open | |
| Q-03 | Re-estimation when the catalog or an ingredient later changes is **out of scope** this sprint (estimate once at import). Confirm no product need for backfilling existing un-estimated recipes at launch. | open | |
| Q-04 | NRF config for the dietician to sign off: the **encourage nutrient set** (NRF9.3 omits omega-3/vitamin D — use an extended set like NRF11.3 + omega-3 to credit fish, now that the panel supports it), the **DV/MRV reference values** per nutrient, the total-sugar-as-added-sugar proxy, and — for the *deferred* tier — the `nrf_score`→tier cutoffs, calibrated on a labeled recipe set (ideal ground truth is ~50 recipes she rates by feel, incl. oily fish). | open | |
| Q-05 | Scope: matching now runs on **every** recipe (not only ones we estimate) so authoritative-nutrition recipes also get a tier + produce fraction + reasons. Confirm that's wanted vs. limiting the verdict to recipes we estimate. | open | |
| Q-06 | FNDDS has fewer, survey-named foods (5,432) than SR Legacy (7,793). Does it match raw *ingredient* text as well? The e2e matching test (O-01) measures per-corpus match rate; if breadth drops, add SR Legacy back as a **matching-only** fallback (nutrients still from FNDDS). | open | |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-16 | Backend Tech Lead | Initial draft |
| 2026-08-16 | Backend Tech Lead | Founder feedback: collapse to one `Nutrition` model with an `estimated` flag (drop `NutritionEstimate`/`IngredientMatch` entities and the `nutrition_confidence` column); keep confidence server-side only; unobtrusive ⓘ icon instead of a badge; e2e ingredient-matching test over the importer's real recipes. Added the **Health Score** (indulgent / healthish / healthy) — tiers, energy-normalized calculator, and `health_tier` column. |
| 2026-08-16 | Backend Tech Lead | Health score reworked to **Nutri-Score** (chosen over NRF for consumer explainability + simplicity — no micronutrients): produce fraction from matched-food categories as the fruit/veg/nut term, plain-language `health_reasons` from the dominant components, and a `produce_fraction` stat. Matching now runs on **every** recipe (Q-05) so authoritative-nutrition recipes also get a tier. Corrected the earlier claim that Nutri-Score's produce term was underivable. |
| 2026-08-16 | Backend Tech Lead | Fish handling: pinned to the **Nutri-Score 2023** algorithm (red/processed-meat protein cap) and added a small tunable **healthy-category credit** (fish/seafood, optionally nuts/olive oil) so oily fish isn't under-rated by the energy penalty. Established that NRF would *not* have fixed fish (its list excludes omega-3/D/B12); recorded the reasoning and the category-credit config for dietician sign-off (Q-04). |
| 2026-08-16 | Backend Tech Lead | **Source → FNDDS.** Measured coverage: FNDDS (Survey, 5,432 foods) reports the full 65-nutrient panel for 99% of foods (100% of fish's vitamin D / omega-3), vs SR Legacy's holes and Foundation's near-total NRF sparsity. Dropped the Foundation-primary + SR-Legacy-fallback mandate (and the Atwater edge case) for one FNDDS source. Store the **full panel** in a normalized `fdc_food_nutrient` table (founder's lowest-granularity principle) — future micronutrient/NRF/omega-3 features read seeded data with no re-seed; v1 still scores on macros + categories. Added Q-06 (FNDDS ingredient-match breadth). |
| 2026-08-16 | Backend Tech Lead | Clarified: the normalized `fdc_food_nutrient` table stays (stores values granularly), but the **number→name/unit** and **category→credit** mappings live in **code enums**, not DB reference tables (static, small, only ~a dozen numbers matter to the code). |
| 2026-08-16 | Backend Tech Lead | **Score → NRF.** Now that we store the full nutrient panel, the data objection to NRF is gone, so switched from Nutri-Score to the **NRF** nutrient-density score (encourage %DV − limiters, per 100 kcal) — which credits fish by its real omega-3/vitamin D, retiring the category-credit hack. **Store the raw `nrf_score`** number; the three fields (`health_tier`/`produce_fraction`/`health_reasons`) collapse to one, and tier-bucketing + reasons + the health UI are **deferred**. Nutrient set + DV table is the open dietician config (Q-04). |

---

# Appendix B — Confidence Propagation

The exact rollup, kept out of the Decisions section for brevity.

This rollup is computed **inside the estimator and never leaves the server** — it decides withhold
and macro-omit, and feeds metrics and the e2e gap test. It is not persisted or returned.

**Per ingredient.** `matchQuality ∈ {high:1.0, medium:0.6, low:0.3, unmatched:0}` and
`conversionQuality ∈ {high:1.0, medium:0.6, low:0.3, none:0}`. The ingredient's weight is
`w = matchQuality × conversionQuality`. An unmatched or unconvertible ingredient has `w = 0`,
contributes nothing to any macro total, and is counted toward the unmatched total (measured, not
returned).

**Per recipe.** Coverage is the quality-weighted share of the recipe's ingredients:

```
coverage = Σ(w over all ingredients with w > 0) / Σ(w over all ingredients, matched or not)
```

The denominator includes unmatched ingredients (as 0), so a recipe with a big unmatched ingredient
cannot show high confidence. Bucket: `coverage ≥ 0.8 → high`, `≥ 0.5 → medium`, else `low`.

Because FNDDS reports every nutrient for every food, a *per-macro* coverage (the old
"matched food reports macro `m`" term) is effectively constant across the eight macros — so we keep
one recipe-level coverage rather than eight near-identical ones. A macro is stored null only in the
rare case its value is genuinely absent, never shown as a fabricated 0.

Confidence never reaches the client; it governs whether the estimate is withheld. What the client
sees is the `estimated` flag (the ⓘ icon); the `nrf_score` rides along for the deferred tier UI.
