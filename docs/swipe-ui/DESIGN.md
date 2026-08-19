---
tags: [swipe-ui], tdd
summary: "Recipe swipe deck + ranking-engine settings — interaction & UI design"
locked: false
---

# Swipe Deck & Settings — Design

## Reviews

| Reviewer | Status | Feedback |
| --- | --- | --- |
| frontend-architect (agent) | addressed | ponytail + refactoring-ui gate; 8 findings (`fa-1`…`fa-8`). 7 applied; `fa-5` kept by decision. |
| Jordan Gaston | reviewed → addressed | Ran the live prototype in-sim and left 10 pins; all 10 addressed (see changelog). All comment pins cleared afterward. |

---

## Context

The ranking engine ships a filter-then-rank recommender (`docs/ranking-engine/DESIGN.md`,
`EQUIPMENT-SIGNAL.md`, `MEAL-PREP-SIGNAL.md`) with a swipe/feedback API. This document designs the two
surfaces that sit on top of it:

- **The swipe deck** — a Tinder/Bumble-style card stack the user swipes to like or pass recipes. Likes
  flow into the Liked cookbook, which feeds meal planning. Dislikes optionally tune the ranking.
- **The settings surface** — the plain-language controls that expose the whole user-preference model
  (importance weights, targets, food likes/dislikes, and the hard filters: allergens, diets, equipment).

It consumes the backend contract verbatim; it never changes it. Where an interaction needs an endpoint or
field the contract does not provide, it is flagged as a **proposed backend follow-up**, not built (see
§ Interaction → backend mapping and § Open Questions).

**In scope:** the swipe interaction model, card anatomy, the dislike-reason/tuning loop, all deck states
(loading / empty / cooldown / error / offline), the settings surface (soft preferences vs. hard filters),
motion, accessibility, telemetry, and a swipeable/commentable prototype in the Design Studio.

**Out of scope (do not build):** onboarding / first-run preference capture (preferences already exist and
are edited only through settings; the sole tutorial element in scope is the first-use gesture hint), the
meal-planning algorithm (we only route likes toward it), the global-recipe corpus (Q-04 in the ranking
doc; the deck runs over owned recipes until it exists), and the native share extension.

Design goals, in order:

1. A competent engineer can implement the swipe UI and settings screen from this document with no further
   design decisions.
2. Every interaction traces to a specific backend endpoint or field; every gap is a flagged follow-up.
3. The experience mirrors the referenced Bumble swipe + filter patterns, adapted to recipes, inside
   Harvest's golden-hour design system and the `lib/motion.ts` scale.

---

## Consumed backend contract

The authoritative contract (from the task brief). The ranking design doc calls the deck endpoint
`GET /v1/recipes/deck`; the brief names it `GET /v1/recipes/ranked-deck`. **This document uses the brief's
names as authoritative** and flags the delta as Q-07.

- **Deck** — `GET /v1/recipes/ranked-deck?limit=N` → an array of ranked cards, each
  `{ recipe: <public recipe card>, score: 0–100, breakdown: { <signal> → normalized 0–1 } }`. No page
  token; the deck advances by swiping. It re-ranks on every fetch. Preference changes take effect at the
  **next** fetch, never mid-deck. Recently-swiped recipes are excluded by a cooldown; liked recipes are
  excluded permanently.
- **Swipe** — `POST /v1/recipes/:id/swipe` with `{ direction: 'like' | 'dislike', reason?, reason_detail? }`
  → `{ swipe: { direction, reason, score } }`. A `like` also adds the recipe to the Liked cookbook. A
  `dislike` with a reason tunes the ranking. The score/weights it was ranked with are snapshotted server-side.
- **Dislike reasons** — `too_expensive` → raises cost weight; `too_hard` → difficulty weight; `too_slow` →
  time weight; `not_nutritious` → nutrition weight; `disliked_ingredient` (with `reason_detail` = the
  ingredient) → adds a disliked-ingredient preference; `other` → records only.
- **Preference model the settings screen exposes** — soft-signal importance weights `0–3` for cost,
  difficulty, nutrition, affinity, time, meal-prep; targets skill_level (beginner/intermediate/advanced),
  budget per serving, time budget; liked/disliked cuisines, dish types, ingredients; hard filters —
  allergens (each `severe`/`moderate`/`mild`), diets (each `strict`/`flexible`), owned equipment plus an
  "I've reviewed my kitchen" flag that turns the equipment filter on.

## Interaction → backend mapping

