# WI-2 — Client: first-run flow assembly, persistence & gating

## Background

Phase 1 built and approved the onboarding **archetype components** (`components/onboarding/screens.tsx`
+ `primitives.tsx`, all controlled/presentational, verified in the Design Studio). WI-2 sequences them
into the ordered first-run flow, wires persistence through the **existing** endpoints, gates first
launch, and hands off into the swipe deck. Depends on **WI-1** (server DTO/enum/gate contract).

Current client state (ground truth):
- `app/(onboarding)/` — existing flow (`welcome`, `goals`, `recipe-sources`, `when-cook`, `cook-time`,
  `how-heard`, `age`, `name`, `phone`, `verify-code`, `notifications`, `import-demo`, `awesome`, …) +
  `_layout.tsx`. Shared shell `components/recime/OnboardingScreen.tsx`; `ProgressHeader`.
- `app/index.tsx` — redirects to `/(onboarding)/welcome` **unconditionally** (no gate).
- `lib/onboarding.ts` — read-once accumulator draining into `POST /v1/users` (`name, goals,
  recipe_sources, cook_days, when_cook, cook_time, how_heard, age`).
- `components/swipe/mock.ts` — client `Preferences` type + `DEFAULT_PREFERENCES`. Preferences persist
  via the client's preferences hook → `PUT /v1/preferences` (`docs/client-caching.md` TanStack pattern).

Founder decisions (locked): **phone/OTP is the last step**; `name`/`age`/`how-heard`/`when-cook`/
`cook-time`/gender are **dropped**. Screens 18/19 use one **combined** cuisines+dish-types+ingredients
picker. Goals include **Kid-friendly meals** (`kid_friendly`). Gate on **`finished_onboarding`**
(derived from `onboardingCompletedAt`, WI-1).

## Objective

Sequence the approved archetypes into the ordered 21-screen first run ending in phone/OTP, accumulate
answers into a single in-memory draft, flush once on completion to `POST /v1/users` (goals + cook_days,
which stamps `onboardingCompletedAt`) and `PUT /v1/preferences` (all ranking fields incl. the WI-1
extensions), gate `app/index.tsx` on auth-session + `finished_onboarding`, and navigate into the deck.
Resilient to back-navigation (edits the draft; nothing persists until completion).

## Acceptance Criteria

1. **Ordered flow.** The onboarding stack renders, in order: (1) 3-slide value loader, (2) splash/
   welcome, (3–7) five typed value cards, (8) goals [incl. Kid-friendly], (9) stores, (10) budget,
   (11) household adults/kids, (12) meals (`MealCounts`), (13) cook-days, (14) time, (15) leftovers,
   (16) allergies, (17) diet, (18) likes [combined], (19) dislikes [combined], (20) confidence,
   (21) kitchen equipment, then **phone → verify** as the final step. Dropped screens
   (`name`/`age`/`how-heard`/`when-cook`/`cook-time`) are removed from the stack.
2. **Typing rule.** Value cards (3–7) type the headline with haptics; interactive screens (8–21) render
   headings instantly (already enforced by the components). OS Reduce Motion is honoured.
3. **Draft accumulation & back-nav.** Given a user advances then goes back and changes an answer, when
   they proceed, then the draft holds the latest value; no network write occurs mid-flow.
4. **Persistence on completion.** Given the user finishes phone/OTP (account created + authed), when the
   final step commits, then the client calls `POST /v1/users` with `{goals, cook_days}` (stamping
   `onboardingCompletedAt`) and `PUT /v1/preferences` with `skill_level, weekly_budget_cents,
   time_budget_minutes, weekly_meals, allergens, diets, owned_equipment, grocery_stores,
   household_adults, household_kids, eats_leftovers, likes[], dislikes[]`. A failed flush surfaces a
   retry (the user is not dropped into an empty deck with lost answers).
5. **First-launch gate.** Given a returning, authed user whose `finished_onboarding` is true, when the
   app launches (`app/index.tsx`), then it routes straight to the deck, skipping onboarding. Given no
   session or `finished_onboarding=false`, then it routes into onboarding.
6. **Hand-off.** On successful completion, the app navigates into the swipe deck, and the first deck
   reflects the just-saved preferences (e.g. a set budget/diet visibly filters).
7. **Model parity.** Client `Preferences` (`components/swipe/mock.ts`) gains `groceryStores: string[]`,
   `household: {adults:number; kids:number}`, `eatsLeftovers: boolean`, and `likes`/`dislikes` as
   `{facet,value}[]` (superseding `likedCuisines`/`dislikedIngredients`); the swipe Settings screen and
   its study still compile and render (update call-sites, no behaviour regression).
8. **Quality.** `npm run typecheck` clean; existing + new tests pass; the full flow runs in the iOS
   simulator end-to-end without crashes.

## Test Cases

### Test Case 1: Draft accumulation & flush (unit)
**Preconditions:** the onboarding draft store/hook in isolation with a mocked API client.
**Steps:** Set each screen's value through the draft; go back and change budget; call the completion flush.
**Expected Outcomes:** exactly one `POST /v1/users` and one `PUT /v1/preferences`, carrying the latest values incl. the changed budget; no writes fired before completion. A rejected flush leaves the draft intact and reports an error.

### Test Case 2: Gate logic (unit)
**Preconditions:** the `app/index.tsx` gate decision extracted to a pure/hook-testable function.
**Steps:** Evaluate with (a) no session, (b) session + `finished_onboarding=false`, (c) session + `finished_onboarding=true`.
**Expected Outcomes:** (a),(b) → onboarding route; (c) → deck route.

### Test Case 3: Full flow E2E (simulator, manual/scripted)
**Preconditions:** app on the iOS simulator against a dev server (WI-1 deployed); a fresh (unonboarded) session.
**Steps:** Walk all screens, answer each, complete phone/OTP (dev code), observe hand-off.
**Expected Outcomes:** each screen renders and advances; on completion the deck opens; `GET /v1/preferences` shows the answers; relaunching the app skips onboarding (gate).

### Test Case 4: Settings parity (typecheck + studio)
**Preconditions:** the client `Preferences` change applied.
**Steps:** `npm run typecheck`; open the `SwipeSettings` study.
**Expected Outcomes:** compiles; Settings renders and round-trips likes/dislikes via the new `{facet,value}` shape with no visual regression.

## Test Run
_To be filled during execution._

## Deployment Strategy

Ships after WI-1. The new flow is gated behind first-launch detection, so returning users are unaffected.
`[ASSUMPTION: no separate feature flag is required — the gate itself scopes exposure to new/unonboarded
users; if the team wants a kill-switch, add an Expo config flag around the entry redirect.]` Rollback:
revert the client; the WI-1 columns are inert to the old client.

## Production Verification

### Production Verification 1: New user completes onboarding
**Preconditions:** a fresh phone number on the production build.
**Steps:** Install/launch, complete onboarding through OTP.
**Expected Outcomes:** lands in the deck; `GET /v1/preferences` reflects the answers; `finished_onboarding=true`.

### Production Verification 2: Returning user skips
**Preconditions:** the account from PV-1, app relaunched.
**Steps:** Cold-launch the app.
**Expected Outcomes:** goes straight to the deck; onboarding is not shown.

## Production Verification Run
_To be filled during execution._
