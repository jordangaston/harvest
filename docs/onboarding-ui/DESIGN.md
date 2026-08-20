---
tags: [harvest, onboarding], tdd
summary: "First-run onboarding — the animated intake that seeds the swipe ranking engine and meal planner"
locked: false
---

# Onboarding — Design Document

> **Read first:** `docs/onboarding-ui/VIDEO-TEARDOWNS.md` (what we steal from Miso & Herbi),
> `AGENTS.md` (golden-hour system), `docs/swipe-ui/DESIGN.md` (the deck this feeds),
> `lib/motion.ts` / `lib/elevation.ts` (the tokens).

## 0. The one thing to know before reviewing

**Onboarding already exists.** `app/(onboarding)/` ships 17 screens today (welcome → goals →
recipe-sources → when-cook → cook-time → how-heard → age → name → phone/verify → notifications →
import-demo → awesome), an accumulator (`lib/onboarding.ts`) that drains into `POST /v1/users`, and an
`OnboardingScreen` shell + `ProgressHeader`. That flow collects **marketing/profile** metadata
(`goals, recipe_sources, cook_days, when_cook, cook_time, how_heard, age`) — it does **not** collect
the **ranking-engine preferences** (budget, time, meals, allergens, diets, cuisines, equipment,
skill). Those are set later, in the swipe **Settings** sheet (`components/swipe/SettingsScreen.tsx`).

This sprint's job is therefore **not greenfield**. It is: **evolve the existing flow into a
21-screen first-run that front-loads the preference model**, so the very first deck the user sees is
already personalised — reusing the existing shell, the existing persistence plumbing, and the pickers
Settings already ships. Building a parallel flow would violate both the brief and
`docs/harvest-principles.md` (verify-against-live-reality, single-chokepoint). Where the brief calls a
field a "new extension" but it already exists, this doc corrects it (see §5, **days-cooked**).

Phase 1 (this doc + the studio components) stops for founder approval before any sequencing.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Jordan (founder) | not_started | |
| Architect | not_started | |

---

## 1. Value proposition & motion strategy

**Promise:** *"Answer a few warm questions and your first deck already knows you."* Onboarding is the
front door to the swipe engine — it must (a) sell that the deck is personalised, (b) collect exactly
the preference fields the ranker and planner need, and (c) hand off into a deck that visibly reflects
the answers.

**Motion strategy — one binary rule, stolen from Miso and made law here:**

- **Informational screens type; interactive screens do not.** A headline that types character-by-
  character (with haptics) means *"read me, nothing to do."* Its absence means *"your turn."* The
  presence/absence of typing *is* the hierarchy on a control-free screen (Refactoring UI Ch2). This
  rule is enforced by the component split: `OnboardingValueCard` types; every input archetype renders
  its heading instantly.
- **Opens are invitations (slower), closes get out of the way (quicker)** — durations come only from
  `lib/motion.ts` (`DURATION.medium` in, `DURATION.fast`/`quick` out; `EASE.smoothOut`).
- **Depth is shadow, never tone** — every card/chip/tile lifts on `ELEVATION.*`; the cream→card step
  is ~1.15:1 and cannot separate by colour (Ch6).
- **Colour is meaning, spent once per screen** — terracotta `brand` marks *selection/primary*; a
  screen shows at most one accent role. Competitor store logos are the lone exception and are quarantined
  inside their tile (see §4 StorePicker).
- **Reduce Motion is honoured everywhere** — `AccessibilityInfo.isReduceMotionEnabled()` short-circuits
  typing (render full string), staggers (show at once), and travel (fade only). This is a hard gate in
  every animated archetype, not a per-screen afterthought.

---

## 2. Component inventory — archetypes, not 21 one-offs

