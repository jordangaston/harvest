# WI-RANK-1 — User-preference schema, model, and read repository

> Part 1 of 3 for the ranking engine. See `docs/ranking-engine/DESIGN.md`.
> Depends on: nothing. Blocks: WI-RANK-2 (needs the `UserPreferences` model), WI-RANK-3 (needs the repository).

## Background

The ranking engine (`DESIGN.md`) scores each recipe against per-user preferences: signal weights,
budget/time/skill targets, allergen severities, diet strictness, and food likes/dislikes. None of
this is stored yet — onboarding data lives on the `users` table, but there is no preferences table.

This work item adds the persistence layer only: four new tables, one Zod domain model, and a
**read** repository that resolves a user's preferences — falling back to goals-derived cold-start
defaults when the user has no stored preferences. Writing preferences (a settings/onboarding screen)
is out of scope; the ranked endpoint only reads, and tests seed rows directly.

Stack facts (verified against the repo):
- Drizzle + libSQL/Turso. Schema in `server/src/schema.ts`; helpers `uuidPk()`, `createdAt()`.
- Enums are `text('col', { enum: TUPLE })`; composite PKs use `primaryKey({ columns: [...] })`; the
  table callback returns an **array**: `(t) => [ primaryKey(...), index(...) ]`.
- Migrations: `npm run db:generate` (drizzle-kit generate → `server/drizzle/`) then `npm run db:migrate`.
- Repositories are classes with `static create(db)`; methods return `Schema.parse(row)` at the boundary.
- Unit tests use `migratedFileDb()` from `server/test/helpers/migrated-db.ts` (fresh `file:` libSQL, all migrations applied).
- `users.goals` is a JSON-mode text array over the enum `['eat_healthier','save_money','improve_cooking','organize_recipes','plan_meals','meal_prepping','try_new_cuisines']`.

## Objective

Add the `user_preferences`, `user_allergens`, `user_diets`, and `user_food_prefs` tables (with
migration), a `UserPreferences` Zod model, and a `PreferenceRepository` whose `getPreferences(userId)`
returns a fully-resolved `UserPreferences` — reading stored rows when present, otherwise synthesizing
cold-start defaults from `users.goals`.

## Acceptance Criteria

1. **Tables exist and match the design.** A new migration in `server/drizzle/` creates the four
   tables with exactly these shapes (SQLite/Drizzle):
   - `user_preferences` (1:1 with users): `user_id` text pk → `users.id` on delete cascade;
     `skill_level` text enum `['beginner','intermediate','advanced']` not null default `'beginner'`;
     `budget_cents_per_serving` integer null; `time_budget_minutes` integer null; six weights
     `weight_cost weight_difficulty weight_nutrition weight_affinity weight_time weight_popularity`
     integer not null — first five default 1, `weight_popularity` default 0; `updated_at` timestamp not null.
   - `user_allergens`: `user_id` text → users cascade; `allergen` text enum (the 9 majors:
     `['milk','egg','fish','crustacean_shellfish','tree_nut','peanut','wheat','soybean','sesame']`);
     `severity` text enum `['severe','moderate','mild']` not null; pk `(user_id, allergen)`.
   - `user_diets`: `user_id` text → users cascade; `diet_id` text not null; `strictness` text enum
     `['strict','flexible']` not null; pk `(user_id, diet_id)`.
   - `user_food_prefs`: `user_id` text → users cascade; `facet` text enum
     `['cuisine','dish_type','primary_ingredient']` not null; `value` text not null; `sentiment` text
     enum `['like','dislike']` not null; pk `(user_id, facet, value)`.
   - `npm run db:generate` produces the SQL with no unrelated diffs; `migratedFileDb()` applies the
     full journal cleanly.

2. **`UserPreferences` domain model exists** at `server/src/models/user-preferences.ts`, exporting
   `UserPreferencesSchema` and `type UserPreferences` shaped per `DESIGN.md` § Zod domain model:
   scalar targets (nullable), a `weights` object of six ints each `min(0).max(3)`, and arrays
   `allergens` / `diets` / `foodPrefs`. Enum tuples are re-declared in this file (repo convention:
   both layers validate independently).

3. **`PreferenceRepository.getPreferences(userId)` resolves stored preferences.** When a
   `user_preferences` row exists, the repository loads it plus the user's `user_allergens`,
   `user_diets`, and `user_food_prefs` rows and returns a `UserPreferencesSchema.parse(...)` object
   with those child arrays populated.

