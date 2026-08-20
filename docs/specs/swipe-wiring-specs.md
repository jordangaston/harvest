---
tags: [swipe-ui], spec
summary: "Work-item specs — wire the swipe deck + settings to the real backend"
locked: false
---

# Swipe Deck & Settings — Wiring Specs

Breaks the finalized design (`docs/swipe-ui/DESIGN.md`) into implementable work items. The UI is
already built as Design-Studio prototypes; the `save` swipe action shipped earlier. What remains is
the real backend gaps and the app wiring. **The F-04 nudge is removed (D-13)** — week planning is
automatic from the Liked cookbook, so no like-counter/nudge work exists.

Verified facts (from a codebase pass):
- The server **already persists preferences** — `user_preferences` + `user_allergens` / `user_diets`
  / `user_food_prefs` / `user_equipment` tables and `PreferenceRepository.getPreferences()` exist.
  Gaps: **no HTTP endpoint**, **no full-upsert write**, and the model lacks **`weeklyMeals`** and
  **`weeklyBudgetCents`** (the design made budget *weekly*; the server has `budget_cents_per_serving`).
- The deck route is `GET /v1/recipes/deck` (resolves Q-07 → `deck`). Swipe is `POST /v1/recipes/:id/swipe`.
- The app has a real data layer (`lib/api/{client,config,hooks,queryKeys}`, `useCookbooks()` pattern).
  `SwipeDeck` uses `useMockDeck`; `SettingsScreen` uses local `DEFAULT_PREFERENCES`. A hidden
  `discover` tab is the natural home for the deck.
- **Invariant:** the studio studies stay mock-backed and must keep rendering; only the app screens use
  real hooks.

---

## WI-1 — Preferences read/write API (resolves Q-12)

### Background
The settings surface edits the full preference model (weekly meal counts, weekly grocery budget, time
per meal, skill, liked cuisines, disliked ingredients, allergens, diets, equipment). The server stores
most of this but exposes no HTTP read/write, and is missing the two fields the redesign added.

### Objective
Add `GET /v1/preferences` and `PUT /v1/preferences` to `server/`, backed by the existing
`PreferenceRepository` extended with a full upsert, and extend the model with `weeklyMeals` and
`weeklyBudgetCents`.

### Acceptance Criteria
1. Given an authenticated user, when they `GET /v1/preferences`, then a `200` returns their full
   preference DTO (snake_case): `skill_level`, `weekly_budget_cents`, `time_budget_minutes`,
   `weekly_meals {breakfast,lunch,dinner,snack,kids}`, `liked_cuisines[]`, `disliked_ingredients[]`,
   `allergens[{allergen,severity}]`, `diets[{diet,strictness}]`, `owned_equipment[]`.
2. Given a user with no saved preferences, when they `GET /v1/preferences`, then a `200` returns the
   cold-start defaults (existing `coldStart` behavior) with `weekly_meals` all-zero and a null/default
   `weekly_budget_cents`.
3. Given an authenticated user, when they `PUT /v1/preferences` with a valid full DTO, then a `200`
   returns the persisted DTO and a subsequent `GET` returns the same values.
4. Given a `PUT` with an out-of-range value (e.g. a weight > 3, a negative meal count, an unknown
   equipment enum), then a `400` (validation) with no partial write.
5. Given no/invalid bearer token, when hitting either route, then `401`.
6. Given a `PUT`, then liked cuisines / disliked ingredients round-trip through `user_food_prefs`
   (facet `cuisine` sentiment `like`; facet `primary_ingredient` sentiment `dislike`) without dropping
   dislike-tuning entries added by the swipe loop for other facets.

### Test Cases (Vitest, `migratedFileDb`)
- **TC-1a** GET cold-start: new user → 200, `weekly_meals` zeros, defaults present.
- **TC-1b** PUT then GET round-trip: PUT a full DTO (incl. `weekly_meals` and `weekly_budget_cents`),
  GET returns identical values.