Every screen composes the existing **`OnboardingScreen`** shell (cream canvas, `Backdrop`,
`ProgressHeader` with back/progress/skip, pinned bottom CTA) around **one** body archetype. All
archetypes are **controlled + presentational** (value in, `onChange` out, zero data-fetching) so the
Phase-2 flow is pure composition. Reuse is maximised: five pickers already live in Settings and are
**extracted once** into `components/onboarding/primitives.tsx` (single source of truth; Settings is
refactored to import them — no duplication).

| Archetype (study) | Covers screens | Built on / reuses | New? |
|---|---|---|---|
| `OnboardingValueCard` | 3, 4, 5, 6, 7 + all confirmations | **new** `Typewriter` + art + `expo-haptics` | new |
| `OnboardingValueCarousel` | 1 (3-slide loader) | `Animated` (code, not video) | new |
| `OnboardingChipGrid` | 8 goals, 14 time-bands, 21 equipment | extracted `Chip` (+ `MoreChip`/`SearchAddSheet`) | new wrapper |
| `OnboardingStorePicker` | 9 stores | `Chip`-style tiles + `SearchAddSheet` | new |
| `OnboardingBudget` | 10 budget | extracted `Slider` + display numeral | new wrapper |
| `OnboardingCounter` | 11 adults/kids | extracted `Stepper` | new |
| `MealCounts` | 12 meals | **existing** `components/planner/MealPlanIntake` | reuse as-is |
| `OnboardingDayPicker` | 13 days | extracted `Chip` + live count | new |
| `OnboardingTimeBudget` | 14 time | = `OnboardingChipGrid` single-select | reuse arch |
| `OnboardingBinary` | 15 leftovers | two lifted option cards | new |
| `OnboardingSeverityPicker` | 16 allergens, 17 diets | extracted `Chip` + `Segmented` | new (= Settings pattern) |
| `OnboardingTasteMenu` | 18 cuisines/liked, 19 disliked | extracted `Chip` + `SearchAddSheet` | new wrapper |
| `OnboardingSingleSelectList` | 20 confidence | rows + contextual microcopy (Miso steal) | new |

**Extracted primitives** (`components/onboarding/primitives.tsx`, lifted verbatim from
`SettingsScreen.tsx` so both surfaces stay identical): `Chip`, `Segmented`, `Slider`, `MoreChip`,
`SearchAddSheet`, plus `Stepper` (lifted from `MealPlanIntake`) and the new `Typewriter`. Canonical
option corpora (`CUISINES`, `ALL_INGREDIENTS`, `ALLERGENS`, `DIETS`, `EQUIPMENT`/`ALL_EQUIPMENT`
already reconciled to the server `EQUIPMENT_TYPES`) move alongside them.

---

## 3. Screen → preference-field map (all 21)

Every screen persists to an existing field, or to a **flagged extension** (§5). "Target" names the
concrete destination. Screens 1–7 collect nothing (they sell / instruct).