Every interaction, the endpoint/field it consumes, and whether the contract serves it. **Flagged rows are
the gaps** — interactions the current API cannot serve, specified as proposed follow-ups (never built here).

| # | UI interaction | Backend endpoint / field | Status |
| --- | --- | --- | --- |
| 1 | Fetch a batch of cards | `GET /v1/recipes/ranked-deck?limit=5` → `[{recipe, score, breakdown}]` | ✅ served |
| 2 | Prefetch next batch at 1–2 cards left | second `GET …/ranked-deck` (re-ranks; cooldown excludes swiped) | ✅ served |
| 3 | Swipe **right** = like | `POST …/swipe {direction:'like'}` → adds to Liked cookbook | ✅ served |
| 4 | Swipe **left** = pass (no reason) | `POST …/swipe {direction:'dislike'}` (reason omitted → record only) | ✅ served |
| 5 | Reason chip after a pass | `POST …/swipe {direction:'dislike', reason}` → tunes the named weight | ✅ served |
| 6 | "Don't like an ingredient" → ingredient picker | `reason:'disliked_ingredient', reason_detail:<ingredient>` | ✅ served |
| 7 | "Just not feeling it" chip | `reason:'other'` (record only) | ✅ served |
| 8 | Card badges: total time, cost/serving, difficulty, nutrition, meal-prep, equipment, allergen/diet fit | recipe-card fields: `total_minutes`, `cost_per_serving_cents`, `difficulty_band`, `nrf_score`, `meal_prep_fit`, `recipe_equipment`, `allergens`/`diets` | ⚠️ **assumed** — the exact public-recipe-card DTO isn't in the contract; verify these fields are on the card (Q-08) |
| 9 | "Why this is ranked for you" line | `breakdown{signal→0–1}` + the card fields above | ✅ served |
| 10 | Expandable detail: ingredients, step preview, full metadata | recipe-card fields | ⚠️ **assumed** — if the deck card omits ingredients/steps, a `GET /v1/recipes/:id` detail fetch is needed (Q-08) |
| 11 | Empty / cooldown state | `ranked-deck` returns `[]` | ✅ served |
| 12 | Light "liked!" confirmation | client-only (uses the swipe response); no endpoint | ✅ served |
| 13 | Periodic "you've liked N — plan your week?" nudge | a running like-count | ⚠️ **gap** — no count field in the contract. Client tallies session likes; a durable count needs a Liked-cookbook size read (Q-09) |
| 14 | UP "Cook this week" super-action | none — `direction` is `like`\|`dislike` only | ⚠️ **gap** — prototype maps UP → `like`; a real "save to my week" needs `direction:'save'`/`'super_like'` + meal-plan wiring (Q-10) |
| 15 | Undo the last swipe | none — no un-swipe endpoint | ⚠️ **gap** — client-side pre-commit undo only (cancels the optimistic POST inside its delay window); undoing an already-recorded swipe needs `DELETE /v1/recipes/:id/swipe` (Q-11) |
| 16 | Settings: **view** current preferences | none documented | ⚠️ **gap** — needs `GET /v1/preferences` (Q-12) |
| 17 | Settings: **edit** weights, targets, food prefs, filters | none documented | ⚠️ **gap** — needs `PUT /v1/preferences` (Q-12) |
| 18 | Settings edits apply to the **next** batch | inherent — the deck re-ranks at the next fetch | ✅ served |
| 19 | Telemetry (swipe rate, like ratio, chip usage, time-per-card, exhaustion) | client `analytics.track` (`lib/analytics`) | ✅ served (client) |

**The three load-bearing gaps** the current API cannot serve, all deferred to backend follow-ups (Q-10–Q-12):
a preferences **read/write** endpoint for settings, a durable **un-swipe**, and a **save/super** direction.
None blocks the prototype (settings edits are local-draft in the studio; undo is pre-commit; UP is like-backed).

---

## Use Case Implementations

### F-01 Swipe through the deck

~~~mermaid
sequenceDiagram
    participant U as User
    participant D as SwipeDeck
    participant C as useDeck (cache)
    participant API as ranked-deck API
    participant S as useSwipe

    U->>D: opens deck
    D->>C: cards?
    C->>API: GET /ranked-deck?limit=5
    API-->>C: [{recipe, score, breakdown}] ×5
    C-->>D: batch (never reshuffles once in hand)

    loop each card
    U->>D: drag / tap like|pass|super|undo
    note over D: card animates away immediately (optimistic)
    D->>S: recordSwipe(id, direction, reason?)
    note over S: fire-and-forget + retry/rollback
    S->>API: POST /:id/swipe {direction, reason?}
    API-->>S: {swipe} (200) — or error → retry → rollback
    alt 1–2 cards remain
    D->>C: prefetch next batch
    C->>API: GET /ranked-deck?limit=5 (re-ranks; excludes swiped)
    API-->>C: next batch appended (tail only)
    end
    end
