---
tags: [harvest, cleanup, spec]
story: C5
summary: "Nutrition-Facts label core (8 fields, per serving) on recipes: parse it from schema.org NutritionInformation, else compute it offline from the in-memory USDA food catalog, gated by a 0.6 coverage floor."
source: docs/sprint-cleanup/DESIGN.md (Revision 2 — C5, Matching, Decisions), docs/sprint-cleanup/ARCHITECT-REVIEW.md (M4, M5, S2, S3, Q-01)
depends_on: spec-06-c5a-food-catalog.md (FoodCatalog.matchFood + toGrams)
---

# C5 — Nutrition-Facts label core (parsed + computed)

## Background

Recipes carry no nutrition today. C5 adds the **Nutrition-Facts label core** — eight per-serving
nutrient values plus a provenance flag — to every imported recipe, filled two ways:

- **PARSED** — the schema.org JSON-LD path already reads a recipe's structured data
  (`server/src/fetch/website.ts` `mapRecipe`, verified to map ingredients / yield / times / image /
  rating only — it does **not** touch `NutritionInformation` today, ARCHITECT-REVIEW.md S2). When the
  page ships a `NutritionInformation` block we read it verbatim: `nutrition_source = 'parsed'`.
- **COMPUTED** — when no parsed nutrition survives, a new `NutritionService` sums each ingredient's
  contribution using the in-memory `FoodCatalog` (spec-06): `matchFood(name)` → `toGrams(amount, unit,
  food)` → nutrient × grams / 100, summed and divided by servings. Matching generic ingredient names to
  USDA foods is inherently lossy, so a **coverage floor** gates it: mark `computed` only when the matched
  fraction (by ingredient count) is **≥ 0.6**; below that, leave nutrition `null` — an honest "unknown"
  beats a confident understatement (DESIGN.md "C5 coverage floor"; ARCHITECT-REVIEW.md M5 / Q-01).

The eight fields are **macros-as-strings**: pg `numeric` deserializes to a string, matching the existing
`RecipeSchema.confidence` (`z.string().nullable()`) and `PublicRecipe.amount` conventions
(ARCHITECT-REVIEW.md S3).

This spec owns the two nutrition data paths, the migration (0008), the model/Zod/public-shape changes,
and wiring `compute` into the persist chokepoint. The `FoodCatalog` class and its matcher/`toGrams` are
spec-06; this spec **consumes** them.

## Objective

Add per-serving Nutrition-Facts label-core columns + a `nutrition_source` enum to `recipes`; populate
them from parsed schema.org nutrition when present, else from an offline computed estimate gated by a
0.6 coverage floor; surface all nine fields on `PublicRecipe`.

## Acceptance Criteria

- **AC1 — migration 0008.** A new migration creates enum `nutrition_source` (`'parsed' | 'computed'`)
  and adds nine columns to `recipes`: `calories`, `grams_of_fat`, `grams_of_saturated_fat`,
  `grams_of_carbohydrate`, `grams_of_fiber`, `grams_of_sugar`, `grams_of_protein`,
  `milligrams_of_sodium` (all `numeric`, nullable) and `nutrition_source` (enum, nullable). This is
  additive/back-compat.
- **AC2 — model.** `RecipeSchema` gains the eight macros as `z.string().nullable()` and `nutritionSource`
  as `z.enum(['parsed','computed']).nullable()`.
- **AC3 — public shape.** `PublicRecipe` gains the eight macros (as `string`, optional, null omitted) and
  `nutrition_source` (optional, null omitted); `toPublicRecipe` maps them, omitting nulls like the
  existing optionals.
- **AC4 — parsed path (`mapRecipe`).** Given HTML whose JSON-LD `Recipe` node carries a
  `NutritionInformation` object, `mapRecipe` returns a `nutrition` block with the eight label-core values,
  each stripped to a bare number-string (drop the trailing ` calories` / ` g` / ` mg` unit text). Absent
  fields are omitted; a recipe with no `NutritionInformation` returns no `nutrition` field.