| # | Screen | Archetype | Target field | Store | Notes |
|---|---|---|---|---|---|
| 1 | 3-slide value loader | ValueCarousel | — | — | marketing; boot-time |
| 2 | Splash | *(existing `welcome` + `Logo`)* | — | — | keep/refine current |
| 3 | "…plan family meals" | ValueCard (typed) | — | — | informational |
| 4 | "Swipe to tell us what you like" | ValueCard + mini-swipe | — | — | teaser of the deck |
| 5 | "Import your favourite recipes" | ValueCard | — | — | reuse `ImportDemoCard` art |
| 6 | "…custom meal plans just for you" | ValueCard | — | — | informational |
| 7 | "A few questions" | ValueCard | — | — | segue to intake |
| 8 | Goals (multi) | ChipGrid | `users.goals` (`GOALS` enum) | `POST /v1/users` | **reconcile labels** to enum |
| 9 | Where do you shop | StorePicker | `preferences.groceryStores[]` | `PUT /v1/preferences` | **EXT E1 (new)** |
| 10 | Weekly budget | Budget | `preferences.weeklyBudgetCents` | `PUT /v1/preferences` | reuse `Slider` |
| 11 | People (adults + kids) | Counter | `preferences.household{adults,kids}` | `PUT /v1/preferences` | **EXT E2 (new)** |
| 12 | Meals per week | MealCounts | `preferences.weeklyMeals` | `PUT /v1/preferences` | reuse; kids→`weeklyMeals.kids` |
| 13 | How many days you cook | DayPicker | `users.cook_days` (`WEEKDAYS`) | `POST /v1/users` | **already exists — NOT an extension** |
| 14 | Time to cook | TimeBudget (ChipGrid) | `preferences.timeBudgetMin` | `PUT /v1/preferences` | bands → minutes |
| 15 | Family eats leftovers? | Binary | `preferences.eatsLeftovers` | `PUT /v1/preferences` | **EXT E3 (new)**; seeds `mealPrep` weight |
| 16 | Allergies (+ severity) | SeverityPicker | `preferences.allergens[]` | `PUT /v1/preferences` | reuse Settings pattern |
| 17 | Diet (+ strictness) | SeverityPicker | `preferences.diets[]` | `PUT /v1/preferences` | reuse Settings pattern |
| 18 | Anything you want on the menu | TasteMenu (combined) | `preferences.likes[]` across cuisines + dish types + ingredients | `PUT /v1/preferences` | **one combined picker** (E4, resolved) |
| 19 | Anything you don't like | TasteMenu (combined) | `preferences.dislikes[]` across cuisines + dish types + ingredients | `PUT /v1/preferences` | same combined picker, opposite signal |
| 20 | Kitchen confidence | SingleSelectList | `preferences.skillLevel` | `PUT /v1/preferences` | Still learning→beginner … Enthusiast→advanced |
| 21 | What's in your kitchen | ChipGrid | `preferences.ownedEquipment[]` (`EQUIPMENT_TYPES`) | `PUT /v1/preferences` | reuse reconciled corpus |

**Flow shape (founder-decided):** the profile questions Miso/the old flow collected — `name`, `age`,
`how_heard`, `when_cook`, `cook_time`, and Miso's gender — are **dropped**. The flow is the 21
value/preference screens, and **phone/OTP is the final step** (the only surviving auth/profile screen).

**Persistence chokepoint (Phase 2, not built now):** onboarding writes to **two** existing endpoints,
not a new one — the one surviving profile answer (13, `cook_days`) via the existing `lib/onboarding.ts`
accumulator → `POST /v1/users` (with `name` now unset); preference answers (8–12, 14–21) accumulate
into a `Partial<Preferences>` and flush once via **`PUT /v1/preferences`** on completion. Back-navigation edits the in-memory draft; nothing
persists until the final step, so a mid-flow abandon leaves no partial server state. `weights` stay
server-owned (the DTO never sends them); `eatsLeftovers` seeds the `mealPrep` weight server-side on
first save, exactly like `goals` already seed weights.

---

## 4. Notable per-screen design calls (hierarchy first)

- **StorePicker (9).** Logo on its own `bg-card` tile + hairline + `ELEVATION.low`; the *only* Harvest
  colour is the selected state (`border-brand` + `bg-brand-light`). Competitor brand colour is
  quarantined inside the tile so "their brand" never competes with "our state" (Ch5). Includes a
  searchable "More stores" sheet and a "Skip — I shop elsewhere" escape (Ch8 edge-state).
- **Counter (11).** Two big-numeral stepper rows (Adults / Kids) grouped in one card; inner spacing
  tighter than card padding so they read as one question (Ch3). Kids feeds both household portioning
  and the `weeklyMeals.kids` default.
- **SeverityPicker (16/17).** Identical to the Settings allergen/diet cards: tap a `+ chip` to add,
  then a `Segmented` (Mild/Moderate/Severe · Flexible/Strict) appears on the selected row. Adds Miso's
  **confirmation microcopy** ("Got it — we'll avoid peanuts.") under the row.
