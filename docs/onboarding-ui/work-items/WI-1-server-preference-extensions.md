# WI-1 — Server: onboarding preference-model extensions

## Background

Onboarding (Phase 2) front-loads the ranking `Preferences` so the first swipe deck is personalised.
Four new signals and one enum value must persist through the **existing** preference plumbing — no new
service, no parallel model (`docs/onboarding-ui/DESIGN.md` §0, §5; `server/CLAUDE.md`).

Current server state (ground truth):
- `server/src/schema.ts` — libSQL/Turso via Drizzle `sqliteTable`. `users` table has `goals` (JSON
  text array of `GOALS`), `onboardingCompletedAt` (timestamp). Preference tables: `user_preferences`
  (+ `user_allergens`, `user_diets`, `user_food_prefs(facet, value, sentiment)`, `user_equipment`).
  Enums: `GOALS`, `EQUIPMENT_TYPES`, `MAJOR_ALLERGENS`, `DIET_STRICTNESS`.
- `server/src/models/user-preferences.ts` — `AFFINITY_FACETS = ['cuisine','dish_type','primary_ingredient']`
  and `SENTIMENTS = ['like','dislike']` **already exist**; `foodPrefs: {facet,value,sentiment}[]` already
  models combined likes/dislikes across all three facets. `PreferencesUpdateSchema` currently exposes
  only the narrow `likedCuisines` / `dislikedIngredients`.
- `server/src/preferences-dto.ts` — `preferencesBodySchema` (snake_case wire) + `toPreferencesDTO` /
  `fromPreferencesDTO`; flattens `foodPrefs` to `liked_cuisines` / `disliked_ingredients`.
- `server/src/repositories/preference-repository.ts` — `getPreferences`, `savePreferences` (upserts the
  editable subset, replaces only the `cuisine/like` + `primary_ingredient/dislike` food-pref slices),
  `bumpWeight`, `addDislike`.
- Routes in `server/src/index.ts`: `GET`/`PUT /v1/preferences`, `POST /v1/users` (with `onboarding`).

> `server/CLAUDE.md` says tests run against local Postgres — **stale**; the stack is libSQL/Turso. Use
> the actual Vitest setup already in `server/` (`tests/helpers/*`). `[ASSUMPTION: the existing test
> harness migrates a local libSQL/Turso file; the implementing agent must confirm and use it.]`

## Objective

Extend the preference model + `PUT /v1/preferences` DTO + repository to persist **grocery stores (E1)**,
**household adults/kids (E2)**, **eats-leftovers (E3)**, and a **combined likes/dislikes picker over
cuisines + dish types + ingredients (E4)**; add **`kid_friendly`** to `GOALS` (Q-03); and expose a
derived **`finished_onboarding`** boolean on the current-user read for the client first-launch gate
(Q-02) — reusing the existing `onboardingCompletedAt` timestamp, **not** adding a redundant boolean
column. Additive and backwards-compatible. All covered by Vitest tests.

## Acceptance Criteria

1. **E1 stores.** Given a `PUT /v1/preferences` body with `grocery_stores: string[]` (each from a new
   canonical `GROCERY_STORES` server enum), when saved and re-read via `GET /v1/preferences`, then the
   same stores round-trip. Unknown store ids are rejected with `400`.
2. **E2 household.** Given a body with `household_adults` (int ≥ 1) and `household_kids` (int ≥ 0), when
   saved and re-read, then both round-trip. Defaults are `adults=2, kids=0` when a user has never saved.
3. **E3 leftovers.** Given a body with `eats_leftovers: boolean`, when saved and re-read, then it
   round-trips. When it flips from false→true on a save, then `weights.mealPrep` is bumped once
   (server-owned, capped at 3), mirroring the existing goals→weights cold-start seed; a settings save
   never lowers it.
4. **E4 combined likes/dislikes.** Given a body with `likes: {facet,value}[]` and
   `dislikes: {facet,value}[]` where `facet ∈ {cuisine, dish_type, ingredient}`, when saved and re-read,
   then every `{facet,value}` round-trips across all three facets (not just cuisine-like /
   ingredient-dislike). The wire `ingredient` maps to the domain facet `primary_ingredient`. The legacy
   `liked_cuisines` / `disliked_ingredients` fields are removed from the DTO (superseded).
5. **Q-03 kid_friendly.** Given `POST /v1/users` (or `PUT`) with `goals` including `kid_friendly`, when
   saved, then it persists and validates; the enum contains the original seven plus `kid_friendly`.