- **AC5 — carry-through.** `nutrition` is added to the `ExtractedRecipe` interface and flows unchanged
  through `ExtractedRecipeData` (the LLM extractor may also populate it) → the `toExtractedData` adapter →
  `toRecipeInput`. When `nutrition` is present at `toRecipeInput`, the persisted recipe gets those eight
  values and `nutrition_source = 'parsed'`; `compute` is **not** called.
- **AC6 — computed path (full match).** For a recipe whose every ingredient matches a catalog food,
  `NutritionService.compute(ingredients, servings)` returns the eight label-core values = Σ(nutrient per
  100 g × grams / 100) ÷ servings, and the recipe persists with `nutrition_source = 'computed'`.
- **AC7 — computed path (partial ≥ 0.6).** When ≥ 0.6 of ingredients (by count) match, `compute` returns
  the partial sum (unmatched ingredients contribute 0) with `nutrition_source = 'computed'`, and each
  unmatched ingredient emits a `nutrition.unmatched_ingredient` log (name, recipeId).
- **AC8 — computed path (< 0.6 → null).** When < 0.6 of ingredients match, `compute` returns `null`; the
  recipe persists with all eight macros `null` and `nutrition_source = null`, and a
  `nutrition.below_coverage_floor` log (recipeId, fraction) is emitted.
- **AC9 — no parsed, no compute wins.** The parsed path takes precedence: `compute` runs only when no
  parsed `nutrition` reached `toRecipeInput`.
- **AC10 — offline.** No path in C5 makes a network call; the computed path reads only the in-memory
  catalog. All tests select the offline stubs / fixture catalog.

## Files & functions touched

| Path | Symbol | Change |
|---|---|---|
| `server/src/db/schema/enums.ts` | `nutritionSourceEnum` (new) | `pgEnum('nutrition_source', ['parsed','computed'])` + exported `NutritionSource` type. |
| `server/src/db/schema/recipes.ts` | `recipes` table | Add the 8 `numeric` nutrient columns + `nutrition_source` enum column. Delete the stale "ownership lives in `saved_recipes`" comment (`:5-6`, ARCHITECT-REVIEW.md N2 — shared with C6). |
| `server/drizzle/0008_*.sql` (new) | migration | Generated by `drizzle-kit generate` for the enum + 9 columns (C4's `servings_estimated` rides the same 0008 per DESIGN.md Migrations; that column is C4's spec, not this one). |
| `server/src/models/recipe.ts` | `RecipeSchema`, `PublicRecipe`, `toPublicRecipe`, `toPublicIngredient` (untouched) | Add 8 macro fields (`z.string().nullable()`) + `nutritionSource` to `RecipeSchema`; add them to `PublicRecipe`; map + null-omit in `toPublicRecipe`. |
| `server/src/fetch/website.ts` | `ExtractedRecipe` interface (`:11-21`), `mapRecipe` (`:119`), new `mapNutrition` helper | Add `nutrition?: NutritionLabelCore` to the interface; parse `node.nutrition` (schema.org `NutritionInformation`) in `mapRecipe`; strip unit text to number-strings. `StubWebsiteFetcher.FIXTURE` stays as-is (no nutrition — exercises the computed path). |
| `server/src/parse/extractor.ts` | `ExtractedRecipeData` (extends `ExtractedRecipe`, so inherits `nutrition?`) | No structural change needed for parsed carry-through; optionally extend `SYSTEM_PROMPT`/`toData` so the LLM may emit `nutrition` (kept minimal — out of scope to force it). |
| `server/src/services/nutrition-service.ts` (new) | `NutritionService` class, `static create()`, `compute(ingredients, servings)` | The computed path. Depends on `FoodCatalog` (spec-06). |
| `server/src/pipeline/import-pipeline.ts` | `toExtractedData` (new adapter, C3 spec), `toRecipeInput` (`:408`) | Carry `nutrition` through the adapter; in `toRecipeInput` branch: parsed present → set 8 macros + `nutrition_source='parsed'`; else call `NutritionService.compute` and set from its result (or nulls). |
| `server/src/repositories/recipe-repository.ts` | `RecipeInput` (`:9`), `insertRecipe` (`:92`) | Add the 8 macro fields (`string | null`) + `nutritionSource` to `RecipeInput`; write them in `insertRecipe` (numeric fields already come as strings). |
| `server/src/models/nutrition.ts` (new, small) | `NutritionLabelCore` type | The 8-key shape shared by `ExtractedRecipe.nutrition`, `NutritionService`, and `RecipeInput`. Keep it tiny; no Zod needed at this internal boundary. |