4. **Cold-start fallback.** When no `user_preferences` row exists, `getPreferences(userId)` reads
   `users.goals` and synthesizes defaults: every weight = 1 except `popularity` = 0, then
   `save_money` → `cost` = 3 and `eat_healthier` → `nutrition` = 3; `skillLevel` = `'beginner'`; all
   targets null; empty `allergens`, `diets`, `foodPrefs`. A user id with no `users` row throws (caller
   guarantees an authed user).

5. **The repository never writes.** No insert/update/upsert methods in this work item. `getPreferences`
   is read-only. [ASSUMPTION: preference writes belong to a later onboarding/settings work item; tests
   seed rows via the raw `db`.]

## Test Cases

Unit tests in `server/test/preference-repository.test.ts` using `migratedFileDb()`. Seed a user with
`UserRepository.create(db).insert({...})`; seed preference rows with direct `db.insert(...)`.

### Test Case 1: Migration applies and tables accept valid rows
**Preconditions:** Fresh `migratedFileDb()`.
**Steps:** Insert a user; insert a `user_preferences` row, two `user_allergens`, one `user_diets`, two
`user_food_prefs`.
**Expected Outcomes:** All inserts succeed. Inserting a `user_allergens` row with a duplicate
`(user_id, allergen)` fails (pk). Deleting the user cascades and removes all child rows.

### Test Case 2: getPreferences folds stored rows
**Preconditions:** User with a stored `user_preferences` row (weights cost=3,nutrition=3,others=1,
popularity=0; budget=400; time=30; skill=intermediate), one allergen `peanut/severe`, one food pref
`cuisine/italian/like`.
**Steps:** `PreferenceRepository.create(db).getPreferences(userId)`.
**Expected Outcomes:** Returns a `UserPreferences` with `weights.cost === 3`, `weights.popularity === 0`,
`budgetCentsPerServing === 400`, `allergens` containing `{allergen:'peanut',severity:'severe'}`,
`foodPrefs` containing `{facet:'cuisine',value:'italian',sentiment:'like'}`. Passes `UserPreferencesSchema.parse` (implicitly).

### Test Case 3: Cold-start from goals
**Preconditions:** User with `goals: ['save_money']` and **no** `user_preferences` row.
**Steps:** `getPreferences(userId)`.
**Expected Outcomes:** `weights` = `{cost:3, difficulty:1, nutrition:1, affinity:1, time:1, popularity:0}`;
`skillLevel === 'beginner'`; `budgetCentsPerServing === null`; `allergens`/`diets`/`foodPrefs` empty.

### Test Case 4: Cold-start with no goals
**Preconditions:** User with `goals: null`, no preferences row.
**Steps:** `getPreferences(userId)`.
**Expected Outcomes:** All weights 1 except `popularity` 0; empty child arrays.

### Test Case 5: Invalid stored weight rejected at the boundary
**Preconditions:** A `user_preferences` row written with `weight_cost = 5` (out of the 0–3 range).
**Steps:** `getPreferences(userId)`.
**Expected Outcomes:** `UserPreferencesSchema.parse` throws — the repository surfaces the error rather
than returning an invalid model. [ASSUMPTION: 0–3 is enforced in the Zod model, not a DB check
constraint, matching how the repo validates at the domain boundary.]

## Test Run
_To be filled in during execution: `npm test -- preference-repository` output, pass/fail per case._

## Deployment Strategy

Additive schema migration — four new empty tables, no changes to existing tables. Backwards-compatible:
old code ignores the new tables, so the migration can run before or with the code deploy. No data
migration. No feature flag needed (nothing reads these tables until WI-RANK-3 ships).

## Production Verification

### Production Verification 1: Tables present, cold-start resolves
**Preconditions:** Migration applied to the Turso production database.
**Steps:** Confirm the four tables exist (`SELECT name FROM sqlite_master WHERE type='table'`). In a
one-off script, call `PreferenceRepository.create(db).getPreferences(id)` for an existing user who has
no preferences row.
**Expected Outcomes:** The four tables exist; `getPreferences` returns a valid cold-start
`UserPreferences` (weights default 1 / popularity 0, plus any goal bumps) without error.

## Production Verification Run
_To be filled in during execution._
