# WI-RANK-3 — `GET /v1/recipes/ranked` endpoint

> Part 3 of 3 for the ranking engine. See `docs/ranking-engine/DESIGN.md`.
> Depends on: WI-RANK-1 (`PreferenceRepository`) and WI-RANK-2 (`RankingEngine`).

## Background

WI-RANK-1 stores preferences; WI-RANK-2 ranks in memory. This work item exposes the ranked catalog
over HTTP: load the caller's preferences and their recipes-with-signals, run the engine, and return the
ordered list. It also adds the one repository query that assembles a `RankableRecipe` (recipe columns +
categories + allergens + diet verdicts) — the engine's typed input.

Stack facts (verified): Hono app built in `server/src/index.ts`; routes registered as
`app.get(path, guard, handler)`; `authGuard` sets `c.get('authUserId')` and returns
`{ error: { code, message } }` `401` when unauthenticated. List endpoints are cursor-paginated with
`page_token` (base64url `epoch_seconds|id`), fetching `limit + 1` to detect more.

## Objective

Add `GET /v1/recipes/ranked`: authenticated, returns the caller's recipes ordered best-first by the
ranking engine, with a per-recipe score and signal breakdown, cursor-paginated.

## Acceptance Criteria

1. **New repository query.** `RecipeRepository.listRankable(userId): Promise<RankableRecipe[]>` (or a
   service method wrapping it) loads every recipe the user owns, joined with its `recipe_categories`
   (grouped into `{cuisine, dishType, primaryIngredient}`), its `allergens`/`allergens_complete`
   (parsed into `{contains, mayContain, complete}`), and its `recipe_diets` verdicts (into a
   `dietFit` map). `nrfScore`, `costPerServingCents`, `totalMinutes`, `difficultyBand`, `createdAt`
   come from the recipe row; `popularity` is `null`. No N+1 — categories/diets loaded via joins or a
   batched second query keyed by recipe id. [ASSUMPTION: ranking covers recipes the user **owns**
   (`recipes.user_id = caller`); cookbook-shared recipes are out of scope for v1, matching the design's
   "caller's own catalog".]

2. **Endpoint wired in `src/index.ts`.** `app.get('/v1/recipes/ranked', guard, handler)`. The handler:
   reads `authUserId`; loads preferences via `PreferenceRepository.getPreferences`; loads recipes via
   `listRankable`; calls `RankingEngine.rank`; paginates; returns JSON.

3. **Response shape.** `200` with
   `{ recipes: [{ recipe: PublicRecipeCard, score: number /*0–100, one decimal*/, breakdown: Record<string,number> }], page_token: string | null }`.
   `recipe` reuses the existing public recipe card projection. Order is score-descending with the
   engine's tie-breaks.

4. **Pagination over a ranked list.** Because ranking is global, the handler ranks the full owned
   catalog, then slices the page. `page_token` encodes the next index into the ranked list
   (base64url integer); absent token = start at 0. Returns `page_token = null` on the last page. Default
   `page_size = 50`, max 200, via a Zod query schema mirroring `listRecipesQuerySchema`.
   [ASSUMPTION: recompute-per-request is acceptable at v1 catalog sizes; `DESIGN.md` Q-02 tracks moving
   to a precomputed rank table if it grows. An index cursor is stable within a request's ordering; a
   recipe added between page requests may shift positions — acceptable for v1, noted in Q-02.]

5. **Hard filters remove recipes from the response.** A recipe excluded by the engine (e.g. contains a
   severe-allergen the user declared) never appears in any page.

6. **Auth.** Without a valid bearer token the endpoint returns `401` with the standard error body and
   does no work.

7. **Cold-start works end to end.** A user with no `user_preferences` row still gets a ranked list
   (cold-start defaults from WI-RANK-1), not an error.

## Test Cases

Integration tests in `server/tests/e2e/ranked-recipes.test.ts` (or the existing integration harness),
using the real app + `migratedFileDb()`-style seeding. Mint a bearer as in existing tests.

### Test Case 1: Ranked order and breakdown
**Preconditions:** One user; seed the three worked-example recipes (R1 Chicken Piccata, R2 Pad Thai with
peanut, R3 Veggie Minestrone) with their signals; store Alice's preferences (peanut/severe, weights and
targets per `DESIGN.md`).
**Steps:** `GET /v1/recipes/ranked` with the bearer.
**Expected Outcomes:** `200`; `recipes` has length 2 (R2 filtered); order `[R1, R3]`; `recipes[0].score`
≈ 81.7, `recipes[1].score` ≈ 71.2; each has a non-empty `breakdown`.

### Test Case 2: Severe-allergen recipe absent
**Preconditions:** As above.
**Steps:** Inspect the response ids.
**Expected Outcomes:** R2's id appears in no page of the response.

### Test Case 3: Cold-start user
**Preconditions:** A user with `goals: ['eat_healthier']`, no `user_preferences` row, two recipes with
differing `nrfScore`.
**Steps:** `GET /v1/recipes/ranked`.
**Expected Outcomes:** `200`; both recipes returned, ordered with the higher-NRF recipe first (nutrition
weight bumped to 3 by the goal); no error.

### Test Case 4: Pagination
**Preconditions:** A user with e.g. 3 recipes; request `page_size=2`.
**Steps:** `GET /v1/recipes/ranked?page_size=2`, then follow `page_token`.
**Expected Outcomes:** First page returns 2 recipes and a non-null `page_token`; second page returns the
remaining 1 and `page_token: null`; the concatenation is the full ranked order with no duplicates.

### Test Case 5: Unauthenticated
**Steps:** `GET /v1/recipes/ranked` with no / an invalid bearer.
**Expected Outcomes:** `401`, body `{ error: { code: 'UNAUTHORIZED', message: ... } }`.

### Test Case 6: Empty catalog
**Preconditions:** A user with no recipes.
**Steps:** `GET /v1/recipes/ranked`.
**Expected Outcomes:** `200`, `{ recipes: [], page_token: null }`.

## Test Run
_To be filled in: `npm test -- ranked-recipes` output, pass/fail per case._

## Deployment Strategy

Additive endpoint; no schema change (WI-RANK-1 owns the migration). Single deploy after WI-RANK-1 and
WI-RANK-2 merge. Backwards-compatible — a purely new route. Rollback = revert the route registration;
the preference tables can stay (empty/harmless).

## Production Verification

### Production Verification 1: Ranked endpoint returns a filtered, ordered list
**Preconditions:** Deployed; a test account with a few recipes and at least one declared severe
allergen matching one recipe.
**Steps:** Call `GET /v1/recipes/ranked` with the account's bearer.
**Expected Outcomes:** `200`; recipes are score-descending; the allergen-containing recipe is absent;
each item carries a `score` and `breakdown`. A user with no preferences still gets a `200` list.

### Production Verification 2: Latency sane at real catalog size
**Steps:** Time the call for the largest real account.
**Expected Outcomes:** Responds within the app's normal list-endpoint latency budget. If not, open the
`DESIGN.md` Q-02 follow-up (precomputed rank table).

## Production Verification Run
_To be filled in during execution._
