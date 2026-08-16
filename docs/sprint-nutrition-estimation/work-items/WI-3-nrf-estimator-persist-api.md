# WI-3 — NRF estimator + persistence + API

## Background

WI-1 seeded the FNDDS catalog; WI-2 built matching and gram conversion. This work item completes the
feature (DESIGN.md): the `NutritionEstimator` that composes those collaborators, the pure `nrfScore`
health function, the workflow step that runs for **every** recipe, the `recipes.nrf_score` column,
the `Nutrition` model's `estimated` flag, and the API change (nutrition `source` → `estimated`, plus
`nrf_score`).

Behavior (design "Estimate Nutrition During Import"):
- For **every** recipe, match each ingredient, convert to grams, and compute `nrfScore`.
- **Estimate the eight macros only when the recipe has no parsed (authoritative) nutrition.** A
  recipe that already carries parsed macros keeps them, but is still matched and scored.
- **Withhold** (persist no estimate, no score) when nothing matches or there are no servings to
  divide by — never fabricate (design "Withhold an estimate rather than guess"). A macro whose
  matched food genuinely lacks a value is stored `null`, never `0`.
- No network. The step reads the seeded catalog from the local DB.

Depends on **WI-1** and **WI-2**.

Grounding:
- Workflow: `server/src/workflows/import-workflow.ts` — `"use step"` functions with `.maxRetries`;
  `resolveRecipes` → `persistStep`. The new `nutritionStep` sits between them.
- Persist: `server/src/import-persist.ts` `persistAndReady(db, recipes, input)` (one transaction);
  `toRecipeInput` (`parse/mapping.ts`) maps extracted data to the recipe insert.
- Recipe columns already exist: the eight macros, `nutrition_source` enum (`'parsed'|'computed'`),
  `confidence`, `servings`, `servings_estimated` (`schema.ts:97`). We add **one** column,
  `nrf_score`.
- Serializer: `server/src/models/recipe.ts` `toPublicRecipe` / `toPublicNutrition` (currently emits
  `nutrition.source`; change to `estimated`, add top-level `nrf_score`).
- Label core / Nutrition model: `server/src/models/label-core.ts` (`LABEL_CORE_KEYS`, `Nutrition`
  type with `source: 'parsed'`; extend to carry `estimated`).
- Integration test to extend: `server/test/import-pipeline.test.ts` (offline, `StubExtractor`,
  asserts persisted rows on `migratedFileDb()`).

## Objective

Ship `NutritionEstimator.run`, the pure `nrfScore` function, the `nutritionStep` wired into the
import workflow for every recipe, the `recipes.nrf_score` migration, the `Nutrition.estimated` model
change, and the API change. An imported recipe lacking parsed nutrition persists with
`nutrition_source='computed'`, populated macros, and an `nrf_score`; a parsed-nutrition recipe keeps
its macros untouched but is scored; a no-match recipe persists with neither.

## Acceptance Criteria

- **AC-1** — Migration adds `recipes.nrf_score` (`text`, nullable) via `npm run db:generate`
  (additive, backwards-compatible). It applies on `migratedFileDb()`.
- **AC-2** — The `Nutrition` model (`server/src/models/label-core.ts`) carries an `estimated:
  boolean` instead of / alongside the `source: 'parsed'` literal, per design's one-model rule. The
  boolean persists through the existing `nutrition_source` column: `'computed'` ⇔ `estimated =
  true`, `'parsed'` ⇔ `estimated = false`. No new column for it.
- **AC-3** — Pure function `nrfScore(nutrientsPer100g: Map<string, number>, calories: number):
  number | null` (`server/src/nutrition/nrf-score.ts`): sum of encourage nutrients as %DV **capped
  at 100** each, minus sum of limiter nutrients as %MRV, normalized **per 100 kcal**. Returns `null`
  when `calories <= 0`. A `null`/absent nutrient contributes nothing to its term (never invented).
  The encourage/limit nutrient sets and their DV/MRV values are a documented **code constant** in
  this module. `[ASSUMPTION: default set = NRF11.3 + omega-3 (limiters = saturated fat, sugar,
  sodium), with a DV/MRV table as a code constant — design Q-04 leaves the exact set + values to a
  dietician. Ship this documented default behind a clearly named constant so the dietician's set
  drops in without touching call sites.]`
- **AC-4** — `NutritionEstimator` (`server/src/nutrition/nutrition-estimator.ts`, `static
  create(db)` wiring `FdcFoodRepository` + `FoodMatcher` + `QuantityConverter`) exposes `run(
  ingredients, servings, parsed?): { nutrition?: { values, estimated }, nrfScore?: number }`:
  - For each ingredient: `FoodMatcher.match` → `QuantityConverter.toGrams`. Unmatched or
    unconvertible ingredients are **excluded** from totals (never guessed).
  - **When `parsed` is absent:** aggregate each macro as `Σ (amountPer100g × grams / 100) ÷
    servings`; a macro with no contributing food is stored `null` (omitted), not `0`. Result carries
    `estimated: true`.
  - **When `parsed` is present:** keep the parsed macros as-is; `estimated: false`. Still match +
    score.
  - **`nrfScore`** is computed from the recipe's aggregated (or parsed) per-100-kcal nutrient basis
    via `nrfScore(...)`; omitted when there are no matches or calories are absent.
  - **Withhold:** when no ingredient matches, or `servings` is null/≤0 and nutrition is absent,
    return `{}` (no nutrition, no score) — the recipe persists without a verdict.