- **SingleSelectList (20).** Rows with icon + label; the selected row reveals **contextual reassurance
  microcopy** (Miso steal: "Still learning — most cooks are, we'll keep steps simple."). Secondary
  text, de-emphasised, so it supports without competing (Ch2).
- **Squint test:** on every intake screen the headline + the primary control survive the blur; helper
  copy, progress bar, and skip recede.

---

## 5. Model / API extensions (flagged)

The preference model (`components/swipe/mock.ts` client, `server/src/preferences-dto.ts` +
`user-preferences.ts` server) covers most screens. Four gaps, one correction:

| ID | Need | Proposed shape | Screen |
|---|---|---|---|
| **E1** | Grocery stores | `groceryStores: string[]` on `Preferences` + DTO `grocery_stores`; new `user_stores(user_id, store)` table (or `jsonb` column). Store id from a canonical `GROCERY_STORES` list (server enum, like `EQUIPMENT_TYPES`). | 9 |
| **E2** | Household size | `household: { adults: number; kids: number }` on `Preferences` + DTO `household_adults` / `household_kids` columns on `user_preferences`. | 11 |
| **E3** | Leftovers | `eatsLeftovers: boolean` on `Preferences` + DTO `eats_leftovers` column; on save, if true, seed `weights.mealPrep` (server-side, capped, like the goals cold-start seed). | 15 |
| **E4** | Combined likes / dislikes *(resolved)* | One picker over **cuisines + dish types + ingredients**. Expose `likes[]` and `dislikes[]` on `Preferences`/DTO, each an array of `{facet, value}` where `facet ∈ {cuisine, dish_type, ingredient}`. Backs onto the existing `user_food_prefs(facet, value, like/dislike)` table — add a `dish_type` facet. Supersedes the narrow `likedCuisines`/`dislikedIngredients` (migrate those in). | 18, 19 |
| **fix** | ~~days-cooked~~ | **Already exists** as `users.cook_days` (`WEEKDAYS[]`). Not an extension. Screen 13 reuses it; "how many days" is `cook_days.length`. | 13 |

All extensions are **additive, backwards-compatible** columns/tables (nullable / default-empty); old
clients ignore them, the ranker treats absent values as "no constraint." Full column specs land in
Phase 2 with tests; only the client-side `Preferences` type + a studio-local mock change in Phase 1.

---

# Entities

~~~mermaid
classDiagram
    class User {
        +string name
        +Goal[] goals
        +Weekday[] cookDays
        +HowHeard howHeard
        +AgeBand age
    }
    class Preferences {
        +DifficultyBand skillLevel
        +int weeklyBudgetCents
        +int timeBudgetMin
        +WeeklyMeals weeklyMeals
        +Weights weights
        +string[] likedCuisines
        +string[] dislikedIngredients
        +AllergenPref[] allergens
        +DietPref[] diets
        +string[] ownedEquipment
        +string[] groceryStores
        +Household household
        +bool eatsLeftovers
    }
    class Household {
        +int adults
        +int kids
    }
    User "1" --> "1" Preferences : personalises
    Preferences "1" *-- "1" Household : sizes
~~~

New fields (`groceryStores`, `household`, `eatsLeftovers`, `likedIngredients?`) shown in **bold** in
the map are the §5 extensions; the rest exist today.

---

# Tables

Phase-2 work; specs summarised so reviewers can sanity-check the extensions. Existing tables
(`user_preferences`, `user_allergens`, `user_diets`, `user_food_prefs`, `user_equipment`, `users`)
are defined in the swipe/cleanup sprints — referenced, not redefined.

## user_preferences (new columns)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| household_adults | int | not null, default 2 | E2 |
| household_kids | int | not null, default 0 | E2 |
| eats_leftovers | boolean | not null, default true | E3; seeds mealPrep weight |

## user_stores (new table — E1)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| user_id | string | pk, fk → users | |
| store | string | pk | one of `GROCERY_STORES` |

