# WI-MP-2 — Meal-planning engine: pure engine core (candidates + MMR fill + repair + batching)

## Background

This is the brain of the meal-planning engine (design: `docs/meal-planning/meal-planning-engine.md`, Option B). It
turns a user's preferences and the recipe corpus into a filled weekly plan, reusing the shipped ranking engine
(`server/src/ranking/*`) as the per-recipe preference score. It has **no I/O** — it takes plain inputs (candidate
pools, slot list, constraints) and returns an assignment — which makes it fully unit-testable and deterministic. All
persistence and HTTP wiring is WI-MP-3's job; all schema is WI-MP-1's.

Depends on WI-MP-1 (models expose `source`, `batchId`, `timeByMeal`). Reuses, unchanged: `RankingEngine`, cookbooks
(`liked`/`saved` system slugs), `recipe_swipes` + `SWIPE_COOLDOWN_DAYS`, `recipe_categories`, `cost_per_serving_cents`,
`meal_prep_fit`, `weekly_meals`, `eats_leftovers`, `users.cook_days_count` / `when_cook` / `goals`.

Key domain terms (defined here so the spec is self-contained):
- **base score** = `tierBonus(tier) + rankingScore(recipe, prefs)`, where tier ∈ {imported, liked, saved, global} and
  `rankingScore ∈ [0,1]` is the existing weighted-signal average. Tier is the **primary** sort key; ranking score
  breaks ties within a tier (Q-02 resolution).
- **MMR** (Maximal Marginal Relevance) = greedy diversity-aware pick:
  `argmax_r [ (1−λ)·base(r) − λ·max_{r' ∈ chosen} sim(r, r') ]`, `sim` = Jaccard overlap on `recipe_categories` facets.
- **leftover/meal-prep batching (P7)** = one keeps-well recipe (`meal_prep_fit ∈ {suitable, designed}`) cooked once and
  assigned to several same-meal slots, triggered by capacity gap or meal-prep intent (design D-05).

## Objective

Implement the pure engine: a `CandidateProvider` that builds tiered/ranked/recency-clean pools per meal-type; a
`SlotFiller` interface with an `MmrFiller` implementation that fills slots by MMR with a familiar:new novelty
portfolio, then a bounded local-search repair for budget/time, then a leftover/meal-prep batching pass; and a
`ScoreAggregator` interface with a `SingleUser` (identity) implementation so households drop in later. Output is a
`PlanAssignment` (per-slot recipe + tier + batch grouping + an objective summary).

## Acceptance Criteria

1. **Candidate tiering.** Given a user's owned/liked/saved recipes plus global recipes for a meal-type, when
   `CandidateProvider.candidates(...)` runs, then each candidate is tagged `imported | liked | saved | global`; a
   recipe that is both imported and liked is tagged `imported` (highest tier wins).
2. **Ranking reuse + hard filters.** Given candidate recipes, then the pool's `base` score uses `RankingEngine.rank`
   verbatim and any recipe the ranking filters exclude (allergen/diet/equipment) never appears in the pool.
3. **Recency exclusion.** Given a recipe served (present in `meal_plan_entries`) within the cooldown window
   (`MEAL_COOLDOWN_DAYS`, propose 14 — Q-03), then it is excluded from the pool.
4. **One recipe per slot, tier-respecting.** Given filled slots, when two candidates tie on ranking score across
   tiers, then the higher tier is chosen; no recipe appears twice in the week unless it is a leftover batch (AC 8).
5. **MMR diversity.** Given a meal-type pool with several near-duplicate recipes (same cuisine + dish_type), when the
   week is filled, then the plan does not stack near-duplicates when a more diverse comparably-scored option exists
   (assert: with λ tuned > 0, the chosen set has strictly lower total pairwise `sim` than the pure-`base` greedy set on
   a constructed pool).
6. **Novelty portfolio.** Given a familiar:new target ratio and both familiar and new candidates available, when the
   week is filled, then the fraction of `familiar=false` picks is within one slot of the target.
7. **Budget repair.** Given a first fill that exceeds `weekly_budget_cents`, when repair runs, then it performs bounded
   swaps that reduce cost while minimizing base-score loss, and the returned `summary.cost_total_cents` is ≤ budget
   whenever a within-budget assignment exists in the pools; if none exists, the plan is returned with the overrun
   reported (never thrown, never emptied).