- **AC-5** — `nutritionStep` (a `"use step"` in `import-workflow.ts`, with `.maxRetries`) runs
  between `resolveRecipes` and `persistStep` for **every** recipe, calling `NutritionEstimator.run`
  and enriching each recipe with `{ nutrition, nrfScore }`. It reads the seeded catalog from
  `dbFromEnv()`; it makes **no network call**. It logs one info line per recipe (recipe id,
  matched/total ingredient count, outcome), per design Monitoring.
- **AC-6** — `persistAndReady` / `toRecipeInput` persist the estimate: when the estimate has macros,
  write the eight macro columns and `nutrition_source='computed'`; write `nrf_score` for any recipe
  that got a score (parsed or computed). A parsed recipe's existing macros and
  `nutrition_source='parsed'` are untouched; a withheld recipe writes neither
  (`nutrition_source` stays null, `nrf_score` null).
- **AC-7** — API: `toPublicNutrition` emits `estimated: boolean` (from `nutrition_source`) instead
  of `source`, and `toPublicRecipe` adds top-level `nrf_score` (number) when present, on both `GET
  /v1/recipes/:id` and the list/card endpoint. **Confidence is never serialized.** Macro payload is
  otherwise unchanged; a macro is omitted when null.
- **AC-8** — Integration test extends `server/test/import-pipeline.test.ts`:
  - A `StubExtractor` recipe with ingredients but **no** parsed nutrition, run through the pipeline
    (or directly through `nutritionStep` + `persistAndReady`), persists with
    `nutrition_source='computed'`, populated macro columns, and a non-null `nrf_score`.
  - A recipe **with** parsed nutrition persists with its macros untouched, `nutrition_source
    ='parsed'`, and a non-null `nrf_score` (scored but not re-estimated).
  - A recipe whose ingredients **match nothing** (or has no servings) persists with
    `nutrition_source` null and `nrf_score` null (withheld).
  Uses the WI-1 fixture seeded on the migrated DB; no network.
- **AC-9** — Unit tests cover `NutritionEstimator.run` (aggregation math, unmatched exclusion,
  withhold-on-no-match, skip-when-parsed) and `nrfScore` (%DV capped at 100, encourage−limit sum,
  per-100-kcal normalization, `null` when `calories=0`, and a nutrient-dense food e.g. salmon
  outscoring a calorie-dense low-nutrient one e.g. chips using the fixture panels).
- **AC-10** — `npm run test`, `npm run typecheck`, and `npm run test:e2e` pass; no test hits the
  network. The client contract change (`source`→`estimated`, `nrf_score`) is reflected in the
  `PublicNutrition`/`PublicRecipe` types.

## Test Cases

### Test Case 1: `nrf_score` migration applies (AC-1)

**Preconditions:** `nrf_score` added to `recipes` in `schema.ts`; migration generated.

**Steps:** `migratedFileDb()`, then insert a recipe row and read `nrf_score` back.

**Expected Outcomes:** Migration applies; `nrf_score` is nullable text, defaulting null.

### Test Case 2: `nrfScore` pure-function behavior (AC-3, AC-9)

**Preconditions:** `nrfScore` exported; fixture nutrient maps for salmon and chips.

**Steps:**
1. Assert `nrfScore(anyPanel, 0)` returns `null` (and `<= 0` calories generally).
2. Construct a panel where one encourage nutrient far exceeds its DV; assert its term is capped at
   100 (score does not scale past the cap for that nutrient).
3. Assert `nrfScore(salmonPer100g, salmonCalories) > nrfScore(chipsPer100g, chipsCalories)`.
4. Assert a missing nutrient contributes 0 to its term (score with the key absent equals the score
   with it set to 0).

**Expected Outcomes:** All hold: null on zero calories, per-nutrient cap at 100, salmon outscores
chips, absent nutrient is neutral.

### Test Case 3: `NutritionEstimator.run` — estimate, exclude, withhold, skip (AC-4, AC-9)

**Preconditions:** WI-1 fixture seeded; `NutritionEstimator.create(db)`.

**Steps:**
1. `run([{name:'spinach',amount:'200',unit:'g'}, {name:'salmon',amount:'100',unit:'g'}], 2)`
   (no `parsed`) → `nutrition.estimated === true`; macros = per-100g × grams/100 summed ÷ 2;
   `nrfScore` present.
2. Add an unmatched ingredient (`{name:'xyzzy',amount:'1',unit:'g'}`) → totals unchanged from step 1
   (excluded, not guessed).
