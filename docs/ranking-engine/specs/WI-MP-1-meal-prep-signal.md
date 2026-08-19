# WI-MP-1 — Meal-prep suitability signal (#10)

> The tenth ranking signal. See `docs/ranking-engine/MEAL-PREP-SIGNAL.md` (full design) and the parent
> `docs/ranking-engine/DESIGN.md` (§ Ranking Algorithm, § Cold start).
> Depends on: the merged ranking engine (WI-RANK-1..4 — `UserPreferences` model, `SignalScorer`
> registry, `PreferenceRepository`, `RankableRecipe` assembly). Blocks: nothing.

## Background

Some recipes are built for meal prep — batch-cooked, portioned, they keep and reheat for days. Some
users want exactly that. Meal-prep suitability is a **pure weighted soft signal** (a boost, never a
filter): a normalized per-recipe score `s ∈ [0,1]` multiplied by a per-user weight in the same
weighted average the other soft signals feed (`DESIGN.md` § Ranking Algorithm). A romantic-dinner
recipe is never hidden — it just shouldn't top the deck of someone stocking the fridge for the week.

Per-recipe fit is a **three-band ordinal classification** (LLMs classify more reliably than they
fine-grained-score, mirroring the `difficulty_band` precedent):

| `meal_prep_fit` | Means | Score `s` |
| --- | --- | --- |
| `designed` | Built for it — batch quantities, "make-ahead", stores/freezes, portioned | **1.00** |
| `suitable` | Works fine prepped — stews, curries, grain bowls, roasts that keep | **0.60** |
| `unsuitable` | Degrades — fried/crispy, delicate, eat-immediately, single-serving | **0.15** |

`null` (unscored) → the signal is *unavailable* and drops out of the weighted average, like any soft
signal with missing data. The score map is a calibration knob (config, tunable). The signal has the
cleanest cold-start hook of any: the `meal_prepping` onboarding goal already exists on `users.goals`,
so it seeds the weight directly — exactly like `save_money → weight_cost`.

Stack facts (verified against the repo):
- Drizzle + libSQL/Turso. Schema in `server/src/schema.ts`; enums are `text('col', { enum: TUPLE })`.
  `DIFFICULTY_BANDS` and the `recipes.difficulty_band` / `recipes.difficulty_score` columns are the
  precedent to mirror for the new fit column.
- Migrations: `npm run db:generate` (drizzle-kit generate → `server/drizzle/`) then `npm run db:migrate`.
- Soft signals implement `SignalScorer` (`key`, `weight(prefs)`, `score(recipe, prefs)`) in
  `server/src/ranking/scorers.ts`, registered in `RankingEngine.create()`
  (`server/src/ranking/ranking-engine.ts`). The fold in `scoreRecipe` already skips `null` scores and
  `weight <= 0`, so a null-fit recipe or a zero-weight user needs no special-casing.
- `RankableRecipe` (`server/src/ranking/types.ts`) is assembled in
  `RecipeRepository.assembleRankable`; per-recipe columns are read via `RecipeSchema.parse(row)`.
- Detection rides the existing one-LLM-call `RecipeAnalyzer` (`server/src/categorize/taste-classifier.ts`)
  used by `RecipeCategorizer` (`server/src/categorize/recipe-categorizer.ts`) in the import workflow's
  `categorizeStep` — **not** its own workflow step (design § Detection, Q-MP3: reuse-first). Best-effort:
  a failure/off-enum band falls back to a deterministic heuristic, never fails the import.
- The single persist chokepoint is `toRecipeInput` (`server/src/parse/mapping.ts`) → `RecipeInput` →
  `RecipeRepository.insertRecipe`.
- Cold-start defaults live in `PreferenceRepository.coldStartRow` (goal → weight map). The resolved
  `weights` snapshot is also captured on each swipe (`RecipeSwipeSchema.weights`).
- Unit tests: pure engine tests in `server/test/ranking-engine.test.ts`; cold-start in
  `server/test/preference-repository.test.ts`; detection in `server/test/recipe-categorizer.test.ts`
  (offline `StubRecipeAnalyzer`). Integration DB tests use `migratedFileDb()`.

## Objective

Add meal-prep suitability as the tenth ranking signal, end to end: a `recipes.meal_prep_fit` enum
column and a `user_preferences.weight_meal_prep` weight column (with migration); a `MealPrepScorer`
in the soft-signal registry; LLM-primary band detection (with a deterministic heuristic fallback)
riding the existing categorizer call at import; and cold-start seeding of `weight_meal_prep` from the
`meal_prepping` goal. No new tables, no filter.

## Acceptance Criteria