The eight label-core keys (canonical order, used everywhere):
`calories, gramsOfFat, gramsOfSaturatedFat, gramsOfCarbohydrate, gramsOfFiber, gramsOfSugar,
gramsOfProtein, milligramsOfSodium` (column names: `calories, grams_of_fat, grams_of_saturated_fat,
grams_of_carbohydrate, grams_of_fiber, grams_of_sugar, grams_of_protein, milligrams_of_sodium`).

## Implementation notes

### Parsed path — `mapRecipe` nutrition (AC4, AC5)

schema.org `NutritionInformation` fields → label-core keys:

| schema.org field | label-core key | column |
|---|---|---|
| `calories` | `calories` | `calories` |
| `fatContent` | `gramsOfFat` | `grams_of_fat` |
| `saturatedFatContent` | `gramsOfSaturatedFat` | `grams_of_saturated_fat` |
| `carbohydrateContent` | `gramsOfCarbohydrate` | `grams_of_carbohydrate` |
| `fiberContent` | `gramsOfFiber` | `grams_of_fiber` |
| `sugarContent` | `gramsOfSugar` | `grams_of_sugar` |
| `proteinContent` | `gramsOfProtein` | `grams_of_protein` |
| `sodiumContent` | `milligramsOfSodium` | `milligrams_of_sodium` |

- schema.org values are strings like `"240 calories"`, `"12 g"`, `"480 mg"`. **Strip to the leading
  number** (regex first `\d+(\.\d+)?`), keep it as a string (matches the `numeric` convention). Drop a
  field whose value has no leading number.