- **TC-1c** PUT validation: meal count=-1 → 400; bad equipment enum → 400; DB unchanged. (Weights aren't
  in the DTO — D-10 — so there's no weight to validate here.)
- **TC-1d** Auth: GET/PUT without bearer → 401.
- **TC-1e** food-pref mapping: PUT `liked_cuisines:["Thai"]`, `disliked_ingredients:["olives"]` →
  rows in `user_food_prefs`; GET reflects them; a pre-existing dislike from the swipe loop on a
  different value is preserved unless the PUT omits it (document the replace semantics).

### Deployment
Additive migration (new columns `weekly_budget_cents`, `weekly_meals` JSON on `user_preferences`);
backwards-compatible (old code ignores new columns). Deploy server before wiring the app (WI-4).

### Production Verification
Authenticated `GET /v1/preferences` returns 200 with the new fields; `PUT` then `GET` shows the change;
error rate on the route stays flat.

---

## WI-2 — Durable un-swipe (resolves Q-11)

### Background
The deck's Undo is client-side pre-commit only. A durable backtrack (undo an already-recorded swipe)
needs a delete endpoint that also reverses the cookbook filing so the recipe re-enters the deck.

### Objective
Add `DELETE /v1/recipes/:id/swipe` that removes the `(user,recipe)` swipe row and, if the swipe was a
`like`/`save`, removes the recipe from the corresponding system cookbook (Liked/Saved).

### Acceptance Criteria
1. Given a recorded swipe, when the user `DELETE /v1/recipes/:id/swipe`, then `200`/`204`, the
   `recipe_swipes` row is gone, and the recipe is eligible for the deck again (not in `excludedRecipeIds`).
2. Given the deleted swipe was a `like`, then the recipe is removed from the **Liked** system cookbook;
   a `save` → removed from **Saved**.
3. Given no swipe exists for `(user,recipe)`, when deleting, then it is idempotent (`204`, no error).
4. Given no/invalid bearer, then `401`.

### Test Cases
- **TC-2a** like→unswipe: swipe like, delete, assert row gone + not in `excludedRecipeIds` + removed
  from Liked cookbook.
- **TC-2b** idempotent: delete with no prior swipe → 204, no throw.
- **TC-2c** dislike→unswipe: swipe dislike, delete → row gone, deck-eligible again.
- **TC-2d** auth: delete without bearer → 401.

### Deployment
No schema change (delete only). Additive route. Backwards-compatible.

### Production Verification
A recorded like, then DELETE, then the recipe reappears in a fresh deck fetch; Liked cookbook count
drops by one.

---

## WI-3 — Wire the swipe deck into the app

### Background
`SwipeDeck` is mock-backed in the studio. The app needs it on a real screen fetching the ranked deck
and posting swipes, with optimistic UI + rollback (design O-01/O-02).

### Objective
Add real `useDeck()` and `useSwipe()` hooks (`lib/api/`) calling `GET /v1/recipes/deck` and
`POST /v1/recipes/:id/swipe` (+ `DELETE` for undo), and render `SwipeDeck` on the `discover` tab —
without breaking the mock-backed studio study.

### Acceptance Criteria
1. Given the discover tab, when opened, then it fetches `GET /v1/recipes/deck?limit=5` and renders the
   returned cards (loading shimmer first; empty state on `[]`).
2. Given a swipe, then the card animates away optimistically and `POST …/swipe` fires; on failure the
   card is restored (rollback) with the error toast.
3. Given the studio `SwipeDeck` study, then it still renders from the mock (no server needed).
4. Given a settings save (WI-4), then the deck query is invalidated so the next fetch re-ranks.

### Test Cases
- **TC-3a** Component accepts injected data/handlers so both mock (studio) and real (app) hosts work;
  typecheck clean; studio study renders unchanged in-sim.
- **TC-3b** (manual, needs server) discover tab loads real cards; swipe posts; empty state on exhaustion.

### Deployment
Frontend only. Ship behind the existing app nav; the `discover` tab was hidden, so this is additive.

### Production Verification
Discover tab shows real recipes; a swipe appears in the user's Liked/Saved; deck advances.

---

## WI-4 — Wire the settings screen into the app

### Background
`SettingsScreen` edits a local draft seeded from `DEFAULT_PREFERENCES`. It must read/persist via WI-1.

### Objective
Add `usePreferences()` + `useUpdatePreferences()` hooks over `GET/PUT /v1/preferences`, seed the
settings draft from the query, and persist on Save (invalidating deck + preferences) — studio study
stays mock-backed.

### Acceptance Criteria
1. Given settings opened in-app, when it mounts, then it fetches `GET /v1/preferences` and seeds all
   controls (incl. `MealCounts`, weekly budget, filters).
2. Given the user edits and taps Save, then `PUT /v1/preferences` persists the draft and invalidates
   the `preferences` + `deck` queries.
3. Given the studio `SwipeSettings` study, then it still renders from the mock (no server).
4. Given a failed save, then an error toast; the draft is not lost.

### Test Cases
- **TC-4a** `SettingsContent` takes an initial-preferences prop/hook injection so studio (mock) and app
  (real) both work; typecheck clean; studio study renders unchanged.
- **TC-4b** (manual, needs server) edit + Save persists; reopening shows saved values; deck re-ranks.

### Deployment
Frontend only; depends on WI-1 deployed. Additive.

### Production Verification
Change a setting, Save, reopen → persisted; the next deck reflects the change.

---

## Appendix — Changelog
| Date | Author | Change |
| --- | --- | --- |
| 2026-08-19 | Jordan Gaston | Initial specs: WI-1 preferences API, WI-2 un-swipe, WI-3 deck wiring, WI-4 settings wiring. Grounded in a server + app codebase pass. |