1. **Schema — two additive columns.** A new migration in `server/drizzle/` adds:
   - `recipes.meal_prep_fit` — `text('meal_prep_fit', { enum: MEAL_PREP_FITS })`, nullable (null until
     scored at import).
   - `user_preferences.weight_meal_prep` — `integer` not null default `1` (0–3; the neutral baseline,
     matching the five default-1 weights — design Q-MP1 ships `1`).
   - `MEAL_PREP_FITS = ['unsuitable','suitable','designed'] as const` is exported from `schema.ts`
     (a schema tuple like `DIFFICULTY_BANDS`), plus `type MealPrepFit`.
   - `npm run db:generate` produces the SQL with no unrelated diffs; `migratedFileDb()` applies the
     full journal cleanly.

2. **Domain model folds in the weight and fit.** `UserPreferencesSchema.weights`
   (`server/src/models/user-preferences.ts`) gains `mealPrep: z.number().int().min(0).max(3)`.
   `RecipeSchema` (`server/src/models/recipe.ts`) gains `mealPrepFit: z.enum(MEAL_PREP_FITS).nullable()`.
   `RankableRecipe` gains `mealPrepFit: MealPrepFit | null`, populated in `assembleRankable`.

3. **`MealPrepScorer` implements `SignalScorer` and is registered.** In
   `server/src/ranking/scorers.ts`: `key = 'mealPrep'`; `weight(prefs) = prefs.weights.mealPrep`;
   `score(recipe) = MEAL_PREP_SCORE[recipe.mealPrepFit]` — `{ designed: 1.0, suitable: 0.6,
   unsuitable: 0.15 }` — or `null` when `mealPrepFit` is null (no normalization step; the band map
   already yields `s ∈ [0,1]`). The score map lives in `server/src/ranking/constants.ts` (a tunable
   knob). The scorer is added to the `RankingEngine.create()` registry array. A null-fit recipe drops
   the signal from the weighted average via the existing `s === null` skip.

4. **Cold-start seeds the weight from the goal.** `PreferenceRepository.coldStartRow` sets
   `weightMealPrep = goals.includes('meal_prepping') ? 3 : 1`, extending the existing goal→weight map
   (`save_money → cost`, `eat_healthier → nutrition`). `getPreferences` (stored-row path) and the
   cold-start path both fold `weights.mealPrep` into the resolved `UserPreferences`. `WEIGHT_COLUMN`
   gains `mealPrep: 'weightMealPrep'` so the swipe-driven `bumpWeight` path works unchanged.

5. **Detection rides the categorizer, LLM-primary with a heuristic fallback.**
   - `RecipeAnalyzer` (`taste-classifier.ts`) emits `mealPrepFit: MealPrepFit | null` from the same
     one LLM call: the system prompt asks for the band constrained to the three values; `constrain()`
     validates the model's output to the enum (off-enum / missing → `null`). `StubRecipeAnalyzer`
     (offline double) returns `null`.
   - `RecipeCategorizer.analyze(...)` returns a `mealPrepFit` on its result: the LLM band when present,
     else a **deterministic heuristic** from the structured cues — dish type in the keeps-well set
     (`soup`, `stew`, `bowl`, `casserole`, `curry`) **and** servings ≥ threshold → `suitable`, else
     `unsuitable`; **never `designed`** (explicit intent needs the model). The categorizer takes the
     recipe's servings for the heuristic.
   - The import workflow's `categorizeOne` threads `mealPrepFit` onto `ExtractedRecipeData`; the persist
     chokepoint (`toRecipeInput` → `RecipeInput.mealPrepFit` → `insertRecipe`) writes
     `recipes.meal_prep_fit`. A categorizer failure leaves the recipe uncategorized (fit stays null),
     never failing an import — the existing best-effort posture.

6. **Weighted-average contribution is correct.** For a meal-prepper (`weight_meal_prep = 3`, other
   weights per Alice, `Σw = 14`), holding the five other soft signals equal at `s = 0.7`: a `designed`
   recipe scores `(3·1.00 + 11·0.7)/14 = 0.764`; an `unsuitable` one `(3·0.15 + 11·0.7)/14 = 0.582` —
   an ~18-point swing. At `weight_meal_prep = 1` the same two sit ~4 points apart.

7. **Green.** From `server/`: `npm test` fully green and `npm run typecheck` clean. Existing worked
   example (`ranking-engine.test.ts` TC7, `ranked-recipes.test.ts`) is unchanged — those recipes have
   null `meal_prep_fit`, so the new signal drops out and prior scores hold.

## Test Cases

### Test Case 1: Migration applies; columns present with correct defaults
**Preconditions:** Fresh `migratedFileDb()`.
**Steps:** Insert a recipe with no `meal_prep_fit`; insert a `user_preferences` row with no
`weight_meal_prep`. Read both back.
**Expected Outcomes:** `recipes.meal_prep_fit` is `null`; `user_preferences.weight_meal_prep` is `1`.
Inserting a recipe with `meal_prep_fit = 'designed'` round-trips. `npm run db:generate` yields one new
migration with only the two additive column statements.

