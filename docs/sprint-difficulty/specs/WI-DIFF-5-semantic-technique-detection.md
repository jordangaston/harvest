# WI-DIFF-5 — Semantic per-step technique detection (LLM primary, keyword fallback)

## Background

Live verification (Gimme Delicious "20-minute Butter Chicken") exposed the keyword detector's recall
ceiling: the recipe sautés ("cook onions down until lightly golden") and reduces a sauce ("simmer…
stirring occasionally") but names neither, so every step scored baseline (`T = 1/5`) and the band was
decided entirely by counts. See the revised design decision "Semantic technique *detection* (LLM),
deterministic technique *scoring*" in `docs/design-recipe-difficulty-signal.md`.

The fix keeps the difficulty **model** (technique→weight table, additive blend, percentile bands) and
replaces the **detector**: an LLM reads each step and returns the techniques it uses, constrained to
the `TECHNIQUE_DIFFICULTY` canonical names — riding the existing taste-classifier call (~0 new network
cost). The keyword scan (`TechniqueMatcher`) becomes the offline/no-key fallback, exactly like
`selectTasteClassifier` picks Luna-or-stub. Detection output (per-step technique names) is persisted so
re-weighting the table never needs a re-call.

Depends on WI-DIFF-1..4 (already implemented). This work item modifies them.

## Objective

1. **Vocabulary.** Export `TECHNIQUE_NAMES` (the canonical names from `TECHNIQUE_DIFFICULTY`) for the
   LLM constraint and validation.
2. **Extend the taste LLM call to also detect per-step techniques.** The one OpenAI call the taste
   classifier already makes gains the recipe's steps in its prompt and returns, per step, the
   techniques used — constrained to `TECHNIQUE_NAMES` (unknowns dropped, like taste's VOCAB filter).
   Model it as one call, two typed outputs: `{ taste: TasteFacets; stepTechniques: string[][] }`
   (`stepTechniques[i]` aligned to `steps[i]`). Keep the offline stub (returns empty taste + no
   stepTechniques). `[ASSUMPTION: fold into the taste classifier rather than a second LLM call, per the chosen approach ("rides the taste call"); rename the class if that reads cleaner (e.g. RecipeAnalyzer), keeping selectTasteClassifier's env-based Luna/stub selection and the OPENAI_API_KEY seam.]`
3. **Carry detections to persist.** `ExtractedRecipeData` gains `stepTechniques?: string[][]` (aligned
   to `data.steps`), populated by the categorize step (which now also passes `recipe.steps` to the
   classifier). Absent when the LLM is off.
4. **Lockstep strip + map.** In `toRecipeInput`, when `stepTechniques` is present, strip it in lockstep
   with the section-label step strip so it stays aligned to the final `steps`. `DifficultyScorer.score`
   gains an optional per-step technique list: when present, each step's weight =
   `max(TECHNIQUE_DIFFICULTY[t])` over its techniques (baseline 1 if empty); when absent, fall back to
   the existing `TechniqueMatcher` keyword scan over the final step text. Blend + bands unchanged.
5. **Persist the atom.** Add `recipe_steps.techniques` (JSON text, nullable) — the detected canonical
   names per step. Keep `recipe_steps.difficulty` (the derived weight), written in the same transaction
   from the same techniques. Additive migration (no drop → no interactive codegen prompt).
   `RecipeDetail` exposes `stepTechniques` alongside `stepDifficulties`.
6. Tests: fallback path (no LLM → keyword scan, unchanged behavior), LLM path (stubbed stepTechniques),
   lockstep-strip alignment, and the butter-chicken fixture proving the fix.

## Acceptance Criteria

1. **LLM detection maps correctly.** Given a step whose detected techniques are `["saute","reduce"]`
   with table weights 2 and 3, when scored, then that step's weight is 3 and its `recipe_steps.techniques`
   row is `["saute","reduce"]`.
2. **Butter-chicken fix (the whole point).** Given the three real butter-chicken steps and a detector
   that returns `["saute"]` for step 1 and `["simmer","reduce"]` for step 3 (what a competent model
   yields), when scored, then `T ≥ 3/5` (not `1/5`), i.e. the recipe reflects its real technique.
3. **Constraint to vocab.** Given the LLM returns a technique not in `TECHNIQUE_NAMES`, when parsed,
   then it is dropped (never persisted or weighted), mirroring the taste VOCAB filter.
4. **Fallback unchanged.** Given no LLM key (stub), when a recipe is scored, then detection falls back
   to the keyword `TechniqueMatcher` over the final steps and the WI-DIFF-2 behavior is exactly
   preserved (existing difficulty tests still pass).
5. **Lockstep alignment.** Given a source with a bare section-label step that `stripSectionLabels`
   drops, when `stepTechniques` is present, then after the strip `stepTechniques` and `steps` are the
   same length and aligned; the dropped label carries no technique row.
6. **Atom persisted + re-mappable.** Given a scored recipe, when read back, then each
   `recipe_steps.techniques` holds the detected names and `recipe_steps.difficulty` equals
   `max(TECHNIQUE_DIFFICULTY[t])` over them; recomputing the score from stored `techniques` + the table
   (no LLM) reproduces the recipe's `difficulty_score`.
7. **Best-effort.** Given the LLM errors mid-detection, when the recipe persists, then detection
   degrades to the keyword fallback (or empty → baseline), taste still resolves, and the import reaches
   `ready` — no import failure.
8. **Suite green.** New + existing tests and typecheck pass.

## Test Cases

### Test Case 1: Scorer maps supplied techniques (unit)
**Preconditions:** Real `TECHNIQUE_DIFFICULTY`.
**Steps:** Call `DifficultyScorer.score(steps, stepTechniques, ingCount, minutes)` with
`stepTechniques = [["saute"],["boil"],["temper"]]`.
**Expected Outcomes:** per-step weights `[2,1,5]`; `T = 1.0`; band advanced.

### Test Case 2: Butter-chicken fixture (unit)
**Preconditions:** The three real steps; a stub detector returning `[["saute"],[],["simmer","reduce"]]`.
**Steps:** Score with ingredientCount 15, minutes 20.
**Expected Outcomes:** `T = max(2,1,3)/5 = 3/5 = 0.6`; raw and band reflect the technique (higher than
the keyword-only 32.9/beginner — assert `T` is 0.6 not 0.2, and record the resulting band).

### Test Case 3: Fallback equals WI-DIFF-2 (unit)
**Preconditions:** No `stepTechniques`.
**Steps:** Score the WI-DIFF-2 fixtures.
**Expected Outcomes:** Identical to WI-DIFF-2 (keyword path); all prior difficulty tests pass unchanged.

### Test Case 4: Lockstep strip (unit)
**Preconditions:** `steps=["For the sauce:","Sauté the onion.","Simmer."]`,
`stepTechniques=[[],["saute"],["simmer"]]`.
**Steps:** Run `toRecipeInput`.
**Expected Outcomes:** final `steps` length 2, `stepTechniques` length 2 aligned
(`[["saute"],["simmer"]]`).

### Test Case 5: Persist + re-map (integration)
**Preconditions:** libSQL test db; a recipe with known stepTechniques.
**Steps:** Persist; read `recipe_steps.techniques` + `difficulty`; recompute score from stored
techniques + table.
**Expected Outcomes:** techniques stored per step; `difficulty = max(table)`; recomputed score ==
stored `difficulty_score`.

### Test Case 6: Vocab constraint + best-effort (unit)
**Preconditions:** Stub classifier returns an out-of-vocab technique / throws.
**Steps:** Parse / score.
**Expected Outcomes:** out-of-vocab dropped; on throw, falls back and the recipe still scores + persists.

## Deployment Strategy

Direct deploy after WI-DIFF-1..4. Additive migration (`recipe_steps.techniques`). The LLM path
activates only where the taste LLM is configured; everywhere else the keyword fallback runs, so
behavior is safe by default. **Env note:** the taste seam reads `OPENAI_API_KEY`, but this repo's
`.env` names it `OPENAI_KEY` (known gotcha — see project memory), so live technique detection needs
that env var corrected; offline/tests use the fallback. Rollback: revert the writer; the column is
inert.

## Production Verification

### Production Verification 1: Butter chicken, live
**Preconditions:** Deployed with a working taste LLM key; import the butter-chicken URL.
**Steps:** Read `recipe_steps.techniques` and `difficulty_score`/`band`.
**Expected Outcomes:** Step 1 techniques include `saute`, step 3 includes `simmer`/`reduce`; `T`
reflects them (not `1/5`); the recipe no longer scores artificially low for lack of named techniques.