- Set `recipe.nutrition` only when ≥ 1 field parsed; never invent a value (mirrors the existing "optional
  fields set only when present" rule in `mapRecipe`).
- Add `nutrition?: NutritionLabelCore` to `ExtractedRecipe` (`:11-21`). It flows to `ExtractedRecipeData`
  for free (that interface extends `ExtractedRecipe`, extractor.ts `:25`).

### Adapter carry-through (AC5)

`toExtractedData` (the new C3 adapter, `import-pipeline.ts`) must pass `nutrition` straight through when
promoting `ExtractedRecipe` → `ExtractedRecipeData`. It parses ingredient strings; it does **not** touch
nutrition. (This spec depends on the C3 adapter existing; if C3 lands first, just carry the field.)

### `NutritionService.compute` (AC6–AC8)

`server/src/services/nutrition-service.ts` — class with `static create()` wiring the `FoodCatalog`
singleton (`NutritionService(FoodCatalog.create())`), matching the server class convention.

```
compute(ingredients: StructuredIngredient[], servings: number): NutritionLabelCore | null
```

Algorithm:
1. For each ingredient: `food = catalog.matchFood(ingredient.name)`.
   - No food → unmatched; log `nutrition.unmatched_ingredient` (name); contributes 0.
   - Food but `grams = catalog.toGrams(ingredient.amount, ingredient.unit, food)` is `null` (e.g. a
     dry-goods volume with no portion — ARCHITECT-REVIEW.md M4) → also unmatched (same log, contributes
     0). "Matched" for the coverage floor means **matched AND gramsable**.
2. `fraction = matched / ingredients.length` (guard `length === 0` → return null).
3. If `fraction < 0.6` → return `null`. (Caller logs `nutrition.below_coverage_floor` once it has the
   recipeId — the service returns null; the pipeline emits the coverage log since it holds the id.)
4. Else, for each of the 8 nutrients: `sum += Number(food.per100g[key]) * grams / 100` across matched
   ingredients; then `perServing = sum / servings`. Return each as a fixed-precision **string** (e.g.
   `.toFixed(1)` — match the `numeric` string convention; pick one rounding and keep it consistent).
- The `matchFood` / `toGrams` contract, the water-density fallback bounds, and the guardrail cases are
  spec-06.
- `servings` is the post-C4 value (never null — C4 defaults to 4), so no divide-by-zero from a missing
  yield; still guard `servings <= 0 → null` defensively.

### Wiring into `toRecipeInput` (AC5, AC9)

`toRecipeInput(data, input)` (`import-pipeline.ts:408`) is the persist chokepoint. After the existing
mapping:
- If `data.nutrition` present → spread its 8 values (as strings) onto `RecipeInput` +
  `nutritionSource: 'parsed'`.
- Else → `const n = NutritionService.create().compute(structuredIngredients, servings)`. If `n` → 8
  values + `nutritionSource: 'computed'`. If `null` → all 8 `null` + `nutritionSource: null`, and emit
  `nutrition.below_coverage_floor`.
- `compute` needs the **structured** ingredients (with `amount`/`unit`), which the C3 change makes
  available here. Use the same structured list that persists — do not re-parse.

`toRecipeInput` is sync today; `compute` is sync (in-memory catalog), so no async change is required.

### Repository (AC1 persistence)

`RecipeInput` gains `calories: string | null; …; milligramsOfSodium: string | null; nutritionSource:
NutritionSource | null`. `insertRecipe` writes them in the `.values({...})` block (numeric columns take
the strings directly; enum takes the value or null).

### Logging (DESIGN.md Monitoring)

Two `info` logs, off the hot path, low cardinality:
- `nutrition.unmatched_ingredient` — `{ name, recipeId }` — per unmatched ingredient.
- `nutrition.below_coverage_floor` — `{ recipeId, fraction }` — once, when compute returns null.

Use the project's existing logger; do not add metrics/alerts.

## Test Cases

Offline only (server/CLAUDE.md — tests never hit the network). Unit tests use the fixture `foods.json`
(spec-06) and pure `mapRecipe`. Integration uses the stub extractor + `StubWebsiteFetcher.FIXTURE` and
local Postgres.

### Test Case 1: `mapRecipe` parses NutritionInformation → parsed labels (AC4)

**Preconditions:** An HTML fixture string containing a JSON-LD `Recipe` node with a
`NutritionInformation` object (`calories: "240 calories"`, `fatContent: "12 g"`,
`saturatedFatContent: "4 g"`, `carbohydrateContent: "20 g"`, `fiberContent: "3 g"`,
`sugarContent: "5 g"`, `proteinContent: "18 g"`, `sodiumContent: "480 mg"`).

**Steps:** Call `WebsiteFetcher.parse(html)` (pure, no network).

**Expected Outcomes:** Returned `ExtractedRecipe.nutrition` = `{ calories:"240", gramsOfFat:"12",
gramsOfSaturatedFat:"4", gramsOfCarbohydrate:"20", gramsOfFiber:"3", gramsOfSugar:"5",
gramsOfProtein:"18", milligramsOfSodium:"480" }` — unit text stripped, values are number-strings. A
second fixture with no `NutritionInformation` yields no `nutrition` field.

### Test Case 2: `NutritionService` fully-matched recipe → per-serving computed (AC6)

**Preconditions:** Fixture `foods.json` with known `per100g` for the foods used. Structured ingredients
whose names all match, with weight/volume+portion units that `toGrams` resolves; `servings = 2`.

**Steps:** `NutritionService.create()` (over the fixture catalog) `.compute(ingredients, 2)`.

**Expected Outcomes:** Returns the eight label-core strings equal to Σ(per100g × grams/100) ÷ 2, computed
by hand from the fixture; `nutrition_source` is set to `'computed'` when persisted.

### Test Case 3: partial ≥ 0.6 → computed, unmatched logged (AC7)

**Preconditions:** Five structured ingredients; four match the fixture catalog, one is a nonsense name
(`"xyzzy powder"`). `servings = 4`.

**Steps:** Spy on the logger; call `compute(ingredients, 4)`.

**Expected Outcomes:** `fraction = 0.8 ≥ 0.6` → returns non-null label core (the four matched summed, the
fifth contributing 0); one `nutrition.unmatched_ingredient` log for `"xyzzy powder"`.

### Test Case 4: < 0.6 → null (AC8)

**Preconditions:** Five structured ingredients; two match, three are nonsense. `servings = 4`.

**Steps:** `compute(ingredients, 4)`.

**Expected Outcomes:** `fraction = 0.4 < 0.6` → returns `null`. (Integration TC7 asserts the persisted row
then has all-null macros + `nutrition_source = null` and the `below_coverage_floor` log.)

### Test Case 5: parsed precedence — parsed wins, compute not called (AC5, AC9)

**Preconditions:** `ExtractedRecipeData` carrying a `nutrition` block.

**Steps:** Call `toRecipeInput(data, input)` with a `NutritionService.compute` spy.

**Expected Outcomes:** `RecipeInput` carries the parsed macros + `nutritionSource='parsed'`; the compute
spy is **not** called.

### Test Case 6: model + public shape (AC2, AC3)

**Preconditions:** A `recipes` row with the eight macros + `nutrition_source='computed'`; and one with
them all null.

**Steps:** Read via the repository; call `toPublicRecipe`.

**Expected Outcomes:** `RecipeSchema.parse` accepts string macros + the enum (or nulls); `PublicRecipe`
includes the eight macros + `nutrition_source` when non-null and **omits** them when null (matching the
existing optional-omit behaviour).

### Test Case 7: integration — computed nutrition persisted on import (AC6, AC7, AC8, AC10)

**Preconditions:** Local Postgres migrated (incl. 0008); stub extractor / `StubWebsiteFetcher.FIXTURE`
(no parsed nutrition → computed path); fixture catalog wired for the test.

**Steps:** Run the import pipeline for a website source through `persist`; read the recipe back.

**Expected Outcomes:** The stored recipe has computed macros + `nutrition_source='computed'` when the
FIXTURE ingredients clear the 0.6 floor (and null + `nutrition_source=null` in a below-floor variant). No
network call occurs.

## Test Run

_To be filled in during execution — commands, output, pass/fail per test case._

## Deployment Strategy

Direct deploy. Migration 0008 is additive and back-compat (nullable columns + a new enum), so it applies
cleanly to any environment. No feature flag: nutrition simply appears on newly imported recipes; existing
rows keep null macros (no backfill — pre-launch). Roll back by reverting the code and dropping the added
columns/enum (DESIGN.md Rollback).

## Production Verification

### Production Verification 1: imported recipe carries nutrition

**Preconditions:** 0008 applied in the target env.

**Steps:** Import a recipe whose page ships schema.org `NutritionInformation`; import another that does
not.

**Expected Outcomes:** The first persists `nutrition_source='parsed'` with the page's values; the second
persists `nutrition_source='computed'` (or `null` below the floor). `GET /v1/recipes/:id` returns the
macros for a computed/parsed recipe and omits them for a below-floor one.

## Production Verification Run

_To be filled in after deploy — evidence per verification case._

## Out of scope

- The `FoodCatalog` class, its matcher, `toGrams`, and `foods.json` / the seed builder — that is
  spec-06 (this spec consumes `matchFood` + `toGrams`).
- C3 structured-ingredient parsing (`parseIngredientLine`, the `toExtractedData` adapter) — separate
  spec; this spec depends on structured ingredients being available at `toRecipeInput`.
- C4 `servings_estimated` — separate spec (rides the same 0008 migration but is not defined here).
- C6 ownership / `user_id` — separate spec (only the shared stale-comment deletion in `recipes.ts` is
  noted).
- Forcing the LLM extractor to emit nutrition — optional, minimal; the computed path is the fallback.
- Any nutrition UI, scaling of macros by serving-count on the client, per-ingredient nutrition display,
  or `GET /v1/recipes` list exposure (Q-03 defers it).
- Micronutrients or any nutrient beyond the eight label-core fields.
