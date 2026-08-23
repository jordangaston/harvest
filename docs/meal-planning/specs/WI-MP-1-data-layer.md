# WI-MP-1 — Meal-planning engine: data layer & migrations

## Background

The meal-planning engine (design: `docs/meal-planning/meal-planning-engine.md`, recommended Option B) auto-fills a
user's weekly meal slots. Before any engine logic can run or persist, the storage layer needs three additive changes.
Today `meal_plan_entries` records manually placed recipes only (`date`, `meal`, `recipe_id`, `position`); there is no
way to tell an engine-generated entry from a hand-placed one, no way to group a leftover batch, and `user_preferences`
has only a single `time_budget_minutes` (no per-meal budget). This work item lays that foundation. It is purely
additive and ships no user-visible behavior on its own.

This is the first of three work items (WI-MP-1 data → WI-MP-2 engine core → WI-MP-3 service+API). Nothing depends on
engine logic yet, so this can merge independently.

## Objective

Add the schema, domain-model, and repository support the engine needs: mark entries as `manual` vs `generated`, group
leftover batches via `batch_id`, store per-meal time budgets (`time_by_meal`), and give `MealPlanRepository` a
`replaceGenerated` method that swaps a week's generated entries while preserving manual ones — all in one transaction.

## Acceptance Criteria

1. **Migration adds `meal_plan_entries.source`.** Given the migration runs, when a row is inserted without specifying
   `source`, then it defaults to `'manual'`; the column is a text enum constrained to `'manual' | 'generated'` and
   `NOT NULL`. Existing rows backfill to `'manual'`.
2. **Migration adds `meal_plan_entries.batch_id`.** Given the migration runs, then `batch_id` exists as a nullable
   text column; existing rows are `NULL`. Both `source` and `batch_id` are added in a single adds-only migration on
   `meal_plan_entries` (no drop+add, per the house Drizzle rule, so codegen stays non-interactive).
3. **Migration adds `user_preferences.time_by_meal`.** Given the migration runs, then `time_by_meal` exists as a
   nullable JSON column typed `{ breakfast, lunch, dinner, snack }` (minutes), mirroring the `weekly_meals` shape;
   existing rows are `NULL`.
4. **Domain models updated.** Given a row is read through its repository, when parsed, then `MealPlanEntry` exposes
   `source` and `batchId`, and `UserPreferences` exposes `timeByMeal` (nullable) — validated via Zod at the repository
   boundary (no `$inferSelect` casting).
5. **`replaceGenerated(userId, start, end, entries)` exists on `MealPlanRepository`.** Given a week that contains both
   a `manual` entry and prior `generated` entries, when `replaceGenerated` runs with a new set of entries, then in one
   transaction it deletes only `source='generated'` rows whose `date` is in `[start, end]` for that user and inserts
   the new entries as `source='generated'`; the pre-existing `manual` entry is untouched.
6. **`replaceGenerated` is owner-scoped.** Given entries belonging to another user in the same date range, when
   `replaceGenerated` runs for `userId`, then only `userId`'s generated rows are affected.
7. **All existing tests still pass** and the new migration applies cleanly on a fresh DB via the test global-setup.

## Test Cases

### Test Case 1: source defaults to manual and constrains values (AC 1)
**Preconditions:** Fresh migrated test DB; a user and a recipe exist.
**Steps:** Insert a `meal_plan_entries` row via the existing `add` path without setting `source`; read it back.
**Expected Outcomes:** Row has `source='manual'`. Attempting to insert `source='other'` fails the enum/check constraint.

### Test Case 2: batch_id nullable, backfill null (AC 2)
**Preconditions:** Fresh migrated test DB with the migration applied over a DB that already had rows (simulate by
inserting a row pre-parse).
**Steps:** Read an entry inserted without a `batch_id`.
**Expected Outcomes:** `batchId` is `null`. Both `source` and `batch_id` originate from the same migration file (assert
by inspecting the generated `.sql` contains both `ADD COLUMN` statements and no `DROP`).

### Test Case 3: time_by_meal round-trips (AC 3, 4)
**Preconditions:** A user with a `user_preferences` row.
**Steps:** Write `time_by_meal = {breakfast:15, lunch:30, dinner:45, snack:10}` through the preference write path; read
the preferences back.
**Expected Outcomes:** `UserPreferences.timeByMeal` parses to the same object; a preferences row with a NULL column
parses `timeByMeal` to `null`.

### Test Case 4: replaceGenerated preserves manual, swaps generated (AC 5, 6)
**Preconditions:** User U with, in the target week: one `manual` dinner (recipe A), two `generated` entries (recipes B,
C). A second user V has a `generated` entry in the same week.
**Steps:** Call `replaceGenerated(U, weekStart, weekEnd, [ {date, meal, recipeId: D}, {date, meal, recipeId: E} ])`.
**Expected Outcomes:** After the call, U's week contains: the manual A (unchanged), plus D and E as `generated`; B and
C are gone. V's generated entry is unchanged. All within one transaction (assert no partial state on a forced failure —
inject a failing insert and confirm the manual row and V's row survive and no new rows persist).

## Test Run

_To be filled during execution: `npm test` output for the new repository unit tests + the migration apply, with
pass/fail per case._

## Deployment Strategy

Direct deploy. Both migrations are additive and backwards-compatible (defaulted / nullable), so they run **before** the
code deploys and old code ignores the new columns. No feature flag needed — no behavior is exposed yet. Rollback: the
columns are simply unused if the code rolls back; no data migration to reverse.

## Production Verification

### Production Verification 1: migration applied, columns present
**Preconditions:** Deploy completed against the production libSQL/Turso DB.
**Steps:** Inspect the `meal_plan_entries` and `user_preferences` schemas; insert-and-read one manual entry through the
existing `POST /v1/meal-plan` path.
**Expected Outcomes:** `source`, `batch_id`, `time_by_meal` exist; a normal manual add still returns 200 and reads back
with `source='manual'`, `batch_id=null` — confirming no regression to the shipped calendar.

## Production Verification Run

_To be filled during execution._
