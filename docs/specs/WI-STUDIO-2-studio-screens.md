# WI-STUDIO-2 — Design Studio screens, controls panel, dev launcher

## Background

Depends on **WI-STUDIO-1**, which provides `design/types.ts`, `design/controls.ts`
(`seedValues` / `setValue`), `design/registry.ts` (`studies`), and the seed
`RecipeCardStudy`. Full design: `docs/design-studio-tdd.md`.

This work item builds the visual layer: the controls panel, the two `expo-router`
screens, and the dev-only entry point. After this, I can open the studio in the
simulator, pick a component by name, and flip its props.

Repo facts that constrain this work:
- Routing is `expo-router`, file-based. `app/_layout.tsx` defines a `Stack` with
  `screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F1E6D2" } }}`
  and registers screens via `<Stack.Screen name=... />`. The dev overlay is
  already mounted there under `{__DEV__ ? <AnalyticsDebugOverlay /> : null}`
  (line ~84).
- `AnalyticsDebugOverlay` is `pointerEvents="none"` — it cannot be tapped. So the
  studio entry point is a **separate small tappable dev launcher**, mounted as a
  `__DEV__`-gated sibling in `app/_layout.tsx`, not a row inside that feed.
- UI primitives live in `components/ui`: `Switch({ value, onValueChange })`,
  `Input` (TextInput, warm styling), `Pressable`, `Text`, `ScrollView`, `VStack`,
  `HStack`. Use these, not raw RN or `bg-white`.
- Surfaces follow the golden-hour rules (`AGENTS.md`): page canvas `bg-cream` via
  `<Backdrop />` rendered first; rows/tiles/panels use `bg-card`; never `bg-white`.
- Q-02 is resolved: components that navigate on tap (e.g. `RecipeCard` →
  `/recipe/:id`) are **not** special-cased. Taps navigate; back returns.

## Objective

Build `design/Controls.tsx` (renders a `ControlSpec[]` using `ui` primitives,
owns `values` state via the WI-STUDIO-1 helpers, keyed by study name),
`app/studio/index.tsx` (grouped, tappable list of study names over `Backdrop`),
`app/studio/[name].tsx` (looks up the study, renders it over `Backdrop` with the
controls panel, shows a not-found message for an unknown name), register both
screens under `__DEV__` in `app/_layout.tsx`, and add a `__DEV__`-only tappable
launcher that opens `/studio`.

## Acceptance Criteria

1. Given `design/Controls.tsx`, when rendered with a `ControlSpec[]`, an initial
   `ControlValues`, and an `onChange` callback, then it renders one labelled
   control per spec — `boolean` → `Switch`, `enum` → a row of selectable
   `Pressable` chips (selected chip uses `bg-brand-light` + `border-brand`),
   `text`/`number` → `Input` — and each edit calls `onChange` with the merged
   values (`setValue`). `number` inputs emit a `number`, not a string.
2. Given `app/studio/index.tsx`, when opened, then it renders `<Backdrop />` first
   and a list of every study in `registry.studies`, grouped by `group` (studies
   with no `group` fall under "Ungrouped"), each row a `bg-card` tile showing the
   study `name`. Tapping a row navigates to `/studio/<name>`.
3. Given `app/studio/[name].tsx` with a `name` param matching a study, when
   opened, then it renders `<Backdrop />`, the study component via
   `study.render(values)`, and the `Controls` panel; `values` is seeded from the
   study's control defaults.
4. Given the detail screen, when the controls are edited, then the rendered study
   component re-renders with the new values.
5. Given the detail screen is reused across two different studies (navigate from
   one study's detail to another's), then the controls state resets to the new
   study's defaults — the `Controls` state is keyed by `study.name` so no values
   leak across studies.
6. Given `app/studio/[name].tsx` with a `name` param matching no study, when
   opened, then it renders a readable "No study named "<name>"" message over
   `<Backdrop />` and does not crash.