### Test Case 2: MealPrepScorer band map and null handling
**Preconditions:** None (pure unit test in `ranking-engine.test.ts`).
**Steps:** Construct a `MealPrepScorer`; score recipes with each `mealPrepFit` value and `null`; read
`weight(prefs)` for a preferences object with `weights.mealPrep = 2`.
**Expected Outcomes:** `score` → `1.0` for `designed`, `0.6` for `suitable`, `0.15` for `unsuitable`,
`null` for `null` fit. `weight(prefs) === 2`.

### Test Case 3: Weighted-average contribution (worked example)
**Preconditions:** `RankingEngine.create()`; a meal-prepper preferences object with
`weights.mealPrep = 3` and the other five soft weights per Alice; two recipes identical except
`meal_prep_fit` (`designed` vs `unsuitable`), with the other five signals arranged to each score `0.7`.
**Steps:** `engine.rank([designed, unsuitable], prefs)`.
**Expected Outcomes:** The `designed` recipe scores ≈ `0.764` and the `unsuitable` one ≈ `0.582`
(≈18-point gap). Repeating with `weights.mealPrep = 1` yields a ~4-point gap. `breakdown.mealPrep`
equals the band score for each; a recipe with `meal_prep_fit = null` has no `mealPrep` key in its
breakdown.

### Test Case 4: Cold-start seeds weight_meal_prep from the goal
**Preconditions:** `migratedFileDb()`; a user with `goals: ['meal_prepping']` and no preferences row;
a second user with `goals: null`.
**Steps:** `PreferenceRepository.create(db).getPreferences(userId)` for each.
**Expected Outcomes:** The `meal_prepping` user resolves `weights.mealPrep === 3`; the no-goals user
resolves `weights.mealPrep === 1`. The full weights object equals
`{ cost, difficulty, nutrition, affinity, time, popularity, mealPrep }` with the expected values.

### Test Case 5: Detection — enum validation and heuristic fallback
**Preconditions:** `RecipeCategorizer` wired with `StubRecipeAnalyzer` (offline; LLM band always null).
**Steps:**
1. Analyze a recipe whose resolved `dishType` includes `stew` with servings `8`.
2. Analyze a recipe whose `dishType` is `salad` (or empty) with servings `2`.
3. (Analyzer-level) Feed `constrain()` a JSON payload with `mealPrepFit: "batch"` (off-enum) and one
   with `mealPrepFit: "designed"`.
**Expected Outcomes:** (1) heuristic → `suitable`; (2) heuristic → `unsuitable`; never `designed` on the
fallback path. (3) off-enum → `null`; a valid band → that band. A thrown analyzer degrades to a null
band (fit falls to the heuristic), never throwing out of `analyze`.

### Test Case 6: Existing worked example unchanged
**Preconditions:** The existing `ranking-engine.test.ts` TC7 and `ranked-recipes.test.ts` worked
example, whose recipes have null `meal_prep_fit`.
**Steps:** Run those tests after adding `mealPrep` to the preferences weights (value irrelevant — fit is
null).
**Expected Outcomes:** Orders and scores (81.7 / 71.2) are byte-for-byte unchanged; the meal-prep
signal drops out of the average for null-fit recipes.

## Test Run
_To be filled in during execution: `npm test` + `npm run typecheck` output, pass/fail per case._

## Deployment Strategy

Two additive columns, no changes to existing columns — backwards-compatible. Order (design § Deployment):
(1) schema migration, (2) code (scorer in the registry, analyzer band output, cold-start seed). The
migration can run before or with the code deploy: old code ignores the new columns; unscored recipes
(`meal_prep_fit = null`) simply omit the signal until a later best-effort backfill re-scores them.
Existing users' `weight_meal_prep` defaults to `1`. No feature flag.

## Production Verification

### Production Verification 1: Columns present; signal contributes for a meal-prepper
**Preconditions:** Migration applied to the Turso production database.
**Steps:** Confirm `recipes.meal_prep_fit` and `user_preferences.weight_meal_prep` exist
(`PRAGMA table_info(...)`). Import a batch-cook recipe (e.g. "High-protein meal-prep bowls") and confirm
its `meal_prep_fit` is set. For a user with the `meal_prepping` goal and no preferences row, hit
`GET /v1/recipes/ranked` and confirm the ranked response includes `mealPrep` in the score breakdown.
**Expected Outcomes:** Both columns exist; the imported batch recipe scores `designed`/`suitable`; the
meal-prepper's ranked deck surfaces batch-friendly recipes above ill-suited ones, with `mealPrep` in
the breakdown.

### Production Verification 2: Detection distribution is not degenerate
**Preconditions:** Several recipes imported post-deploy.
**Steps:** Query the distribution of `recipes.meal_prep_fit` (`designed`/`suitable`/`unsuitable`/null).
**Expected Outcomes:** A spread across bands — everything landing on one band (e.g. all `suitable`)
flags a mis-calibrated classifier or a stuck heuristic (design § Monitoring: `meal_prep_fit_distribution`).

## Production Verification Run
_To be filled in during execution._
