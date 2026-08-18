# WI-DIFF-3 — Score at persist & read it back

## Background

WI-DIFF-1 added the columns; WI-DIFF-2 built the pure scorer. This work item computes difficulty at
ingest and persists it, then reads it back on the recipe aggregate.

**Placement — a refinement of the design doc.** `docs/design-recipe-difficulty-signal.md` described a
best-effort `difficultyStep` in the import workflow. During implementation we score at the persist
chokepoint (`toRecipeInput`) instead, for a concrete correctness reason: `toRecipeInput` strips bare
section-label steps (`stripSectionLabels`), so per-step difficulty must be computed over the
**finalized** step list or the per-step values misalign with the persisted `recipe_steps` rows.
`toRecipeInput` is the single point where steps are final, and difficulty scoring does no I/O (unlike
the nutrition/allergen/categorize steps, which read the FDC catalog and therefore justify a WDK step).
This is the placement the design's own "difficultyStep" decision flagged as collapsible. Update the
design doc's F-DIFF-01 placement + Decision + changelog to match.

## Objective

1. Add a shared `RecipeDifficulty` type (`{ score: number; band: DifficultyBand; stepDifficulties: number[] }`)
   to the domain models; `DifficultyBand = 'beginner' | 'intermediate' | 'advanced'`.
2. In `toRecipeInput` (`server/src/parse/mapping.ts`), after the final `ingredients`/`steps` are
   computed, call `DifficultyScorer.score(steps, ingredients.length, totalMinutes ?? null)` and attach
   the result as `RecipeInput.difficulty` (`stepDifficulties` index-aligned to the final `steps`).
3. In `RecipeRepository` (`persistWith`): write `recipes.difficulty_score` (stringified, like
   `nrfScore`) + `recipes.difficulty_band` in `insertRecipe`, and pass `difficulty.stepDifficulties`
   into `insertSteps` so each `recipe_steps` row carries its `difficulty` (index-aligned; `null` when
   the recipe has no difficulty).
4. In `findById`: read `recipe_steps.difficulty` per step and the two recipe columns; expose them on
   `RecipeDetail` (a `stepDifficulties: (number|null)[]` aligned to `steps`, and a `difficulty:
   RecipeDifficulty | null`). `RecipeSchema` gains `difficultyScore: string|null` and
   `difficultyBand: DifficultyBand|null`.
5. Add one calibration log line per recipe at persist time:
   `[persist] difficulty title=<t> score=<n> band=<b> steps=<n> ings=<n> minutes=<n|none>`.
6. Integration tests.

`[ASSUMPTION: editing a recipe's steps/ingredients via updateContent leaves difficulty stale until re-import — out of scope here, tracked as a follow-up open question. Recompute-on-edit is not built in this WI.]`

## Acceptance Criteria

1. **Scored at ingest.** Given an imported recipe with steps/ingredients, when it persists, then
   `recipes.difficulty_score` and `recipes.difficulty_band` are non-null and equal
   `DifficultyScorer.score(...)` for that recipe's finalized data.
2. **Per-step persisted & aligned.** Given the persisted recipe, when I read `recipe_steps` ordered by
   `position`, then each row's `difficulty` equals the scorer's per-step weight for that exact step
   text, and `max(recipe_steps.difficulty)/5` equals the `T` implied by `difficulty_score`.
3. **Section-strip alignment.** Given a source whose steps include a bare section label (e.g. "For the
   sauce:") that `stripSectionLabels` drops, when persisted, then per-step difficulties align to the
   **stored** steps (the dropped label has no row and does not shift any weight), and `S` in the score
   uses the stored step count.
4. **Read-back.** Given `findById`, when it returns, then `RecipeDetail.difficulty` is
   `{ score, band, stepDifficulties }` reconstructed from the columns, `stepDifficulties` aligned to
   `steps`; a pre-feature recipe (null columns) returns `difficulty: null`.
5. **Best-effort parity.** Given scoring throws (inject a scorer error), when the recipe persists, then
   both recipe columns and all `recipe_steps.difficulty` are `null` and the import still reaches
   `ready` (never fails an import). `[ASSUMPTION: wrap the score() call in toRecipeInput — or its caller — in try/catch returning undefined difficulty, mirroring the nutrition/allergen best-effort posture.]`
6. **Replay idempotent.** Given the same recipe persisted twice (workflow replay), when read back, then
   difficulty values are identical and no duplicate rows appear.
7. **Log line.** Given an import, when it persists, then exactly one `[persist] difficulty …` line is
   logged per recipe with score, band, and the counts.
8. **Suite green.** All new and existing tests pass.

## Test Cases

### Test Case 1: End-to-end persist + read (integration)
**Preconditions:** Local libSQL test db (migrated); offline stubs selected (no network).
**Steps:**
1. Persist an extracted recipe fixture with a known hard technique (`temper`) in step 3 of 5.
2. Read it back via `findById`.
3. Inspect `recipe_steps.difficulty` ordered by position and the recipe columns.
**Expected Outcomes:** Step 3 difficulty = 5, others per the table; `difficulty_band` = advanced;
`RecipeDetail.difficulty.stepDifficulties[2] = 5`; `T = 1.0`.

### Test Case 2: Section-label alignment (integration)
**Preconditions:** As above.
**Steps:** Persist a fixture whose `steps` include "For the sauce:" between two real steps.
**Expected Outcomes:** The label is absent from `recipe_steps`; the two real steps keep their correct
difficulties in the correct positions; `S` counts only stored steps.

### Test Case 3: Best-effort on scorer failure (integration)
**Preconditions:** Stub `DifficultyScorer` to throw for one recipe.
**Steps:** Run the persist path.
**Expected Outcomes:** Recipe persists with null difficulty (recipe + all steps), import reaches
`ready`, one `outcome=error`-style log line (or null-score line) emitted.

### Test Case 4: Replay idempotency (integration)
**Preconditions:** As TC1.
**Steps:** Persist the same recipe twice in the replay-safe path.
**Expected Outcomes:** Identical difficulty values; no duplicate step/recipe rows.

### Test Case 5: Unit — toRecipeInput attaches difficulty
**Preconditions:** Stub/real scorer.
**Steps:** Call `toRecipeInput` on extracted data with a section-label step.
**Expected Outcomes:** `RecipeInput.difficulty.stepDifficulties.length === RecipeInput.steps.length`;
values align to the stripped steps.

## Deployment Strategy

Direct deploy after WI-DIFF-1 (migration) is live. Best-effort enrichment — a scoring error never
fails an import. New recipes get difficulty going forward; existing recipes stay null until an optional
offline backfill (deferred, see design doc). Rollback: revert the writer; columns go inert.

## Production Verification

### Production Verification 1: Live import scores
**Preconditions:** Deployed; a real import run (see `/harvest-ingest-verify`).
**Steps:** Import a known recipe with an advanced technique; read `GET` / DB.
**Expected Outcomes:** Recipe has a plausible `difficulty_score`/`band`; the hard step carries the high
per-step weight; band distribution across a handful of imports isn't collapsed to one band.
