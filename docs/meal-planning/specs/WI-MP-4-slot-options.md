# WI-MP-4 — Single-slot options + fill ("give me 4 alternatives")

## Background

When a user dislikes a planned meal, they want to fix it in one tap — not regenerate the whole week. This
work item adds a fast, synchronous "show me other options for this slot" flow: an endpoint that returns a
few preference-ranked alternatives for one (date, meal) slot, and an endpoint that sets the slot to the one
they pick.

It rides on the shipped engine (design: `docs/meal-planning/meal-planning-engine.md`, Option B). "Options
based on what the user likes" is exactly the `CandidateProvider` pool (WI-MP-2): `baseScore` folds the
preference **tier** (imported ≻ liked ≻ saved ≻ global) into the ranking-engine score (affinity, cost,
time, nutrition). So the options are the top of that pool for the slot — no new scoring, no LLM, no async
job. Depends on WI-MP-1 (`meal_plan_entries.source`) and WI-MP-2 (`CandidateProvider`, `similarity`).
Independent of WI-MP-3; see the note in Decisions on its relationship to WI-MP-3's `/regenerate`.

Domain terms (self-contained): a **slot** is one `(date, meal)` opening; **options** are ephemeral
ranked candidate recipes for a slot (never persisted); **fill** sets the slot to a chosen recipe.

## Objective