3. `run([{name:'xyzzy',amount:'1',unit:'g'}], 2)` (nothing matches) → `{}` (no nutrition, no score).
4. `run([...], null)` with no `parsed` (no servings) → `{}` (withheld).
5. `run([...spinach,salmon...], 2, parsedNutrition)` → `nutrition.values === parsedNutrition`
   (untouched), `estimated === false`, `nrfScore` still present.

**Expected Outcomes:** Each matches the stated result; unmatched excluded; withhold returns `{}`;
parsed macros preserved but still scored.

### Test Case 4: Pipeline persists computed / parsed / withheld (AC-5, AC-6, AC-8)

**Preconditions:** `import-pipeline.test.ts` extended; fixture seeded on `migratedFileDb()`.

**Steps:**
1. Persist a stub recipe with ingredients, no parsed nutrition → read the row.
2. Persist a stub recipe with parsed nutrition → read the row.
3. Persist a stub recipe whose ingredients match nothing → read the row.

**Expected Outcomes:**
1. `nutrition_source='computed'`, all eight macro columns populated (or null only where genuinely
   absent), `nrf_score` non-null.
2. `nutrition_source='parsed'`, macros equal the parsed input (unchanged), `nrf_score` non-null.
3. `nutrition_source` null, `nrf_score` null.

### Test Case 5: API emits `estimated` + `nrf_score`, never confidence (AC-7)

**Preconditions:** Recipes from Test Case 4 persisted; `toPublicRecipe` used by the read endpoints.

**Steps:**
1. Serialize the computed recipe → assert `nutrition.estimated === true`, macros present,
   `nrf_score` a number, no `source` field, no `confidence` field.
2. Serialize the parsed recipe → `nutrition.estimated === false`, `nrf_score` present.
3. Serialize the withheld recipe → no `nutrition` object, no `nrf_score`.

**Expected Outcomes:** As stated; `estimated` replaces `source`; `nrf_score` present when scored;
confidence never appears.

### Test Case 6: Suite, typecheck, e2e green (AC-10)

**Steps:** Run `npm run test`, `npm run typecheck`, `npm run test:e2e` in `server/`.

**Expected Outcomes:** All pass; no network.

## Test Run

To be filled during execution.

## Deployment Strategy

Additive and backwards-compatible, deployed in order:
1. **Migration** — add nullable `recipes.nrf_score` (generated; additive). Deploys before the code
   that writes it.
2. **Code** — `nutritionStep` wired into the workflow, `NutritionEstimator`, `nrfScore`, the model
   `estimated` change, and the serializer change. Requires WI-1's catalog seeded (WI-1 deploy) and
   WI-2's classes.

The API change (`source`→`estimated`, add `nrf_score`) is a client contract change; coordinate with
the mobile client (design's F-02 renders `estimated`; `nrf_score` is not yet consumed). `[ASSUMPTION:
the client tolerates the `source`→`estimated` swap or ships in lockstep; if a transition window is
needed, emit both `source` and `estimated` for one release, then drop `source` — note the choice at
implementation time.]`

**Rollback:** The catalog tables and nullable `nrf_score` are inert without the new code; redeploy
the prior build to roll back. Estimation never mutates authoritative (`parsed`) nutrition, and this
sprint does not backfill existing recipes (design Q-03), so there is no data migration to reverse. If
the catalog is empty, every ingredient is unmatched and `nutritionStep` withholds — recipes still
import, just without computed nutrition or a score (design "Rollback Plan").

**Monitoring** (design): the `nutrition_estimate_outcome` and `nutrition_ingredient_match` counters
and the withhold-ratio warn alert are wired where the existing import step logging lives.

## Production Verification

### Production Verification 1: A recipe lacking nutrition gets an estimate + score

**Preconditions:** WI-1 catalog seeded, WI-2/WI-3 deployed in the target environment.

**Steps:**
1. Import a real recipe whose source publishes **no** `schema.org/NutritionInformation` (has
   ingredients + servings).
2. `GET /v1/recipes/:id`.

**Expected Outcomes:** `nutrition.estimated === true`, the eight macros populated (per serving), and
a numeric `nrf_score`. No `confidence` field.

### Production Verification 2: A recipe with authoritative nutrition keeps it, still scored

**Preconditions:** As above.

**Steps:**
1. Import a real recipe whose source publishes `schema.org/NutritionInformation`.
2. `GET /v1/recipes/:id`.

**Expected Outcomes:** `nutrition.estimated === false`, macros equal to the source's values
(unchanged by estimation), and a numeric `nrf_score`. No `confidence` field.

### Production Verification 3: An unmatchable recipe withholds honestly

**Preconditions:** As above.

**Steps:**
1. Import a recipe whose ingredients the catalog cannot match (or which has no servings) and no
   parsed nutrition.
2. `GET /v1/recipes/:id`.

**Expected Outcomes:** No `nutrition` object and no `nrf_score` — the recipe imported without a
fabricated verdict.

## Production Verification Run

To be filled during execution.
