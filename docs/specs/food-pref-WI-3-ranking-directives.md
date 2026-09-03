# WI-3 — Ranking over recipe-scope directives; retire the weight vector

## Background

The design (§ Key decisions) makes base ranking `affinity + popularity` and expresses "I care about
time/cost/nutrition" as recipe-scope directives, retiring the per-user numeric weight vector nobody
can set. Today `server/src/ranking/scorers.ts` reads `prefs.weights.{cost,time,nutrition,
difficulty,affinity,meal_prep,popularity}` from the seven `user_preferences.weight_*` columns, and
the swipe flow snapshots that vector into `recipe_swipes.weights`.

Depends on: WI-1 (directive columns), WI-2 (the `set_directive` write path).

## Objective

Apply recipe-scope directives in the ranker — `soft`/`firm` as a weight, `strict` as a filter — with
base = affinity + popularity, and remove the weight vector.

## Scope

1. **Apply recipe-scope directives** in scoring: a `soft` directive nudges rank, a `firm` directive
   weighs strongly (still possible), a `strict` `less` directive filters the recipe out (a `strict`
   `more` requires it). Only `firm → strict` flips rank→filter (design § Enums).
2. **Base ranking = affinity + popularity.** Cost/time/nutrition/difficulty/meal-prep become
   directive-driven signals, not baseline weights.
3. **Retire the weight vector** (the design's WI-1 item, moved here because it is inseparable from
   the ranker rewrite):
   - Drop `user_preferences.weight_cost/time/nutrition/difficulty/affinity/popularity/meal_prep`
     (Drizzle migration).
   - Remove `SignalScorer.weight(prefs)` reading those columns; the ranker composes from directives.
   - Rework `recipe_swipes.weights` — the swipe snapshot no longer captures a per-user vector
     (snapshot the directive set that produced the card, or drop the column if unused downstream).
   - Update `PreferenceRepository.coldStart`/`bumpWeight` (goal→weight seeding) and every test that
     asserts a `weight_*` column (`preference-write`, `ranked-recipes`, `swipe-deck`).

## Acceptance Criteria

- **AC-1** A `soft`/`firm` recipe-scope `less` directive on a dimension the recipe carries lowers its
  score proportionally to strength; a `more` raises it.
- **AC-2** A `strict` `less` directive removes matching recipes from the ranked set; a `strict`
  `more` keeps only matching recipes.
- **AC-3** With no directives, ranking = affinity + popularity only.
- **AC-4** No `weight_*` column or `prefs.weights` reference remains; goal-derived preferences are
  expressed as seeded directives (or documented as dropped).
- **AC-5** Build clean; suite green except the two media failures.

## Test Cases

### Test Case 1: soft vs firm weight (AC-1)
**Steps:** rank a recipe carrying `cuisine=thai` under a `soft` then a `firm` `thai`/`less`
directive.
**Expected:** both lower the score; `firm` lowers it more.

### Test Case 2: strict filters (AC-2)
**Steps:** rank with a `strict` `food_category`/`red_meat`/`less` directive.
**Expected:** every red-meat recipe is absent from the result.

### Test Case 3: base ranking (AC-3)
**Steps:** rank with zero directives.
**Expected:** order matches affinity + popularity alone.

## Deployment Strategy

One migration drops the weight columns; ship it with the ranker rewrite so no reader references a
dropped column. Pre-release, forward-only.

## Production Verification

### Production Verification 1: a directive shapes the deck
**Steps:** a user sets `{cook_time, less, firm, recipe}`; open the swipe deck.
**Expected:** faster recipes rank higher; slow ones sink.