~~~

### F-02 Dislike-reason tuning loop — after a left swipe

~~~mermaid
sequenceDiagram
    participant U as User
    participant D as SwipeDeck
    participant R as ReasonSheet
    participant S as useSwipe
    participant API as swipe API

    U->>D: swipe left (pass)
    note over D: card is already gone (optimistic); a bare pass is posted immediately
    D->>S: recordSwipe(id, 'dislike')  %% no reason yet
    D->>R: present skippable reason chooser (slide-up, non-blocking)
    alt user taps a reason chip
    opt "Don't like an ingredient"
    R->>R: ingredient picker → reason_detail
    end
    R->>S: patchReason(id, reason, reason_detail?)
    S->>API: POST /:id/swipe {direction:'dislike', reason, reason_detail?}
    R-->>U: brief confirm toast ("We'll show fewer pricey recipes")
    else user dismisses / times out
    note over R: bare pass stands (reason:null); no confirm
    end
~~~

The reason chooser is **skippable and non-blocking**: the pass is already recorded, so the sheet only
*upgrades* it with a reason. `patchReason` re-POSTs the same `(user,recipe)` swipe (the server upserts one
verdict per recipe), attaching the reason. If the sheet is dismissed, the bare pass stands.

### F-03 Deck exhaustion (empty / cooldown)

~~~mermaid
sequenceDiagram
    participant D as SwipeDeck
    participant C as useDeck
    participant API as ranked-deck API
    C->>API: GET /ranked-deck?limit=5
    API-->>C: []  (all swiped, or cooldown)
    C-->>D: empty
    note over D: EmptyState — "You're all caught up" + CTAs → Settings, Meal plan
~~~

### F-04 Reward / return nudge

A `like` fires a light positive confirmation (haptic + a brief inline flourish — **not** a full-screen
match). A session like-counter drives a periodic nudge banner ("You've liked N — ready to plan your week?")
that routes to meal planning. Threshold `N` is a config constant (default 10; Q-09).

### F-05 Edit preferences (settings) — proposed

~~~mermaid
sequenceDiagram
    participant U as User
    participant P as SettingsScreen
    participant H as usePreferences
    participant API as preferences API (proposed)
    U->>P: opens settings
    P->>H: preferences?
    H->>API: GET /v1/preferences  %% Q-12 — proposed
    API-->>H: UserPreferences
    H-->>P: render controls (soft vs hard, grouped)
    U->>P: adjust slider / toggle filter / add dislike
    note over P: local draft; banner "applies to your next cards"
    U->>P: Save
    P->>H: save(draft)
    H->>API: PUT /v1/preferences  %% Q-12 — proposed
    note over H: invalidate deck cache → next fetch re-ranks
~~~

In the studio prototype F-05 runs against a **local draft** (no network); the diagram shows the intended
wiring once `GET`/`PUT /v1/preferences` exist.

---

## Card anatomy

A single full-bleed card (mirroring Bumble — one interactive card, one static card flush behind it, revealed
on drag; no scaled fan). `rounded-xl2` (20px), `bg-card`, soft shadow.

- **Hero photo** — full-bleed `expo-image`, cover, with a bottom-up scrim so overlaid text stays legible.
- **Title** — Karla bold, large, low-left over the photo.
- **"Why for you" line** — one plain-language sentence derived from `breakdown` + card fields, e.g.
  *"Italian + chicken you love, under budget, 25 min."* Built by ranking the top 2–3 breakdown signals and
  templating each (see § Why-line derivation).
- **At-a-glance badge row** — pill badges for the signals a diner cares about, each an icon + short value:
  - **Time** `⏱ 25 min` (`total_minutes`)
  - **Cost** `$ 3.50/serv` (`cost_per_serving_cents`)
  - **Difficulty** `● Intermediate` (`difficulty_band`)
  - **Nutrition** `♥ Nutritious` when `nrf_score` is high (thresholded)
  - **Meal-prep** `▣ Meal-prep` only when `meal_prep_fit === 'designed'` (per MEAL-PREP-SIGNAL badge rule)
  - **Equipment** `▲ Air fryer` when the card requires owned-or-unowned notable equipment
  - **Compatibility** `✓ Vegan · Nut-free` derived from `diets`/`allergens` vs. the user's filters
