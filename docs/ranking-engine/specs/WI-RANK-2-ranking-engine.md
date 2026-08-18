# WI-RANK-2 — The RankingEngine (filters, scorers, combination)

> Part 2 of 3 for the ranking engine. See `docs/ranking-engine/DESIGN.md`.
> Depends on: WI-RANK-1 (the `UserPreferences` model). Blocks: WI-RANK-3.

## Background

With preferences persisted (WI-RANK-1), this work item builds the scoring core: a **pure, no-I/O**
module that takes an array of recipes-with-signals plus a `UserPreferences` and returns them ranked.
Purity keeps it exhaustively unit-testable and matches the repo's "hand-wire, classes with
`static create()`" style. Data loading and HTTP live in WI-RANK-3.

The algorithm (full detail in `DESIGN.md` §§ Ranking Algorithm, Use Case Implementations) is
**filter-then-rank**: hard filters drop recipes, then a weighted average of six normalized soft-signal
scores ranks the survivors, minus soft penalties, then a deterministic tie-break.

## Objective

Implement `RankingEngine.rank(recipes, preferences): RankedRecipe[]` in `server/src/ranking/`, composed
of a `FilterRule[]` registry (allergen + diet gates) and a `SignalScorer[]` registry (six soft
signals), plus normalization constants, soft-penalty application, and tie-breaking — reproducing the
worked example in `DESIGN.md` exactly.

## Acceptance Criteria

Define a typed input the engine consumes (WI-RANK-3 populates it from the DB):

```ts
type RankableRecipe = {
  id: string;
  createdAt: Date;
  costPerServingCents: number | null;
  difficultyBand: 'beginner' | 'intermediate' | 'advanced' | null;
  nrfScore: number | null;
  totalMinutes: number | null;
  categories: { cuisine: string[]; dishType: string[]; primaryIngredient: string[] };
  allergens: { contains: string[]; mayContain: string[]; complete: boolean };
  dietFit: Record<string, 'compatible' | 'incompatible' | 'unknown'>;
  popularity: number | null; // always null until the signal ships
};
type RankedRecipe = { recipeId: string; score: number; breakdown: Record<string, number> };
```

1. **Hard filters (O-01).** A `FilterRule` interface `{ excludes(recipe, prefs): boolean }` with two
   implementations, applied before scoring; a recipe excluded by any rule is dropped:
   - `AllergenFilter`: for each `prefs.allergens` entry — `severe` excludes if the recipe `contains`
     **or** `mayContain` the allergen **or** `allergens.complete === false`; `moderate` excludes if
     `contains`; `mild` never excludes.
   - `DietFilter`: for each `prefs.diets` entry — `strict` excludes if that diet's verdict is
     `incompatible` (`unknown` is kept); `flexible` never excludes.

2. **Soft-signal normalization (O-02).** A `SignalScorer` interface
   `{ key: string; weight(prefs): number; score(recipe, prefs): number | null }`, six implementations,
   each returning `s ∈ [0,1]` or `null` when the recipe lacks that signal's data:
   - `cost`: `clamp((2·budget − cost)/budget, 0, 1)`; null if `costPerServingCents` or `budget` is null.
   - `difficulty`: signed distance `d = bandRank(recipe) − skillRank(prefs)`; lookup `{-2:0.70, -1:0.85, 0:1.00, 1:0.60, 2:0.20}`; null if `difficultyBand` null.
   - `nutrition`: `x⁺/(x⁺ + 57)` where `x⁺ = max(0, nrfScore)`, `k = 57` (config constant `NUTRITION_K`); null if `nrfScore` null.
   - `affinity`: per facet present, `a_f = +1` if the recipe shares a liked value, `−1` if it shares a disliked value and no liked, else `0`; `clamp(0.5 + 0.5·mean(a_f), 0, 1)`; null if the recipe has no categories at all.
   - `time`: `clamp((2·T − totalMinutes)/T, 0, 1)`; null if `totalMinutes` or `T` null.
   - `popularity`: **always returns `null`** in this work item (registered so the fold already accounts
     for it; shipping it later is one code change, no engine rewrite).
   - Constants (`NUTRITION_K = 57`, the difficulty lookup, the budget `2×` slope) live in
     `server/src/ranking/constants.ts` with a comment that they are tunable / to be recalibrated from data.

3. **Combination.** `score = Σ wᵢ·sᵢ / Σ wᵢ` over signals where `sᵢ ≠ null` **and** `wᵢ > 0`. If that
   set is empty, `score = 0`. `breakdown` records each contributing signal's `sᵢ`.