Ship `GET /v1/meal-plan/slot-options` (up to N preference-ranked, MMR-diversified alternatives for a slot,
excluding the current pick, in-week duplicates, and recently-cooked recipes) and `POST /v1/meal-plan/slot`
(set the slot to a chosen recipe, replacing an existing generated entry, marked so a later week-regenerate
won't overwrite the deliberate pick).

## Acceptance Criteria

1. **Options are preference-ranked.** Given `GET /v1/meal-plan/slot-options?date=&meal=&limit=4`, when it
   runs, then it returns up to `limit` (default 4) recipes for that meal type, ordered by `baseScore`
   (tier + ranking), each with its card (id, title, image_url, total_minutes, cost_per_serving_cents) and
   `tier` — so imported/liked/saved recipes surface above well-ranked globals.
2. **Options are fresh.** Given the current week's committed entries, when options are built, then a recipe
   already used elsewhere in the same week, the recipe currently in this slot, and any recipe passed in
   `exclude` are omitted; recently-cooked recipes are excluded by the same `MEAL_COOLDOWN` recency as
   generation.
3. **Options feel varied.** Given a pool with near-duplicate top recipes, when the N options are chosen,
   then they are MMR-diversified (reusing `planning/similarity`) so the set is not N minor variations of
   one dish.
4. **Thin pool degrades.** Given fewer than `limit` eligible recipes, then the endpoint returns what it
   has (possibly zero) with 200 — never an error, never a fabricated repeat.
5. **Fill sets the slot.** Given `POST /v1/meal-plan/slot {date, meal, recipe_id}`, when the slot holds a
   `generated` entry, then that entry's recipe is replaced by `recipe_id`; when the slot is empty, a new
   entry is added; either way the resulting entry is marked so a later `replaceGenerated` (week-regen) does
   not overwrite it (see Q-01 for manual-vs-generated).
6. **Fill is validated + owner-scoped.** Given a `recipe_id` the caller can't see (not owned, not global)
   or a malformed date, then 404 / 400 respectively; a fill never touches another user's entries.
7. **Auth.** Given no bearer, both endpoints return 401.

## Test Cases

### Test Case 1: options ranked, fresh, diversified (AC 1, 2, 3, 4)
**Preconditions:** A user with liked + global dinner recipes (some near-duplicate cuisines); one dinner
already in the target week; one dinner cooked 3 days ago.
**Steps:** `GET /v1/meal-plan/slot-options?date=<in-week>&meal=dinner&limit=4&exclude=<current>`.
**Expected Outcomes:** ≤4 options; liked recipes rank above globals; the in-week recipe, the excluded
recipe, and the recently-cooked recipe are absent; the option set's total pairwise similarity is below the
top-4-by-score set (diversified). With only 2 eligible recipes, exactly 2 are returned, status 200.

### Test Case 2: fill replaces a generated slot, protects the pick (AC 5, 6)
**Preconditions:** A slot holding a `generated` entry (recipe A); recipe B visible to the caller.
**Steps:** `POST /v1/meal-plan/slot {date, meal:'dinner', recipe_id: B}`; then run a week regenerate over
the range (WI-MP-3, or `replaceGenerated` directly).
**Expected Outcomes:** After the fill, the slot holds B (A gone); after the regenerate, B survives (the
deliberate pick is not overwritten). A fill into an empty slot adds B. An unseeable `recipe_id` → 404.

### Test Case 3: auth (AC 7)
**Steps:** Call both endpoints without a bearer.
**Expected Outcomes:** 401 on both.

## Test Run

_To be filled during execution: integration-test output (offline stubs; tests never hit the network)._

## Deployment Strategy

Ship behind the same meal-planning client flag as WI-MP-3. Additive: one read endpoint, one write endpoint,
and (per Q-01) possibly a `setSlot` repository method. Rollback: hide the entry points via the flag; the
endpoints are inert if unused; no migration to reverse (WI-MP-1's `source` column already exists).

## Production Verification

### Production Verification 1: swap a disliked meal in one flow
**Preconditions:** Flag on for a test account with a generated week.
**Steps:** In the app, on a disliked dinner tap "other options," see 4 varied preference-ranked choices,
pick one; confirm the slot updates; run "generate my week" again.
**Expected Outcomes:** Options appear within the latency SLO (< ~500 ms, no async spinner); the chosen
recipe fills the slot and survives a subsequent week-regenerate. Verified against the live app + real DB.

## Production Verification Run

_To be filled during execution._

---

# Decisions (for scoping review)

## D-01 — A user-picked fill is protected from week-regeneration

**Framework:** Direct criterion — a deliberate choice should outrank an automated one.
**Choice:** When the user fills a slot from options, mark the entry so `replaceGenerated` (week-regen)
skips it. Two ways: (a) write it as `source='manual'` (reusing WI-MP-1's column — regen already preserves
manual), or (b) add a `pinned` flag. **Lean: (a) `source='manual'`** — zero new schema, and "the user
chose this" is semantically the same protection manual placement already gets. **Open for your call —**
the cost is that these picks then look identical to hand-placed entries in any manual/generated analytics.

## D-02 — Options reuse the engine; they are not a new ranker

**Framework:** Direct criterion — reuse over rebuild.
**Choice:** `slot-options` = `CandidateProvider.candidates(userId, meal, prefs)` → drop in-week +
excluded + current → MMR top-N (reusing `planning/similarity`). No new scoring path, so options and
full-plan generation can never diverge in what "the user likes" means.

## D-03 — Relationship to WI-MP-3's `/regenerate`

WI-MP-3 specced `POST /v1/meal-plan/regenerate` to auto-swap one slot to the next-best recipe. This feature
is the **interactive** version: return N options, let the user choose. They overlap. **Recommendation:**
`slot-options` + `slot` (this WI) is the better UX and likely **supersedes** the silent `/regenerate` — so
drop `/regenerate` from WI-MP-3 unless a "surprise me, just swap it" one-tap is also wanted. Flag for your
call so we don't build both.

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Mark a user-picked fill as `source='manual'` (reuse WI-MP-1) or add a distinct `pinned` flag? | open | Propose `source='manual'` — no new schema, same protection. Confirm the analytics tradeoff (D-01). |
| Q-02 | Default option count — 4 as the founder suggested, and is it caller-tunable via `limit`? | open | Propose default 4, `limit` capped at ~8. |
| Q-03 | Does `slot-options` supersede WI-MP-3 `/regenerate`, or do both ship? | open | Propose superseding it (D-03); keep a one-tap auto-swap only if product wants it. |
| Q-04 | Should options span meal-type flexibility (e.g. a brunch recipe offered for a breakfast slot)? | open | Propose the same meal-type mapping generation uses (brunch counts for breakfast); no extra scope. |

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-22 | Feature Lead (meal-planning) | Initial scope — single-slot options + fill, riding the WI-MP-2 CandidateProvider |