- **Detail affordance** — a peeking "Recipe details" handle at the card's lower edge (Bumble's white
  "talk about" teaser analog). Tapping or swiping it up opens the **DetailSheet**: ingredients, a 3-step
  preview, full metadata, and the full "why" breakdown as labeled bars.

### Why-line derivation (from `breakdown`)

Take the `breakdown` map (`signal → 0–1`), drop signals below a floor (0.5), sort desc, take the top 3, and
template each into a phrase, then join. Templates (examples): `affinity` → "{liked cuisine} + {liked
ingredient} you love"; `cost` → "under your budget"; `time` → "{total_minutes} min"; `nutrition` →
"nutritious"; `difficulty` → "matches your skill"; `meal_prep` → "great for meal prep". This uses only
documented fields — no invented scores.

---

## Entities (client view models)

~~~mermaid
classDiagram
    class DeckCard {
        +Recipe recipe
        +number score
        +Map~string,number~ breakdown
    }
    class SwipeIntent {
        +string recipeId
        +Direction direction
        +DislikeReason reason
        +string reasonDetail
        +CommitState state
    }
    class PreferenceDraft {
        +SkillLevel skillLevel
        +int budgetCentsPerServing
        +int timeBudgetMinutes
        +Weights weights
        +AllergenPref[] allergens
        +DietPref[] diets
        +Equipment[] ownedEquipment
        +bool equipmentReviewed
        +FoodPref[] foodPrefs
    }
    class StudioComment {
        +string id
        +number xPct
        +number yPct
        +string author
        +string body
        +CommentStatus status
    }
    DeckCard "1" --> "1" SwipeIntent : produces
~~~

`DeckCard`, `Weights`, `AllergenPref`, `DietPref`, `FoodPref` mirror the ranking doc's shapes (consumed,
not redefined). `SwipeIntent.state ∈ {pending, committed, failed, rolledBack}` drives optimistic UI.
`StudioComment` is prototype-only (§ Design Studio prototype).

---

## Client state & caching

No new server tables — this surface consumes the ranking engine. Client state follows the repo's TanStack
Query pattern (`docs/client-caching.md`): a `queryKeys` factory, `useQuery` read hooks, long staleTime +
invalidate-on-mutation, persisted to AsyncStorage.

| Key | Read hook | Contents | Invalidated by |
| --- | --- | --- | --- |
| `deck` | `useDeck()` | the current batch (append-only in a session; never reshuffled in-hand) | a settings save (`PUT /preferences`) drops it so the next fetch re-ranks |
| `preferences` | `usePreferences()` | the user's `UserPreferences` (proposed `GET /v1/preferences`) | a settings save |
| `swipe` (mutation) | `useSwipe()` | optimistic swipe with retry + rollback; not cached | — |

**Optimistic swipe (O-01).** On a swipe the card animates away and a `SwipeIntent{state:pending}` is
enqueued. After a short commit window (allows Undo), the POST fires fire-and-forget. On success →
`committed`. On failure → retry (bounded backoff); if it still fails → `rolledBack`: the card is restored to
the **front** of the in-hand batch and a quiet toast explains. A swipe is never lost or double-counted: the
`(user,recipe)` key is idempotent server-side (upsert), and the client dedupes by `recipeId`.

**Prefetch (O-02).** When the in-hand batch reaches ≤ 2 cards, `useDeck` fetches the next batch and appends
it to the **tail**. The cards already in hand keep their order — only new cards arrive re-ranked, honoring
the contract's "changes apply to the next batch, not the current hand."

---

## Modules

~~~mermaid
classDiagram
    class SwipeDeck {
        +render() ReactNode
    }
    class SwipeCard {
        +recipe DeckCard
        +onSwipe(Direction, reason?)
    }
    class GestureLayer {
        <<reanimated + gesture-handler>>
        +Pan → translateX/rotate/overlay
    }
    class CardBadges
    class WhyLine
    class DetailSheet
    class ReasonSheet
    class IngredientPicker
    class ActionBar {
        +undo, pass, super, like buttons
    }
    class EmptyState
    class RewardToast
    class NudgeBanner
    class GestureHint
    class SettingsScreen
    class FilterSection
    class CommentLayer
    class useDeck
    class useSwipe
    class usePreferences

    SwipeDeck --> SwipeCard
    SwipeDeck --> ActionBar
    SwipeDeck --> EmptyState
    SwipeDeck --> RewardToast
    SwipeDeck --> NudgeBanner
    SwipeDeck --> GestureHint
    SwipeCard --> GestureLayer
    SwipeCard --> CardBadges
    SwipeCard --> WhyLine
    SwipeCard --> DetailSheet
    SwipeDeck --> ReasonSheet
    ReasonSheet --> IngredientPicker
    SwipeDeck --> useDeck
    SwipeDeck --> useSwipe
    SettingsScreen --> FilterSection
    SettingsScreen --> usePreferences