4. **Soft penalties.** After the average, subtract and floor at 0: `−0.15` if the recipe `contains` a
   `mild`-severity allergen; `−0.20` for a `flexible` diet with `incompatible` verdict; `−0.05` for any
   diet (strict or flexible) with `unknown` verdict. Additive/stacking. (Constants in `constants.ts`.)

5. **Tie-breaking.** Sort by `score` desc, then: higher signal coverage (`|available|`) desc, then
   `popularity` desc (null treated as `-∞`, a no-op today), then `createdAt` desc, then `id` asc.

6. **Worked-example regression.** A test reproduces `DESIGN.md` § Worked example: user Alice, recipes
   R1/R2/R3. Asserts R2 is filtered (peanut/severe), and the survivors score **R1 = 81.7** and
   **R3 = 71.2** (i.e. `round(score·100, 1)`), with R1 ranked first.

7. **Engine is pure.** `RankingEngine` imports no `db`/repository/HTTP. `RankingEngine.rank` is a pure
   function of its arguments. A `static create()` returns an engine wired with the default registries.

## Test Cases

Unit tests in `server/test/ranking-engine.test.ts` (no DB — plain object fixtures). A
`rankableRecipe(overrides)` factory and a `preferences(overrides)` factory keep cases terse.

### Test Case 1: Each scorer's normalization, including boundaries
**Steps:** Call each scorer directly with boundary inputs.
**Expected Outcomes:** cost at budget → 1.0, at 2×budget → 0.0, under budget → clamped 1.0, null → null.
time symmetric to cost. difficulty: match → 1.0, one-easier → 0.85, two-harder → 0.20, null band → null.
nutrition: `x=0 → 0.0`, `x=57 → 0.5`, `x=250 → 250/307 ≈ 0.814`, negative nrf → 0.0, null → null.
affinity: all-liked → 1.0, all-neutral → 0.5, all-disliked → 0.0, no categories → null.
popularity: always null.

### Test Case 2: Allergen filter matrix
**Steps:** For a recipe that `contains` peanut, and one that only `mayContain` peanut, and one where
`complete=false`, run `AllergenFilter.excludes` for severities severe/moderate/mild.
**Expected Outcomes:** severe excludes all three; moderate excludes only the `contains` one; mild
excludes none.

### Test Case 3: Diet filter matrix
**Steps:** Recipe with diet verdict `incompatible`, and one `unknown`, against `strict` and `flexible`.
**Expected Outcomes:** strict excludes `incompatible`, keeps `unknown`; flexible excludes neither.

### Test Case 4: Combination drops nulls; empty set → 0
**Preconditions:** Recipe with `nrfScore = null` (nutrition unavailable), all other signals present;
prefs weights all 1.
**Steps:** `rank([recipe], prefs)`.
**Expected Outcomes:** Denominator excludes nutrition (divides by 4 available weights, not 5); a recipe
with every soft signal null scores exactly 0.

### Test Case 5: Soft penalties stack and floor
**Preconditions:** Recipe that `contains` a `mild` allergen and is `incompatible` with a `flexible`
diet.
**Steps:** `rank(...)`.
**Expected Outcomes:** Final score = `max(0, average − 0.15 − 0.20)`; a low average floors at 0, never
negative.

### Test Case 6: Tie-break ordering
**Preconditions:** Two recipes with identical scores but different coverage / createdAt.
**Steps:** `rank(...)`.
**Expected Outcomes:** Higher-coverage recipe ranks first; if coverage equal, newer `createdAt` first;
final fallback `id` ascending.

### Test Case 7: Worked-example regression
**Preconditions:** The Alice fixture and R1/R2/R3 from `DESIGN.md`.
**Steps:** `rank([R1,R2,R3], alice)`.
**Expected Outcomes:** Result excludes R2; order `[R1, R3]`; `round(R1.score·100,1) === 81.7`,
`round(R3.score·100,1) === 71.2`.

## Test Run
_To be filled in: `npm test -- ranking-engine` output, pass/fail per case._

## Deployment Strategy

Pure code, no migration, no runtime surface of its own — nothing calls it until WI-RANK-3. Ships as an
ordinary code change. Rollback = revert the code.

## Production Verification

No production surface in this work item (the engine is invoked only through WI-RANK-3's endpoint).
Correctness is fully covered by the unit tests above, including the worked-example regression. Verify
in prod via WI-RANK-3.

## Production Verification Run
_N/A — verified through WI-RANK-3._
