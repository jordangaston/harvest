# WI-02 — Auto-sync: the list follows the plan (reconcile-from-state)

## Background

`server/docs/groceries-chef/DESIGN.md` (§§ F-05 "List follows the plan", Modules
GrocerySync, Decisions 1–5) — the founder's core call: nobody stocks the list; it is
a derived view of the meal plan. `GrocerySync.reconcile` recomputes what the plan
implies and converges the household's recipe-sourced rows to it. Requires WI-01
(household scope).

## Objective

Every plan mutation (generate/regenerate, slot add, slot remove — chef AND REST
paths) leaves the household's grocery list matching the plan: recipe-sourced rows
added/removed by diff, manual rows and checked rows never touched, replays writing
nothing.

## Acceptance Criteria

1. Given `GrocerySync.reconcile(userId)` per DESIGN: resolves the plan owner's
   household, computes the desired recipe-sourced set from the current plan window's
   entries' recipe ingredients, and diffs against current recipe-sourced rows via the
   one new write `GroceryService.setRecipeSourced` — inserting missing rows, deleting
   UNCHECKED recipe-sourced rows absent from the desired set. Recipe-sourced rows are
   NOT cross-recipe merged (each carries its `source_recipe_id`); manual rows
   (`source_recipe_id` null) and CHECKED rows are never written by sync.
2. Given the hooks at the chokepoints DESIGN § Modules names —
   `MealPlanService.add` / `removeFromSlot` / `remove` and the generator's
   `replaceGenerated` path — then both the chef tools and the REST plan endpoints
   trigger reconcile with no separate code path.
3. Given the same mutation replayed (chef-turn redelivery / REST retry), then the
   second reconcile writes zero rows (idempotence — prove it in a test).
4. Given a swap (remove recipe R, add recipe S), then R's unchecked items vanish, R's
   checked items survive, S's items appear, manual items untouched.
5. Given regeneration, then the diff (not a wipe) preserves manual picks and checked
   state (DESIGN Decision 4).
6. Given a plan owner with no household, then reconcile no-ops and logs (DESIGN
   Q-06 resolution).
7. Reconcile runs in-request (DESIGN Q-05 recommendation) — no queue job.

## Test Cases

Vitest, files individually, `pkill -f vitest`; canonical `npm test`, dev server
stopped. Integration tests seed recipes with ingredients + a household per WI-01.

### Test Case 1: generate stocks the list (AC-1, AC-2)

**Steps:** `replaceGenerated` a 3-recipe week → recipe-sourced rows appear per
ingredient with source ids; a manual row seeded beforehand untouched.

### Test Case 2: reconcile is idempotent (AC-3)

**Steps:** call reconcile twice; snapshot rows between → identical (ids included).

### Test Case 3: swap semantics (AC-4)

**Steps:** check off one of R's items; remove R from its slot; add S.
**Expected:** R's unchecked rows gone, the checked one remains, S's rows present.

### Test Case 4: REST path gets sync free (AC-2)

**Steps:** POST the plan-entry REST endpoint → reconcile ran (list changed) without
any chef involvement.

### Test Case 5: no-household owner (AC-6)

**Steps/Expected:** reconcile for a household-less user → no rows, one log line, no
throw.

## Test Run

To be filled during execution.

## Deployment Strategy

Code-only; after WI-01. First reconcile for an existing confirmed plan happens on its
next mutation (acceptable; note it). Rollback: plain code rollback — the list simply
stops following the plan.

## Production Verification

### PV-1: swap on the phone updates the list

**Steps:** From the test thread swap tonight's dinner; open the app's grocery tab.
**Expected:** old recipe's unchecked items gone, new recipe's present, checked +
manual intact.

## Production Verification Run

To be filled after deploy.