---

# Modules

~~~mermaid
classDiagram
    class OnboardingScreen {
        +ReactNode children
        +number progress
        +string ctaLabel
        +onCta()
    }
    class Typewriter {
        +string text
        +bool haptics
        +bool reduceMotion
        +onDone()
    }
    class Chip { +string label +bool active +onToggle() }
    class Segmented~T~ { +Option~T~[] options +T value +onChange(T) }
    class Slider { +number value +number min +number max +onChange(number) }
    class Stepper { +number value +onChange(number) }
    class SearchAddSheet { +string[] corpus +string[] selected +onToggle(string) }

    class OnboardingValueCard { +string headline +Art art +onContinue() }
    class OnboardingChipGrid { +Option[] options +string[] value +bool multi +onChange() }
    class OnboardingStorePicker { +Store[] value +onChange() }
    class OnboardingBudget { +number cents +onChange(number) }
    class OnboardingCounter { +Household value +onChange(Household) }
    class OnboardingDayPicker { +Weekday[] value +onChange() }
    class OnboardingBinary { +bool value +onChange(bool) }
    class OnboardingSeverityPicker { +Pref[] value +onChange() }
    class OnboardingTasteMenu { +string[] value +onChange() }
    class OnboardingSingleSelectList { +Option[] options +string value +onSelect() }

    OnboardingValueCard --> Typewriter
    OnboardingChipGrid --> Chip
    OnboardingChipGrid --> SearchAddSheet
    OnboardingStorePicker --> SearchAddSheet
    OnboardingBudget --> Slider
    OnboardingCounter --> Stepper
    OnboardingDayPicker --> Chip
    OnboardingSeverityPicker --> Chip
    OnboardingSeverityPicker --> Segmented
    OnboardingTasteMenu --> Chip
    OnboardingTasteMenu --> SearchAddSheet
    note for OnboardingScreen "existing shell; every screen composes it"
~~~

Each archetype is a **study** in `design/studies/*.study.tsx`, registered in `design/registry.ts`,
viewable at `/studio/<Name>` with inline controls and comment pins.

---

# APIs

No new endpoints. Onboarding reuses two existing contracts:

## Save profile answers `POST /v1/users`
Existing. Body already accepts the optional `onboarding` object (`OnboardingSchema`: `goals`,
`recipe_sources`, `cook_days`, `when_cook`, `cook_time`, `how_heard`, `age`). Screens 8 & 13 map here
via `lib/onboarding.ts`. **No change** beyond reconciling screen-8 goal labels to the `GOALS` enum.

## Save preferences `PUT /v1/preferences`
Existing (`preferences-dto.ts:preferencesBodySchema`, snake_case, bearer-auth). Screens 9–12, 14–21
flush here once on completion. **Change (Phase 2):** add `grocery_stores`, `household_adults`,
`household_kids`, `eats_leftovers` (and optionally `liked_ingredients`, Q-04) to the schema — all
optional, additive.

---

# Testing

Phase 1 verification: `npm run typecheck` clean; each new study renders in the iOS simulator at
`/studio/<Name>` with controls exercised. Studies are presentational — no logic to unit-test yet
beyond `Typewriter` (see below).

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| Typewriter reveal + Reduce-Motion short-circuit | Op | x | | |
| Each archetype renders + emits onChange | Component | x (studio) | | |
| Screen → field mapping (Phase 2) | Flow | | x | |
| Full first-run → deck reflects prefs (Phase 2) | Flow | | | x |

**Unit (Phase 1):** `Typewriter` is the only non-trivial logic — a pure `visibleCount(elapsed, speed,
reduceMotion)` helper with an assert-based self-check (reduceMotion → full length immediately;
otherwise monotonic 0→len). Everything else is presentational.

**Integration/E2E (Phase 2):** accumulator → `POST /v1/users` + `PUT /v1/preferences` round-trip; the
handed-off deck query reflects the saved prefs. Extend the existing preference-repository tests for
E1–E3 columns.

