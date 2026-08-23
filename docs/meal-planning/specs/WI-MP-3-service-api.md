# WI-MP-3 — Meal-planning engine: service, API, and monitoring

## Background

WI-MP-1 laid the data layer; WI-MP-2 built the pure engine. This work item wires them into the running server (design:
`docs/meal-planning/meal-planning-engine.md`, Option B): a service that loads a user's preferences + candidate pools +
recency history, runs the engine, and persists the result; two HTTP endpoints (generate a week, regenerate one slot);
and the monitoring/logging that answers "is generation working?". After this, "generate my week" works end to end.

Depends on WI-MP-1 and WI-MP-2. Reuses the existing Hono app + `guard` auth middleware in `server/src/index.ts`, the
`MealPlanRepository` (now with `replaceGenerated`), `PreferenceRepository`, `RecipeRepository`, `CookbookRepository`,
`SwipeRepository`, and the `RankingEngine`.

## Objective

Implement `MealPlanGeneratorService` (hand-wired via `static create()`, no DI container) that orchestrates
candidate-generation → fill → persist, plus `POST /v1/meal-plan/generate` and `POST /v1/meal-plan/regenerate`, plus the
structured one-line-per-generation log and the metrics named in the design. Preview mode returns the plan without
writing.

## Acceptance Criteria

1. **Generate endpoint fills and persists.** Given `POST /v1/meal-plan/generate {start, end, preview:false}` for an
   authed user with non-empty `weekly_meals`, when it runs, then it returns 200 with `plan.entries` (one recipe per
   filled slot, each carrying `tier` and `recipe` card fields) and `plan.summary` (`preference_total`,
   `cost_total_cents`, `weekly_budget_cents`, `novelty_ratio`, `unfilled_slots`), and the generated entries are
   persisted via `replaceGenerated` as `source='generated'` — preserving any `manual` entries in the range.
2. **Preview does not persist.** Given `preview:true`, when it runs, then the same plan is returned but no
   `meal_plan_entries` rows change; entry `id`s are null.
3. **Slot counts honor weekly_meals.** Given `weekly_meals = {breakfast:0, lunch:5, dinner:7, snack:0}`, then the plan
   fills 0 breakfast, 5 lunch, 7 dinner, 0 snack slots across the requested date range.
4. **Empty plan rejected.** Given `weekly_meals` all zero, then the endpoint returns 422 (nothing to plan). Given a
   range > 31 days, then 422 (mirrors `GET /v1/meal-plan`).
5. **Regenerate swaps one slot.** Given `POST /v1/meal-plan/regenerate {date, meal, exclude_recipe_id}`, when the
   pool has an eligible alternative respecting the rest of the committed week, then it replaces that one entry and
   returns 200 with the new entry; given no eligible candidate remains, then it returns 409 and leaves the slot as-is.
6. **Auth + ownership.** Given no bearer, then 401. Given a regenerate targeting another user's entry, then it cannot
   affect it (owner-scoped).
7. **Partial fill is reported, not failed.** Given a meal-type whose pool is exhausted (e.g. a strict diet), then the
   response is 200 with `summary.unfilled_slots` > 0 — never a 500, never an empty body.
8. **Monitoring.** Given a generation, then the server emits one structured `info` log line
   (`userId, slots, filled, unfilled, cost_total, budget, novelty_ratio, leftover_ratio, latency_ms, engine`) and
   increments/records the metrics `mealplan_generate_total`, `mealplan_generate_latency_ms`, `mealplan_unfilled_slots`,
   `mealplan_budget_overrun_ratio`, `mealplan_novelty_ratio`, `mealplan_leftover_ratio`, `mealplan_regenerate_total`.

## Test Cases

### Test Case 1: generate round-trip persists generated, preserves manual (AC 1, 3)
**Preconditions:** Migrated test DB; user with `weekly_meals={lunch:2, dinner:2}`, a budget, a mix of
imported/liked/global recipes for lunch and dinner, and one pre-existing `manual` dinner in the week.
**Steps:** `POST /v1/meal-plan/generate {start, end, preview:false}`; then `GET /v1/meal-plan?start&end`.
**Expected Outcomes:** 4 generated entries (2 lunch, 2 dinner) written `source='generated'`; the manual dinner still
present; summary fields populated and internally consistent (`cost_total_cents` = Σ entry costs).

### Test Case 2: preview writes nothing (AC 2)
**Preconditions:** As above, clean week.
**Steps:** `POST .../generate {preview:true}`; then `GET /v1/meal-plan`.
**Expected Outcomes:** 200 with a plan whose entry ids are null; `GET` shows no new rows.

### Test Case 3: validation (AC 4)
**Preconditions:** User with `weekly_meals` all zero.
**Steps:** `POST .../generate`. Then repeat with a 40-day range.
**Expected Outcomes:** 422 in both cases with an `error {code, message}`.

### Test Case 4: regenerate happy + exhausted (AC 5)
**Preconditions:** A generated dinner slot with recipe X; pool has one alternative Y not already in the week.
**Steps:** `POST .../regenerate {date, meal:'dinner', exclude_recipe_id:X}`. Then repeat once more with Y now excluded
and no other candidate.
**Expected Outcomes:** First call returns Y and updates the one entry; second returns 409, entry unchanged.

### Test Case 5: auth + partial fill (AC 6, 7)
**Preconditions:** No bearer for one call; a strict-diet user whose dinner pool is thinner than the dinner slot count
for another.
**Steps:** `POST .../generate` without a token; then with the strict-diet user.
**Expected Outcomes:** 401 for the first; 200 with `unfilled_slots` > 0 for the second (no 500, non-empty body).

### Test Case 6: monitoring emitted (AC 8)
**Preconditions:** Log/metrics capture in the integration harness.
**Steps:** Run one generation.
**Expected Outcomes:** Exactly one structured line with the listed fields; the listed metrics recorded once.

## Test Run

_To be filled during execution: integration-test output against the local migrated DB (offline stubs; tests never hit
the network), pass/fail per case._

## Deployment Strategy

Ship behind a **client feature flag** (the "generate my week" button). The endpoints deploy dark; enabling the flag
exposes them. Server changes are additive (new routes + service). Rollback: disable the flag to hide the entry point
with no redeploy; roll back the code and the routes simply disappear — no data migration to reverse (generated entries
already in `meal_plan_entries` remain valid rows).

## Production Verification

### Production Verification 1: generate a real week end to end
**Preconditions:** Flag enabled for a test account with `weekly_meals`, a budget, and some liked/imported recipes.
**Steps:** In the app, tap "generate my week"; observe the calendar; add a manual dinner then regenerate a different
slot.
**Expected Outcomes:** The week fills with tier-appropriate recipes; the budget summary shows and is within budget when
feasible; the manually added dinner is untouched by a subsequent generate; regenerate swaps only its slot. Verified
against the running app + real DB (house principle: verify against live reality).

### Production Verification 2: monitoring visible
**Preconditions:** Deploy complete.
**Steps:** Trigger one generation; check logs/metrics.
**Expected Outcomes:** The structured log line and the `mealplan_*` metrics appear; `mealplan_generate_latency_ms` is
within the < 2000 ms p95 SLO.

## Production Verification Run

_To be filled during execution._
