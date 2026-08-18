# WI-RANK-4 — Swipe deck & feedback capture

> Part 4 for the ranking engine. See `docs/ranking-engine/DESIGN.md` § Swipe deck & feedback loop.
> Depends on: WI-RANK-1 (`PreferenceRepository`, `UserPreferences`), WI-RANK-2 (`RankingEngine`),
> WI-RANK-3 (`listRankable`), and the nullable `recipes.user_id` (commit `0e9097a`).

## Background

The ranked list is consumed as a Tinder-style swipe deck (`DESIGN.md` § Swipe deck). This work item
builds the **buildable-now** slice over owned recipes (globals unioned in but empty until Q-04's corpus
lands): the `recipe_swipes` table, a `cookbooks.system_slug` marker, the deck endpoint, and the swipe
endpoint with its two side-effects (like → Liked cookbook; reasoned dislike → preference tuning — the
first write-path into `user_preferences`).

Read `DESIGN.md` § Swipe deck for the full design; this spec pins the acceptance criteria and tests.

## Objective

Ship `GET /v1/recipes/deck` and `POST /v1/recipes/:id/swipe`, backed by a `recipe_swipes` table and the
`cookbooks.system_slug` column, reusing the existing `RankingEngine` and repositories.

## Acceptance Criteria

1. **`recipe_swipes` table + migration** exactly per `DESIGN.md` § Table: recipe_swipes —
   `user_id`/`recipe_id` (both fk cascade, composite pk), `direction` enum `['like','dislike']`,
   `reason` enum `['too_expensive','too_hard','too_slow','disliked_ingredient','not_nutritious','other']`
   nullable, `score` real not null, `weights` json (the six-weight object) not null, `created_at`
   timestamp not null; index `(user_id, created_at)`.

2. **`cookbooks.system_slug`** — nullable text column, unique per `(user_id, system_slug)`. `NULL` = an
   ordinary user cookbook. Additive migration.

3. **`GET /v1/recipes/deck?limit=5`** (guarded) returns the next batch of deck cards:
   - Candidate set = recipes with `user_id = caller OR user_id IS NULL` (owned ∪ global),
   - **minus** any recipe the user has a `like` swipe for (permanent) **or** any swipe within
     `SWIPE_COOLDOWN_DAYS` (config, default 7),
   - ranked by `RankingEngine`, top `limit` (default 5, max 50).
   - Response shape mirrors `/v1/recipes/ranked`: `{ recipes: [{ recipe, score, breakdown }] }`. No
     `page_token` — the deck advances by swiping, not paging.

4. **`POST /v1/recipes/:id/swipe`** (guarded), body `{ direction: 'like'|'dislike', reason?, reason_detail? }`:
   - Validates the recipe is visible to the caller (owned or global); 404 otherwise.
   - Computes the **snapshot**: load prefs, build the recipe's `RankableRecipe`, `rank([it], prefs)` →
     `score`; `weights` = `prefs.weights`. Upserts a `recipe_swipes` row (pk `(user_id, recipe_id)`,
     re-swipe overwrites) with `direction`, `reason ?? null`, `score`, `weights`, `created_at`.
     The snapshot uses the **pre-tune** weights (what produced the card the user saw); tuning applies after.
   - **`like`** → ensure the caller's `system_slug='liked'` cookbook exists (lazily create, name
     "Liked"), then add the recipe to it (idempotent — `cookbook_recipes` on-conflict-do-nothing).
   - **`dislike` + `reason`** → tune (the first write into `user_preferences`):
     `too_expensive→weight_cost`, `too_hard→weight_difficulty`, `too_slow→weight_time`,
     `not_nutritious→weight_nutrition`, each `+1` capped at 3. `disliked_ingredient` with a
     `reason_detail` (the ingredient value) → add a `user_food_prefs` dislike
     `(primary_ingredient, reason_detail)`; without `reason_detail`, record-only. `other`/no reason →
     record-only. Tuning that targets a user with no `user_preferences` row first materializes the
     cold-start defaults (from `PreferenceRepository`) as a row, then applies the nudge.
   - Returns `200 { swipe: { direction, reason, score } }`.