---

# Deployment

Phase 2. Migrations for E1–E3 are additive and backwards-compatible (nullable / defaulted), run before
code deploy. No data backfill (existing users already have preferences; new columns default sanely).
Gate the *new* flow behind the existing first-launch entry (`app/index.tsx`) — see Q-02. Rollback: the
new columns are inert to old code; revert client without touching the schema.

---

# Monitoring

Reuse existing `Onboarding Step Completed` analytics (`OnboardingScreen` already emits it, keyed by
route). Add per-screen completion so we can see drop-off by archetype.

| Name | Type | Use Case | Description |
|---|---|---|---|
| Onboarding Step Completed | counter | first-run funnel | already emitted; extend to new screens |
| Onboarding Completed | counter | hand-off to deck | fires on final `PUT /v1/preferences` success |
| Onboarding Preference Saved | counter | intake integrity | fires on flush; tag = fields set |

---

# Decisions

## D-1 — Evolve the existing onboarding, don't rebuild
**Framework:** Direct criterion (verify-against-live-reality; single-chokepoint).
**Choice:** Reuse `OnboardingScreen`, `lib/onboarding.ts`, `POST /v1/users`, `PUT /v1/preferences`,
and the Settings pickers. A parallel flow would duplicate persistence and drift from Settings — the
exact failure `docs/harvest-principles.md` warns against.
### Alternatives
- **Greenfield flow (as the brief's framing implies):** rejected — duplicates working plumbing, two
  sources of truth for the same `Preferences`.

## D-2 — Front-load the preference model into onboarding
**Framework:** Direct criterion (the sprint's whole point).
**Choice:** Collect budget/time/meals/allergens/diets/cuisines/equipment/skill *during* first-run, not
only in Settings, so deck #1 is personalised. Settings remains the edit surface post-onboarding; both
read/write the identical extracted pickers.

## D-3 — Chip grid for equipment, not Herbi's 3D kitchen
**Framework:** Fermi ROI.
**Choice:** A labelled chip grid maps 1:1 to all 14 `EQUIPMENT_TYPES`, reuses `Chip`, and matches the
Settings "My kitchen" card — near-zero effort, full coverage. A bespoke isometric scene is a heavy
illustration + fragile hotspot map for one screen: high effort, capped coverage, off-system.
Optional cheap upgrade later: a painterly icon per chip (Nano Banana), not a scene.

## D-4 — Motion in code, generated video only where code can't reach
**Framework:** Fermi ROI + "prefer code-driven RN motion" (brief constraint).
**Choice:** The loader ring, typing, staggers, and checklist are `Animated` (own the timing, free
Reduce-Motion, crisp at any density). Higgsfield is reserved for at most the celebratory hand-off
moment, and only if approved (§ Asset plan). Every generated asset is listed for approval before spend.

---

# Asset plan

Prefer code + existing art; generate sparingly and only after approval (Higgsfield is expensive).

| Asset | Source | Status | Notes |
|---|---|---|---|
| Loader food tokens (baguette, tomato, etc.) | **Existing** ingredient-icon set / Nano Banana stills | reuse first | Orbit them in `Animated`; no video |
| Value-card art (screens 3–7) | **Existing** painterly onboarding art + `ImportDemoCard` | reuse | Only generate a gap-filler if a screen lacks art |
| Store logos (screen 9) | Real brand logos, bundled in `assets/stores/*.png` (fetched via apple-touch-icon / unavatar, normalised to 128px) | **done** | Real marks on `bg-card` tiles; store identification only |
| Equipment chip icons (optional) | Nano Banana stills | **proposed, not approved** | Only if D-3 upgrade greenlit |
| Celebratory hand-off (confetti → first deck) | Code (`Feedback`/confetti) first; Higgsfield fallback | **proposed, not approved** | Prefer code; list before any Higgsfield spend |

**Nothing is generated until this table's "proposed" rows are approved.** Seed-frame → ffmpeg
background-removal → Higgsfield animate is the workflow *if* a video is approved; current plan needs
none.

---

# Motion & haptics spec

Grounded in `lib/motion.ts` and Apple Human Interface Guidelines. Haptics via `expo-haptics` (already
a dependency, already used in `SwipeDeck`/`groceries`/`recipe`). **HIG principles named per the
brief.**

| Moment | Visual (token) | Haptic (`expo-haptics`) | HIG principle |
|---|---|---|---|
| Value-card headline types (info screens only) | `Typewriter`, ~1 char / 28 ms | `selectionAsync()` every ~2 chars | **Provide feedback** — tie a subtle tactile beat to a visual event |
| Value-card headline completes | supporting line fades in `DURATION.medium` | `notificationAsync(Success)` once | **Consistency** — same "done" cue the deck uses on a like |
| Chip / day / store select | scale-in of `border-brand`, `DURATION.fast` | `impactAsync(Light)` | **Direct manipulation** — the object responds to the touch |
| Stepper ± (counter, meals) | number tick | `impactAsync(Light)` | **Feedback** proportional to a discrete change |
| Slider settle (budget/time) | thumb + fill, `EASE.smoothOut` | `selectionAsync()` on step cross | **Feedback** without overload (per-step, not per-pixel) |
| Screen advance (CTA) | slide `DISTANCE.base`, `DURATION.medium` in | none | **Deference** — motion supports, doesn't announce itself |
| Final hand-off to deck | checklist rows resolve, then confetti | `notificationAsync(Success)` | **Provide feedback** at task completion |
| Interactive-screen headings | render instantly | **none** | Miso rule: never make someone wait to answer |

**HIG rules honoured:** *Playing haptics* — use system-defined patterns, keep them **consistent** with
their visual/audio partner, and **don't overload** (cap cadence; never buzz per-pixel or per-character
on long strings). *Reduce Motion* — respected app-wide (typing → instant, travel → fade, no ticks).
*Depth conveys hierarchy* — elevation, not decoration, signals what's raised.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Where do auth (`phone`/`verify`), `name`, and `age`/`how-heard`/`when-cook`/`cook-time`/`gender` sit? | resolved | **Phone/OTP is the last step; all the others (name, age, how-heard, when-cook, cook-time, gender) are dropped.** |
| Q-02 | First-launch gating: `app/index.tsx` currently redirects to onboarding **unconditionally**; there's no `hasCompletedOnboarding` server flag (only client AsyncStorage checklist flags + `users.onboarding_completed_at`). Gate on `onboarding_completed_at`? | open | |
| Q-03 | Goals reconcile vs. the existing `GOALS` enum. | resolved | **Add a `kid_friendly` label/value to the `GOALS` enum** (Phase 2 server change); keep the existing seven. The goals screen already offers "Kid-friendly meals". |
| Q-04 | Screen 18/19 taste pickers scope. | resolved | **One combined picker over cuisines + dish types + ingredients**, used for both "want" and "don't like" (E4). |
| Q-05 | Store list depth. | resolved | **Cover all major US chains.** Grid = curated 16 (with real logos); search corpus (`ALL_GROCERY_STORES`) = ~55 major chains as text chips, plus the "I shop elsewhere" escape. |
| Q-06 | Gender (Miso's screen): confirm we omit it. | resolved | **Omitted.** |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-19 | Claude (eng+design lead) | Initial Phase-1 draft: teardown-driven, grounded in the existing onboarding + preference model. |
| 2026-08-19 | Claude, per founder review | Resolved Q-01 (phone last; name/age/how-heard/when-cook/cook-time/gender dropped), Q-04/E4 (one combined cuisines+dish-types+ingredients picker for likes & dislikes), Q-06 (gender omitted). Real store logos bundled in `assets/stores`. |
