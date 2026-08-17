# WI-TS-3 — Wire `categorizeStep` into the import workflow

## Background

WI-TS-1 gives us storage (`recipe_categories` + persist/read). WI-TS-2 gives us the pure
`RecipeCategorizer`. This work item connects them: run the categorizer during import and persist its
output, so every newly-imported recipe lands with its facets. **Depends on WI-TS-1 and WI-TS-2.**

System context (grounded in `server/src/workflows/import-workflow.ts`):
- The durable workflow orchestrates: `markRunning → fetchSourceStep → resolveRecipes → nutritionStep →
  persistStep`, with `catch → markFailed`. The workflow only awaits steps; each `"use step"` returns
  serializable data and re-runs on replay.
- `nutritionStep(recipes, input)` is the exact template: a `"use step"` that runs
  `Promise.all(recipes.map(enrichOne))`, where `enrichOne` calls `NutritionEstimator.run(...)` inside
  a `try/catch` and attaches `estimate` to the `ExtractedRecipeData`, returning the recipe unenriched
  on error. It reads the seeded catalog from `dbFromEnv()` — no external network.
- `ExtractedRecipeData` (`server/src/parse/extractor.ts`) carries data through the pipeline; nutrition
  added an optional `estimate?` field.
- `toRecipeInput` (`server/src/parse/mapping.ts`) folds `ExtractedRecipeData` into `RecipeInput`,
  including `toNutritionInput(data)`. `persistAndReady` then persists.

## Objective

Add a `categorizeStep` to the import workflow, placed after `nutritionStep` and before `persistStep`,
that categorizes every resolved recipe (best-effort) and attaches the result to `ExtractedRecipeData`;
extend `toRecipeInput` to pass `categories` into `RecipeInput` (WI-TS-1); and log one line per recipe.
A categorizer failure must never fail an import.

## Acceptance Criteria

1. **Carrier field.** Given `ExtractedRecipeData`, when the step runs, then it carries an optional
   `categories?: RecipeCategories` field (mirroring `estimate?`). Absent until `categorizeStep` runs.
2. **Step placement.** Given `importWorkflow`, when it runs, then the sequence is
   `… → nutritionStep → categorizeStep → persistStep`. `categorizeStep` is a `"use step"` with
   `maxRetries` set consistently with the other steps.
3. **Per-recipe, concurrent, best-effort.** Given N resolved recipes, when `categorizeStep` runs, then
   it categorizes them via `Promise.all(recipes.map(categorizeOne))`, each `categorizeOne` wrapping
   `RecipeCategorizer.categorize(...)` in `try/catch`. On success it attaches `categories`; on error it
   logs `outcome=error` and returns the recipe unchanged (no `categories`).
4. **Import never fails on categorization (E1).** Given a `RecipeCategorizer` that throws for a recipe,
   when the import runs, then the job still reaches `ready`, and that recipe persists with zero
   `recipe_categories` rows.
5. **Persist passthrough.** Given a recipe with `categories` attached, when `toRecipeInput` runs, then
   `RecipeInput.categories` is set from `data.categories` and persisted by WI-TS-1's `insertCategories`.
   Given no `categories`, `RecipeInput.categories` is omitted and zero rows persist.
6. **Logging.** Given `categorizeStep` processes a recipe, when it finishes that recipe, then it emits
   one `info` line: `[step] categorize job=<id> title=<t> cuisine=<n> dish=<n> primary=<n> outcome=<ok|error>`
   where the counts are per-facet value counts. Provenance/tier detail may be included but no per-value
   spam.
7. **No external network in the step's default/test path.** Given tests run with the offline stubs
   selected (no `OPENAI_API_KEY`), when an import runs, then `categorizeStep` performs no external
   network call (FDC is local; cuisine uses the stub).

## Test Cases

### Test Case 1: Step runs after nutrition, attaches categories (AC1, AC2, AC3)

**Preconditions:** Workflow unit test that mocks the steps' collaborators (per `server/CLAUDE.md`:
unit-test the workflow by mocking its steps; never test WDK replay). Stub categorizer returns
`{ cuisine:['italian'], dishType:['pasta'], primaryIngredient:['seafood'] }`.
**Steps:** Run `importWorkflow` for a single-recipe source.
**Expected Outcomes:** `categorizeStep` executes between nutrition and persist; the persisted recipe
carries the three facet values; the job reaches `ready`.

### Test Case 2: Categorizer throws → import still succeeds (AC4)

**Preconditions:** Stub categorizer that throws for the recipe.
**Steps:** Run the import.
**Expected Outcomes:** Job status `ready`; recipe persisted; zero `recipe_categories` rows; a
`categorize … outcome=error` log line present.

### Test Case 3: Persist passthrough end-to-end (AC5)

**Preconditions:** Local libSQL test db; real `toRecipeInput` + `persistAndReady`; stub categorizer
returning known facets.
**Steps:** Run the import; read the recipe via `findById` / `GET /v1/recipes/:id`.
**Expected Outcomes:** Response `categories` equals the stub's output; DB has the matching rows.

### Test Case 4: Multi-recipe carousel (AC3)

**Preconditions:** A carousel source resolving to two recipes; stub categorizer returns distinct
facets per title.
**Steps:** Run the import.
**Expected Outcomes:** Both recipes persist with their own categories; concurrency does not cross
results.

### Test Case 5: Offline, no network (AC7)

**Preconditions:** No `OPENAI_API_KEY`; offline stubs selected; a spy on outbound HTTP.
**Steps:** Run an import e2e with a fixture recipe.
**Expected Outcomes:** The fixture recipe emerges with non-empty `categories` (from FDC + rules); no
external HTTP call recorded by the categorize step.

### Test Case 6: Log line shape (AC6)

**Preconditions:** Capture stdout in the workflow test.
**Steps:** Run an import for one recipe with known facets.
**Expected Outcomes:** Exactly one `[step] categorize …` line for that recipe with the counts and
`outcome=ok`.

## Test Run

_To be determined during execution._

## Deployment Strategy

Ships together with WI-TS-1's migration and WI-TS-2's library, as one deploy. The step is non-blocking
enrichment: a categorizer regression degrades ranking quality but cannot break import (AC4). The LLM
tier engages only when `OPENAI_API_KEY` is set. Rollback: revert the code; existing `recipe_categories`
rows are harmless and reads tolerate their absence. No standalone flag required — the best-effort
`try/catch` is the safety mechanism; if a flag is desired, gate the `RecipeCategorizer.categorize`
call, not the persist.

## Production Verification

### Production Verification 1: New imports get categorized

**Preconditions:** Deployed; `OPENAI_API_KEY` present.
**Steps:** Import a known website recipe (e.g. a shrimp pasta); `GET /v1/recipes/:id`.
**Expected Outcomes:** `categories` populated with plausible facets (`primary_ingredient` includes
`seafood`, `dish_type` includes `pasta`). Logs show `categorize … outcome=ok`.

### Production Verification 2: Import resilience

**Preconditions:** Deployed.
**Steps:** Monitor import success rate and the `categorize … outcome=error` rate over the first day.
**Expected Outcomes:** Import success rate unchanged from pre-deploy; any categorize errors do not
correlate with failed imports (best-effort holds).

## Production Verification Run

_To be determined during execution._