5. **Snapshot fidelity.** The stored `weights` equals the weights used to score the card, and `score`
   equals `round(rank([recipe], prefs).score * 100, 1)` (same 0–100 one-decimal convention as the deck).

6. **Tuning takes effect at the next deck fetch, not mid-swipe** (a consequence of #3/#4 being separate
   requests — no in-request re-rank needed; just verify a bumped weight changes a subsequent deck order).

7. **Auth.** Both endpoints 401 without a valid bearer. Swiping another user's owned (non-global)
   recipe → 404 (not visible).

## Test Cases

Integration tests at `server/test/swipe-deck.test.ts` (mirror `server/test/ranked-recipes.test.ts`:
`migratedFileDb()` + `buildApp(db)` + `app.request`, mint a bearer via `POST /v1/users`, seed via
`db.insert`). Repo/tuning unit tests where a pure boundary exists (e.g. reason→signal mapping).

### TC1: Deck returns ranked unswiped cards
Seed 3 owned recipes; `GET /v1/recipes/deck?limit=5` → 200, all 3 in ranked order, each with score+breakdown.

### TC2: Swiped cards leave the deck
Swipe `dislike` on the top card; refetch deck → that recipe is absent; the rest remain in order.

### TC3: Like adds to the Liked cookbook
`POST /v1/recipes/:id/swipe {direction:'like'}` → 200. A `system_slug='liked'` cookbook exists for the
user containing that recipe. A second like on another recipe reuses the same cookbook (not duplicated).
The liked recipe is absent from the deck permanently (even past the cooldown).

### TC4: Snapshot captured
After a swipe, the `recipe_swipes` row has non-null `score` and a `weights` JSON equal to the user's
current weights.

### TC5: Reasoned dislike tunes weights
Cold-start user (no `user_preferences` row). `POST swipe {direction:'dislike', reason:'too_expensive'}`
→ a `user_preferences` row now exists with `weight_cost` = coldstart+1 (capped 3); other weights =
their cold-start values. A subsequent `too_expensive` dislike caps `weight_cost` at 3.

### TC6: Disliked-ingredient adds a food-pref
`POST swipe {direction:'dislike', reason:'disliked_ingredient', reason_detail:'liver'}` → a
`user_food_prefs` row `(primary_ingredient, 'liver', 'dislike')` exists. Without `reason_detail`, no
food-pref row is written (record-only).

### TC7: Cooldown resurfacing
A `dislike`d recipe (no permanent exclusion) with `created_at` older than `SWIPE_COOLDOWN_DAYS`
reappears in the deck; one swiped within the window does not.

### TC8: Auth & visibility
Deck/swipe without a bearer → 401. Swiping a recipe owned by a *different* user → 404.

### TC9: Empty deck
User with no visible unswiped recipes → `GET deck` returns `200 { recipes: [] }`.

## Test Run
_To be filled in: `npm test -- swipe-deck` (+ any unit files), pass/fail per case._

## Deployment Strategy

Two additive migrations (`recipe_swipes` table; `cookbooks.system_slug` column) — backwards-compatible,
run before/with the code. New routes only. Rollback = revert code; the table/column stay harmless
(empty column is `NULL` everywhere). No data migration.

## Production Verification

### PV1: Swipe loop works end to end
Deployed; a test account with a few recipes. Fetch the deck, `like` one and `dislike` another (with a
reason). Confirm: the liked recipe appears in the account's Liked cookbook and leaves the deck; the
disliked recipe leaves the deck; `recipe_swipes` rows carry score+weights; the reason bumped the mapped
weight in `user_preferences`.

## Production Verification Run
_To be filled in during execution._