~~~

- **`SwipeCard` / `GestureLayer`** — the top card is gesture-interactive via **RN core `PanResponder` +
  `Animated.ValueXY`** (not reanimated — see D-07): drag drives `translateX/Y`, an interpolated `rotate`
  (arc, small ±8° tilt), and a **monochrome frosted ✓/✗ disc** whose opacity interpolates with drag
  distance (Bumble's calmer feedback, not colored word-stamps). Past a threshold, release flings the card
  off (`Animated.timing`, `useNativeDriver:false`, ~`DURATION.fast`); below threshold it springs back
  (`Animated.spring`). The `Animated.View` carries **only the transform**; the styled card is a child
  `View` with `className` — colors never sit on the animated view (the documented NativeWind-in-
  `Animated.View` pitfall).
- **`ActionBar`** — button equivalents for every gesture: **Undo**, **Pass**, **Super ("Cook this week")**,
  **Like**. Full accessibility parity (§ Accessibility). Order left→right: undo, pass, super, like.
- **`ReasonSheet` / `IngredientPicker`** — the skippable dislike-reason chooser (a `Modal animationType=
  "slide"` per the design system), chips: *Too expensive · Too hard · Takes too long · Not nutritious
  enough · Don't like an ingredient → picker · Just not feeling it*. Confirms briefly on choice.
- **`SettingsScreen` / `FilterSection`** — the preference surface. Soft sliders (0–3) and hard filters,
  visibly separated (§ Settings surface).
- **`CommentLayer`** — the studio-only on-canvas comment pins (§ Design Studio prototype).
- **Hooks** — `useDeck` (batch + prefetch + empty), `useSwipe` (optimistic + retry/rollback),
  `usePreferences` (read/draft/save). In the prototype these are backed by an in-memory mock; in the app
  they wrap the real endpoints.

---

## APIs (consumed)

Documented in the ranking design; restated here as consumed contracts. **Proposed** endpoints (Q-10–Q-12)
are marked and not built.

### Ranked Deck `GET /v1/recipes/ranked-deck`
Top-N unswiped ranked cards for the caller. Query `limit` (default 5). Response `[{ recipe, score:0–100,
breakdown:{signal→0–1} }]`. No page token. Re-ranks per fetch; cooldown excludes recently-swiped; likes
excluded permanently.

### Record Swipe `POST /v1/recipes/:id/swipe`
Body `{ direction:'like'|'dislike', reason?, reason_detail? }`. Response `{ swipe:{ direction, reason,
score } }`. `like` → Liked cookbook; reasoned `dislike` → tunes ranking. Idempotent per `(user,recipe)`.

### Preferences `GET/PUT /v1/preferences` — **proposed (Q-12)**
`GET` → the `UserPreferences` model (weights, targets, food prefs, allergens+severity, diets+strictness,
owned equipment + reviewed flag). `PUT` upserts it. Needed by the settings surface; not in the current
contract.

### Un-swipe `DELETE /v1/recipes/:id/swipe` — **proposed (Q-11)**; Save direction — **proposed (Q-10)**.

---

## Interaction & motion

All timings reference `lib/motion.ts` — never hardcoded. Opens are slower than closes.

| Interaction | Token | Notes |
| --- | --- | --- |
| Card fling-off on commit | `DURATION.fast` (250), `EASE.smoothOut` | arc: translate + rotate together, pivot low |
| Card spring-back (below threshold) | spring | no bounce on the incoming card (already in place) |
| Reason sheet / detail sheet open | `Modal animationType="slide"` + `DURATION.medium` (350) | native slide + scrim; **open slower** |
| Sheet close | `DURATION.fast` (250) | gets out of the way |
| Confirm toast | `TOAST` (in 350 / out 250, rise 16) | reuses the toast token |
| Like flourish | `DURATION.quick`–`fast` | light, non-blocking |
| Drag ✓/✗ disc | continuous | opacity ∝ drag distance; no travel token |

**Reduce Motion** — honor `AccessibilityInfo.isReduceMotionEnabled()`: skip the fling arc and sheet travel
(cross-fade / instant place instead), keep the state change. Gestures still work; only the travel is removed.

---

## Accessibility

- **Gesture ↔ button parity.** Every gesture has an `ActionBar` button with a VoiceOver label: Undo
  ("Undo last swipe"), Pass ("Pass on {title}"), Super ("Cook this week — save {title} to your plan"), Like
  ("Like {title}"). The card exposes `accessibilityActions` (magic-tap = like) so VoiceOver users never need
  the drag.
- **Reason chips** are buttons with descriptive labels ("Too expensive — show fewer pricey recipes").
- **Badges** carry `accessibilityLabel`s ("25 minutes", "3 dollars 50 per serving", "intermediate
  difficulty") so the glanceable row is legible to screen readers.
- **Contrast** — all text/badges meet WCAG 2.1 AA (4.5:1 text, 3:1 UI); the photo scrim guarantees title
  contrast over any image.
- **Reduce Motion** honored throughout (above).

---

## States

| State | Trigger | UI |
| --- | --- | --- |
| Loading | first fetch in flight | a single card-shaped shimmer on `bg-card` (no spinner-on-blank) |
| Empty / cooldown | `ranked-deck` → `[]` | "You're all caught up — check back later, or tweak your preferences." CTAs → **Settings**, **Meal plan** |
| Error | fetch fails | inline retry card ("Couldn't load recipes — Retry"); last good batch stays swipeable if present |
| Offline | no connectivity | swipes queue locally (optimistic) and flush on reconnect; a subtle "offline — saved" chip; deck served from the persisted cache |
| Swipe rollback | POST failed after retries | the card returns to the front; quiet toast "Didn't save — try again" |

---

## Telemetry

Client `analytics.track` (`lib/analytics`). Events instrument the UX study; each ties to a study metric.

| Event | Properties | Study metric |
| --- | --- | --- |
| `Deck Card Shown` | `recipeId, score, position` | time-per-card (with next event), exposure |
| `Recipe Swiped` | `recipeId, direction, method:'gesture'\|'button', score, msVisible` | swipe rate, like ratio, time-per-card |
| `Swipe Reason Chosen` | `recipeId, reason, hadDetail` | reason-chip usage |
| `Swipe Reason Skipped` | `recipeId` | reason-chip skip rate |
| `Deck Exhausted` | `swipesThisSession` | deck-exhaustion rate |
| `Card Detail Expanded` | `recipeId` | detail-open rate |
| `Plan Nudge Shown` / `Plan Nudge Tapped` | `likeCount` | nudge → meal-plan conversion |
| `Settings Preference Changed` | `control, from, to, kind:'soft'\|'hard'` | which controls users touch |

Like ratio = `like / (like+dislike)`; swipe rate = swipes / active minute; time-per-card = `msVisible`
between `Deck Card Shown` and `Recipe Swiped`.

---

## Deployment

Frontend-only; no migrations here (the ranking tables shipped separately). New screens behind the app's
normal navigation.

| Order | Type | Description | Backwards-compatible |
| --- | --- | --- | --- |
| 1 | code | Ship `SwipeDeck`, `SettingsScreen`, hooks; Design Studio prototype (dev-only) | yes |
| 2 | backend follow-up | `GET/PUT /v1/preferences` (Q-12) so settings persist | yes — additive |
| 3 | backend follow-up (optional) | `DELETE …/swipe` (Q-11), `direction:'save'` (Q-10) | yes — additive |

**Rollback:** revert the client; the ranking API is untouched. Until the preferences endpoint lands, settings
is read-only-preview or drafts locally — it degrades, never breaks the deck.

---

## Monitoring

Client metrics (above) power the UX-study dashboard: swipe rate, like ratio, reason-chip usage, time-per-card,
deck-exhaustion rate, nudge conversion. A sustained **deck-exhaustion spike** flags over-filtering upstream
(pair with the ranking engine's `ranked_filtered_ratio`). A **reason-skip rate near 1.0** flags a
too-heavy reason loop.

---

## Decisions

### D-01 UP super-swipe is prototype-only, like-backed
**Framework:** Direct criterion — contract fidelity + scope. The contract's `direction` is `like`|`dislike`;
"save to my week" needs a `save`/`super_like` direction *and* meal-plan wiring, both out of scope. Right-swipe
`like` already reaches the Liked cookbook → meal planning, so the path exists without a new direction.
**Choice:** Ship the UP gesture + Super button in the prototype. **Per human review it opens a cookbook
picker** — the user chooses which cookbook to save to before the card leaves — still like-backed today,
pending backend `direction:'save'` **with a cookbook target** (Q-10). *Alternatives:* omit UP (rejected —
the brief wants the affordance designed); build the endpoint (rejected — out of scope).

### D-02 Monochrome frosted ✓/✗ disc, not colored word-stamps
**Framework:** Direct criterion — match the reference + the calm golden-hour palette. Bumble uses a quiet
grey ✓/✗ disc scaling with drag, not Tinder's green/red LIKE/NOPE wash. It reads premium and fits the
restrained palette. **Choice:** frosted disc, opacity ∝ drag. *Alternative:* colored full-card tint (rejected
— louder than the design system).

### D-03 Per-filter hard-vs-soft is explicit grouping, not a Bumble "…if I run out" toggle
**Framework:** Direct criterion — the backend model. Bumble auto-relaxes a hard filter when supply runs out;
our ranking engine has **no such fallback** — allergens/strict-diets/required-equipment simply *hide*
recipes, and the soft weights only *reorder*. Inventing a "relax if I run out" toggle would imply backend
behavior that doesn't exist. **Choice:** mirror Bumble's *clarity* (plain-language, question-headed sections,
values echoed in words) but express hard-vs-soft as **two visibly separated groups** — "Filters (hide
recipes)" vs. "Preferences (reorder)" — matching the real semantics. *Alternative:* copy the "if I run out"
toggle (rejected — misrepresents the engine; Q-13 if a fallback is ever built).

### D-04 Optimistic swipe with a pre-commit Undo window
**Framework:** Direct criterion — never lose/double-count a swipe, with an accessible Undo despite no
un-swipe endpoint. The card animates away instantly; the POST fires after a short window; Undo within the
window cancels the POST entirely (nothing recorded). **Choice:** client-side pre-commit undo; a durable undo
of a recorded swipe is a follow-up (Q-11). *Alternative:* block on the POST (rejected — a loading stall per
swipe).

### D-05 Studio comments = on-canvas pins seeded from a committed file
**Framework:** Direct criterion — the agent and the human both need to comment, versioned. **Choice:** numbered
pins over the canvas; durable/shared comments live in a committed `design/comments/SwipeDeck.comments.ts`
(the frontend-architect agent appends there); in-app pins a human drops during review persist to AsyncStorage
(dev-local) and render alongside. *Alternative:* a dev write-endpoint (rejected — YAGNI for a prototype).

### D-07 Gesture via RN `PanResponder` + `Animated`, not reanimated
**Framework:** Direct criterion — "installed ≠ wired." `react-native-reanimated` is a dependency but the
**worklets babel plugin is absent** from `babel.config.js`, so worklet-based gestures would fail at runtime;
adding the plugin is a global, unverifiable change to the whole app's build. RN's core `PanResponder` +
`Animated` need no plugin, are what the rest of the app animates with, and fully cover one draggable card.
**Choice:** `PanResponder` + `Animated.ValueXY`, JS driver, interpolated rotate/disc-opacity. *Alternative:*
wire reanimated (rejected — disproportionate blast radius for one card; revisit if the app adopts reanimated
app-wide).

### D-06 Mock-backed hooks in the prototype
**Framework:** Direct criterion — the studio is a design surface with no auth/server/seed. **Choice:** `useDeck`/
`useSwipe`/`usePreferences` wrap an in-memory mock in the studio; the same hook interface wraps the real
endpoints in the app. *Alternative:* wire live endpoints (rejected — needs a running server + auth + seed).

---

## Open Questions

| ID | Question | Status | Resolution |
| --- | --- | --- | --- |
| Q-07 | Deck endpoint name: brief says `/v1/recipes/ranked-deck`, ranking doc says `/v1/recipes/deck`. | open | Using the brief's name; reconcile with backend before wiring. |
| Q-08 | Does the public recipe card on the deck include ingredients/steps and all badge fields, or is a `GET /v1/recipes/:id` detail fetch needed for the DetailSheet? | open | Verify the card DTO; assume fields present, fall back to a detail fetch. |
| Q-09 | Source + threshold for the "you've liked N" nudge — session tally vs. a durable Liked-cookbook count; N default. | open | Ship a session tally, N=10; swap to a cookbook-count read when available. |
| Q-10 | `direction:'save'`/`'super_like'` for a real "Cook this week" super-action + meal-plan wiring. | open (follow-up) | Prototype maps UP → `like`; propose the direction. |
| Q-11 | `DELETE /v1/recipes/:id/swipe` for a durable un-swipe (Bumble-style backtrack). | open (follow-up) | Client pre-commit undo only until it exists. |
| Q-12 | `GET`/`PUT /v1/preferences` for the settings surface to read/persist the preference model. | open (follow-up) | Prototype uses a local draft; blocks real persistence. |
| Q-13 | Should the ranking engine ever get a Bumble-style "relax this filter if the deck runs dry" fallback? | open | Not now; would change D-03. Ties to ranking Q-06 cooldown. |

---

## Appendix A — Changelog

| Date | Author | Change |
| --- | --- | --- |
| 2026-08-18 | Jordan Gaston | Initial design — swipe deck + settings surface consuming the ranking engine; interaction→backend mapping with flagged gaps (preferences read/write, un-swipe, save direction); card anatomy, dislike-reason loop, states, motion, a11y, telemetry; decisions incl. prototype-only UP, monochrome disc, explicit hard/soft grouping |
| 2026-08-18 | Jordan Gaston | Gesture retargeted to RN `PanResponder`+`Animated` (D-07) — reanimated's worklets babel plugin is unwired. Built the Design-Studio prototype (`SwipeDeck`, `SwipeSettings` studies) + on-canvas comment layer. Frontend-architect gate run (ponytail + refactoring-ui): 8 findings, 7 applied (badge-row/detail-bar dedup, action-bar + header hierarchy, motion-token for the loader, empty-state border→shadow, nudge threshold), `fa-5` kept by decision. Typecheck clean, 20/20 tests pass. |
| 2026-08-18 | Jordan Gaston | Human review round (10 in-sim pins), all addressed: on-photo pills (badges/score/detail CTA) → translucent-dark, never white; neutral action buttons → `bg-sand`; reason chips → `bg-sand`; action buttons captioned (Undo/Pass/Cook/Like) and Pass resized to match Like; **Super now opens a cookbook picker** (choose the cookbook to save to) — updates D-01/Q-10; settings Diets gain add/remove (trash + chips); DetailSheet why-bars show raw values (`$3.50/serving`, `25 min`) not %, ingredients show quantities + image thumbnails. Comment pins cleared (committed file emptied + in-sim AsyncStorage). Typecheck clean, 20/20 tests. |
| 2026-08-19 | Jordan Gaston | **Settings copy → declarative.** Per review, the settings surface no longer teaches the algorithm: removed the "applies to next batch" banner, the Filters/Preferences group headers, and every explanatory subtext; renamed Allergens→Allergies, Diets→Diet, "I've reviewed my kitchen"→"My kitchen", Save button→"Save". Severity reordered Mild·Moderate·Severe and strictness Flexible·Strict (extreme on the right). Kitchen switch removed — equipment is now plain toggle chips, so `equipment_reviewed` is implicit (**follow-up: set `equipment_reviewed=true` when a user first manages their kitchen / at onboarding**, since the toggle is gone). This supersedes the brief's "visibly separate hard filters vs soft preferences" (§8) — the hard/soft split is now conveyed by grouping/spacing, not copy, at the design owner's direction. |
| 2026-08-19 | Jordan Gaston | Toasts made semantic: success = green + drops from the **top** (✓); error = red + rises from the **bottom** (!). Shared `Toast` gains a `variant`; swipe reward toast anchored to the card top. |
| 2026-08-19 | Jordan Gaston | **Shade-system migration (whole app).** Root cause of the recurring "everything reads white/flat": a bimodal neutral ramp with no tertiary + no shadow scale. Fixes: (1) `tailwind.config.js` — one 10-step warm-neutral ramp `sand-50…900` + full `brand` ramp + `success`/`error` `light/DEFAULT/dark`; retired the `taupe`/`umber` experiment. (2) New `lib/elevation.ts` (low/medium/high) — depth via shadow, not tone; replaced all hand-rolled shadows and lifted every flat `bg-card` surface across `components/` + `app/` (audit-driven). (3) Semantic action bar: Pass=`error`, Cook=`brand`, Like=`success`, Undo=`card` (quiet). (4) Selection rule: segmented active = solid `brand`+white, multi-chip selected = `brand-light`+border, unselected chip = `sand-200`+muted. Gated with a `/refactoring-ui` audit (strengthened elevation so warm cards actually separate; darkened banner text to AA; moved the Filters icon off red). Documented in AGENTS.md § Shades, depth & colour. Typecheck clean, 20/20 tests, verified live in-sim. |