8. **Leftover/meal-prep batching (P7).** Given `eats_leftovers=true` and Σ planned slots > `cook_days_count` (capacity
   trigger) OR meal-prep intent (`when_cook ∈ {meal_prep, weekly_schedule}` or `meal_prepping` goal — intent trigger),
   when batching runs, then adjacent same-meal slots are merged onto one keeps-well recipe (`meal_prep_fit ∈
   {suitable, designed}`, preferring `designed`) sharing a `batchId`, `servingsMultiplier` set from covered slots ×
   household size, the batched repeat exempt from the anti-repetition rule, bounded by the leftover budget (≤ 40% of a
   meal-type's slots) and max batch span (3 days) — Q-09. Unsuitable recipes are never batched.
9. **Capacity accounting.** Given batching, then distinct cook events (not slots) are counted against
   `cook_days_count`; `cook_days_count = NULL` disables the capacity trigger (Q-07).
10. **Graceful degradation.** Given a meal-type pool smaller than its slot count, when the week is filled, then the
    engine fills what it can and reports `summary.unfilled_slots` > 0 — it never duplicates a non-batch recipe to fill
    a gap and never throws.
11. **Determinism.** Given identical inputs, then `fill(...)` returns an identical assignment (stable tie-breakers;
    any randomness seeded).
12. **Household seam present.** `ScoreAggregator` interface exists with a `SingleUser` identity implementation wired;
    `CandidateProvider` folds member scores through it (v1 = passthrough), so `LeastMisery`/`Average`/`Fairness` can be
    added without touching the fillers.

## Test Cases

### Test Case 1: tiering, filters, recency (AC 1, 2, 3)
**Preconditions:** Hand-built recipe set: R_imp (owned), R_like (in liked cookbook), R_save (in saved), R_glob (global),
R_allergen (global, contains a flagged severe allergen), R_recent (global, served 3 days ago), R_old (global, served 20
days ago). User prefs with the allergen flagged severe and `MEAL_COOLDOWN_DAYS=14`.
**Steps:** Call `CandidateProvider.candidates(user, 'dinner', cutoff)` with stubbed repositories returning the set.
**Expected Outcomes:** Pool tiers R_imp=imported, R_like=liked, R_save=saved, R_glob/R_old=global; R_allergen absent
(filtered); R_recent absent (recency); R_old present. A recipe both owned and liked → `imported`.

### Test Case 2: tie-break prefers tier, no dup (AC 4, 11)
**Preconditions:** Two dinner candidates with equal ranking score, one `imported`, one `global`; 2 dinner slots, pool
of 3 distinct recipes.
**Steps:** `fill` the 2 slots twice with identical input.
**Expected Outcomes:** The imported recipe is chosen for the first slot; no recipe repeats; both runs identical.

### Test Case 3: MMR reduces redundancy (AC 5)
**Preconditions:** Pool = 3 italian/pasta recipes (high base) + 2 varied recipes (slightly lower base); 3 dinner slots.
**Steps:** Fill with λ=0 (pure base) and with the production λ; compute total pairwise `sim` of each chosen set.
**Expected Outcomes:** Production-λ set has strictly lower total `sim` and still respects tier/base ordering within the
diversity trade.

### Test Case 4: novelty portfolio hits target (AC 6)
**Preconditions:** Pool split into familiar and new candidates; target ratio 70:30; 10 dinner slots.
**Steps:** Fill; count `familiar=false` picks.
**Expected Outcomes:** New picks = 3 ± 1.

### Test Case 5: budget repair (AC 7)
**Preconditions:** Pool where the greedy MMR fill exceeds budget but a within-budget assignment exists.
**Steps:** Fill; read `summary.cost_total_cents`.
**Expected Outcomes:** cost ≤ budget; the swapped-in recipes are the cheapest-per-base-loss options. Second scenario:
no within-budget assignment exists → plan returned, `cost_total_cents` > budget reported, no throw.

### Test Case 6: batching triggers and bounds (AC 8, 9, 10)
**Preconditions:** `eats_leftovers=true`, `cook_days_count=3`, 6 dinner slots; pool includes a `designed` stew and a
`suitable` curry (keeps-well) plus `unsuitable` fresh dishes.
**Steps:** Fill.
**Expected Outcomes:** Distinct cook events ≤ 3 + leftover budget rules; leftover slots share a `batchId` and reference
a keeps-well recipe (never the `unsuitable` ones); a batch spans ≤ 3 days; `servingsMultiplier` = covered slots ×
household. Intent variant: `cook_days_count` high but `when_cook='meal_prep'` → still batches, preferring `designed`.
Capacity variant with `cook_days_count=NULL` → capacity trigger off. Thin-pool variant → `unfilled_slots` > 0, no dup,
no throw.

### Test Case 7: household seam is a passthrough (AC 12)
**Preconditions:** `SingleUser` aggregator wired.
**Steps:** Fold a single member's scores.
**Expected Outcomes:** Output equals input scores (identity); the filler code path is identical whether or not an
aggregator is present.

## Test Run

_To be filled during execution: unit-test output, pass/fail per case. Add a `candidatePool(...)` test factory
(design Testing section) to build `CandidateRecipe[]` with tier/score/cost/minutes/mealPrepFit knobs._

## Deployment Strategy

Direct deploy — this ships pure code with no entry point (no route calls it until WI-MP-3), so it is inert in
production on merge. No flag needed at this layer.

## Production Verification

N/A at this layer — the engine has no production surface until WI-MP-3 wires the endpoint. Verification happens there.

## Production Verification Run

_N/A for this work item._