6. **Q-02 finished_onboarding.** Given a user whose `onboardingCompletedAt` is non-null, when the client
   reads the current user (the existing `/v1/users/me`-style endpoint, or the auth/me read the app uses),
   then the response includes `finished_onboarding: true`; null ⇒ `false`. No new DB column is added.
7. **Migrations.** A Drizzle migration adds the new `user_preferences` columns and is generated via
   `drizzle-kit generate` (never hand-applied DDL). Old rows read with the documented defaults.
8. **No regression.** `GET/PUT /v1/preferences` and the swipe Settings round-trip still pass; `npm run
   typecheck` (root + server) clean; the full server test suite passes.

## Test Cases

### Test Case 1: E1/E2/E3 columns round-trip (repository unit)
**Preconditions:** libSQL test db migrated; a user row exists with no preferences.
**Steps:** Call `savePreferences(userId, {…, groceryStores:['walmart','kroger'], household:{adults:2,kids:3}, eatsLeftovers:true, …})`; then `getPreferences(userId)`.
**Expected Outcomes:** Returned model has `groceryStores=['walmart','kroger']`, `household={adults:2,kids:3}`, `eatsLeftovers=true`. Cold-start `getPreferences` before any save returns `household={adults:2,kids:0}`, `eatsLeftovers` default (document true), `groceryStores=[]`.

### Test Case 2: E4 combined facets round-trip (repository unit)
**Preconditions:** as above.
**Steps:** Save `likes=[{cuisine:'Italian'},{dish_type:'Bowls'},{ingredient:'Salmon'}]`, `dislikes=[{ingredient:'Liver'},{cuisine:'German'}]` (wire shape). Re-read.
**Expected Outcomes:** `foodPrefs` contains all five with correct facet (`ingredient`→`primary_ingredient`) and sentiment; DTO `likes`/`dislikes` re-serialise identically. Pre-existing dislike-loop food-prefs on untouched values are preserved.

### Test Case 3: E3 seeds mealPrep weight (repository unit)
**Preconditions:** user with default weights (`mealPrep` at seed value < 3), `eatsLeftovers` currently false/unset.
**Steps:** Save with `eatsLeftovers:true`. Read weights. Save again with `eatsLeftovers:true`.
**Expected Outcomes:** `weights.mealPrep` increments once on the false→true transition, capped at 3; the second save does not increment further; a save with `eatsLeftovers:false` never decrements.

### Test Case 4: DTO validation (integration)
**Preconditions:** authed test client.
**Steps:** `PUT /v1/preferences` with an invalid `grocery_stores:['not_a_store']`; then a valid body; then `GET /v1/preferences`.
**Expected Outcomes:** invalid → `400` (ZodError); valid → `200` with the new fields echoed; `GET` returns the same. `liked_cuisines`/`disliked_ingredients` keys are absent.

### Test Case 5: kid_friendly goal (integration)
**Preconditions:** authed test client.
**Steps:** `POST /v1/users` with `onboarding.goals=['kid_friendly','save_money']`.
**Expected Outcomes:** `200`; user persists both goals; `kid_friendly` is a valid `GOALS` member.

### Test Case 6: finished_onboarding derivation (integration)
**Preconditions:** two users — one with `onboardingCompletedAt` set, one null.
**Steps:** Read current-user for each.
**Expected Outcomes:** `finished_onboarding` is `true` and `false` respectively; no new column exists in the `users` table.

## Test Run
_To be filled during execution._

## Deployment Strategy

Additive, backwards-compatible. Order: (1) generate + run the Drizzle migration (new nullable/defaulted
`user_preferences` columns) — safe before code deploy; (2) deploy server (new DTO accepts the fields,
old clients omit them and read defaults); (3) client (WI-2) ships after. `GROCERY_STORES` enum lives
server-side. No data backfill. Rollback: new columns are inert to old code; revert server without
touching the migration. `kid_friendly` is an additive enum value.

## Production Verification

### Production Verification 1: Preferences round-trip in prod
**Preconditions:** a real authed account on the deployed server.
**Steps:** `PUT /v1/preferences` with stores + household + leftovers + combined likes/dislikes; `GET /v1/preferences`.
**Expected Outcomes:** `200`; all fields echo back identically; no `5xx`; latency comparable to before.

### Production Verification 2: Gate reads correctly
**Preconditions:** one account that finished onboarding, one mid-flow.
**Steps:** Read current-user for each.
**Expected Outcomes:** `finished_onboarding` reflects `onboardingCompletedAt` presence.

## Production Verification Run
_To be filled during execution._