7. Given `app/_layout.tsx`, when the app builds, then the `studio` and
   `studio/[name]` screens are registered on the `Stack` **only when `__DEV__`**,
   and a `__DEV__`-only tappable launcher (a small `bg-card` pill, e.g. "🎞
   Studio") is mounted that calls `router.push("/studio")`. In a production build
   (`__DEV__ === false`) neither the launcher nor the routes are reachable.
8. Given `npm test` and `npx tsc --noEmit`, when run after this change, then all
   existing tests still pass and there are no new type errors.

## Test Cases

### Test Case 1: Studio list shows every study grouped (AC 2)

**Preconditions:** App running in the iOS simulator (dev build). WI-STUDIO-1
merged so `RecipeCardStudy` is registered.

**Steps:**
1. Launch the app; tap the dev "Studio" launcher.
2. Observe the list on `/studio`.

**Expected Outcomes:**
- `<Backdrop />` gradient is visible behind the list.
- A "Cards" group contains a `RecipeCard` row on a `bg-card` tile (not white).
- Tapping the `RecipeCard` row opens `/studio/RecipeCard`.

### Test Case 2: Controls flip the component's state (AC 1, 3, 4)

**Preconditions:** On `/studio/RecipeCard` in the simulator.

**Steps:**
1. Toggle the "Has image" switch off.
2. Edit the "Title" input to a new string.

**Expected Outcomes:**
- With "Has image" off, the `RecipeCard` shows its placeholder (icon on
  `bg-brand-light`) instead of a photo; toggling on restores the image.
- The card's title updates live as the input changes.

### Test Case 3: Reused detail screen resets between studies (AC 5)

**Preconditions:** At least two studies registered [ASSUMPTION: a second throwaway
study is added temporarily for this check, or this is re-verified when a real
second study lands]. On `/studio/RecipeCard`, "Title" edited to a custom value.

**Steps:**
1. Navigate back to the list and open a different study's detail.
2. Observe its controls.

**Expected Outcomes:**
- The second study's controls show *its* defaults, not the edited `RecipeCard`
  title — confirming the `study.name`-keyed reset.

### Test Case 4: Unknown study name does not crash (AC 6)

**Preconditions:** Dev build in simulator.

**Steps:**
1. Deep-link or navigate to `/studio/DoesNotExist`.

**Expected Outcomes:**
- A "No study named "DoesNotExist"" message renders over `<Backdrop />`; no red
  error screen.

### Test Case 5: Production build hides the studio (AC 7)

**Preconditions:** Ability to evaluate the `__DEV__` branch (code review + a
production/`__DEV__ === false` build or a forced-flag check).

**Steps:**
1. Confirm the `Stack.Screen` registrations for `studio` and `studio/[name]` and
   the launcher are inside `__DEV__` guards.
2. In a non-dev build, confirm no launcher renders and `/studio` is not
   registered.

**Expected Outcomes:**
- No studio entry point or route exists when `__DEV__` is false.

### Test Case 6: Suite and types stay green (AC 8)

**Preconditions:** Change applied.

**Steps:**
1. Run `npm test`.
2. Run `npx tsc --noEmit`.

**Expected Outcomes:**
- All tests pass; no new type errors.

## Test Run

_To be filled in during execution._

## Deployment Strategy

Direct commit to the feature branch, then PR to `main`. The entire surface is
`__DEV__`-gated, so it never reaches production users — the `__DEV__` guard is the
deployment control. No runtime feature flag needed.

## Production Verification

Not applicable by design — the feature is absent from production builds. "Verify
it's *not* in prod" is covered by Test Case 5.

### Production Verification 1: Studio absent from production build

**Preconditions:** A production (`__DEV__ === false`) build.
**Steps:** Confirm no "Studio" launcher appears and `/studio` is unreachable.
**Expected Outcomes:** No studio UI or route in the production build.

## Production Verification Run

_To be filled in during execution._
