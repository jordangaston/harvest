# WI-DIFF-2 — Difficulty scoring engine (pure)

## Background

The heart of the difficulty signal: the reference table, the per-step lexicon matcher, and the
recipe-level scorer. Per the design (`docs/design-recipe-difficulty-signal.md`, O-DIFF-01/02/03) this
is **deterministic** — no LLM, no network, no DB. All domain knowledge lives in a curated code
constant (the `VOCAB`/`KEYWORD_DICT` precedent from `server/src/categorize/`), and matching it is a
compiled string scan. This module is pure and fully unit-testable in isolation; WI-DIFF-3 wires it into
persistence.

Definitions:
- **Per-step difficulty** — the weight (1–5) of the hardest cooking technique named in a step's text;
  baseline 1 when none is recognized.
- **Recipe raw score** — `100 × mean(T, S, N, [M])`, each factor normalized to [0,1] against a cap.
  `T = max(step difficulty)/5`, `S = min(steps,STEP_CAP)/STEP_CAP`, `N = min(ings,ING_CAP)/ING_CAP`,
  `M = min(minutes,TIME_CAP)/TIME_CAP` (dropped from the mean when minutes is null).
- **Band** — `beginner` (`raw < C50`), `intermediate` (`C50 ≤ raw < C85`), `advanced` (`raw ≥ C85`).

## Objective

Create `server/src/difficulty/` with:
1. `technique-difficulty.ts` — `TECHNIQUE_DIFFICULTY` (array of `{ canonical, weight: 1..5, forms: string[] }`)
   and `DIFFICULTY_CONFIG` (`STEP_CAP`, `ING_CAP`, `TIME_CAP`, `C50`, `C85`).
2. `technique-matcher.ts` — `TechniqueMatcher` with `stepWeights(steps: string[]): number[]` (one 1–5
   weight per step, index-aligned), backed by a regex compiled once from all `forms`.
3. `difficulty-scorer.ts` — `DifficultyScorer` with
   `score(steps: string[], ingredientCount: number, totalMinutes: number | null): RecipeDifficulty`
   returning `{ score, band, stepDifficulties }` (`RecipeDifficulty` is the shared type WI-DIFF-3 persists).
4. Unit tests covering O-DIFF-01/02/03 and every worked example / edge case below.

`[ASSUMPTION: DifficultyScorer.score takes ingredientCount (a number), not the ingredient objects — it only needs N. The caller (WI-DIFF-3) passes recipe.ingredients.length.]`

## Acceptance Criteria

1. **Table shape.** Given `TECHNIQUE_DIFFICULTY`, when I inspect it, then every entry has a `canonical`
   string, an integer `weight` in 1..5, and a non-empty `forms` string array; all forms are lowercase;
   the list has ~40–60 entries spanning weights 1–5. `[ASSUMPTION: ship a defensible provisional list (Q-01); it will be tuned by a cooking-literate pass. Include at minimum: temper, laminate, bain-marie/water bath, confit (5); emulsify, caramelize, proof, deglaze-to-pan-sauce (4); sear, deglaze, reduce, blanch, braise, poach, fold (3); sauté, chop, dice, mince, whisk, knead (2); boil, simmer, toss, combine, mix, stir, season, serve, bake (1).]`
2. **Per-step: hardest technique wins.** Given a step "Temper the chocolate over a bain-marie, stirring.",
   when scored, then its weight is 5 (max of temper=5, bain-marie=5, stir=1).
3. **Per-step: baseline.** Given a step with no recognized technique ("Season and serve."), when scored,
   then its weight is 1.
4. **Word boundaries.** Given a step "Search the pantry and add a scallion.", when scored, then neither
   `sear` nor `scald` fires; weight is 1 (or only a legitimately-present technique's weight).
5. **Multi-word + hyphen/space normalization.** Given "Cook sous-vide" and "Cook sous vide", when
   scored, then both match the `sous vide` form and yield the same weight.
6. **Index alignment.** Given N steps, when `stepWeights` runs, then it returns exactly N weights,
   `result[i]` corresponding to `steps[i]`.
7. **Recipe T = peak.** Given steps with per-step weights `[5,2,1]`, when scored, then `T = 5/5 = 1.0`
   and `stepDifficulties = [5,2,1]`.
8. **Raw score blend.** Given `T=1.0`, `steps=6`, `ingredients=9`, `minutes=45` with caps
   `{15,20,120}`, when scored, then `raw = 100 × mean(1.0, 6/15, 9/20, 45/120) = 55.6` (±0.1).
9. **Missing time drops M.** Given `minutes=null`, when scored, then `raw = 100 × mean(T,S,N)` (three
   terms), not zero-filled.
10. **Bands at cutoffs.** Given cutoffs `{C50,C85}`, when the raw score equals `C50`, then band is
    `intermediate` (inclusive lower); equals `C85` → `advanced`; just below `C85` → `intermediate`;
    below `C50` → `beginner`.
11. **Empty recipe.** Given zero steps and zero ingredients (minutes null), when scored, then
    `raw = 0`, band `beginner`, `stepDifficulties = []`.
12. **Determinism.** Given the same inputs, when scored twice, then the results are identical.
13. **Tests green.** All new unit tests pass and the existing suite stays green.

## Test Cases

### Test Case 1: TechniqueMatcher.stepWeights (O-DIFF-01)
**Preconditions:** Module built; real `TECHNIQUE_DIFFICULTY`.
**Steps:** Call `stepWeights` with the AC-2..AC-6 step arrays.
**Expected Outcomes:** Weights match AC-2 (5), AC-3 (1), AC-4 (no false fire), AC-5 (equal), AC-6
(length + alignment). Assert the compiled regex is built once (matcher is constructed once, reused).

### Test Case 2: DifficultyScorer.score — blend & degradation (O-DIFF-02)
**Preconditions:** Real `DIFFICULTY_CONFIG` (provisional caps).
**Steps:** Score the AC-7, AC-8, AC-9, AC-11 fixtures.
**Expected Outcomes:** `T`, `raw`, `stepDifficulties`, and the M-drop behavior match; empty recipe → 0.

### Test Case 3: Band bucketing at boundaries (O-DIFF-03)
**Preconditions:** Known `C50`, `C85`.
**Steps:** Score fixtures engineered to land exactly on/around each cutoff.
**Expected Outcomes:** Inclusive-lower banding per AC-10.

### Test Case 4: Headline behaviors (from the design)
**Preconditions:** Real constants.
**Steps:** Score (a) a recipe with one `temper` step amid trivial steps; (b) a 22-step recipe where
every step is trivial (`chop`/`toss`/`bake`).
**Expected Outcomes:** (a) `T = 1.0` (peak, not mean) → high band; (b) low `T`, high `S` → lands
`intermediate`, not `beginner` (the hypothesis failure mode the design fixes).

## Deployment Strategy

Pure code, no runtime surface until WI-DIFF-3 calls it. Ships dark. No flag needed — nothing invokes
it yet. The provisional `TECHNIQUE_DIFFICULTY`/`DIFFICULTY_CONFIG` values are tunable in code
(Q-01/Q-02) and by calibration later.

## Production Verification

### Production Verification 1: Deterministic scores
**Preconditions:** Module deployed (still unwired).
**Steps:** N/A in prod until WI-DIFF-3; covered by unit tests. Reads no external state, so nothing to
verify live in isolation.
**Expected Outcomes:** —
