---
tags: [harvest, design-system], tdd
summary: "Design Studio — an in-app, dev-only gallery for building and inspecting named components in isolation"
locked: false
---

# Design Studio

An in-app route where each component lives as a named **study** — rendered in
isolation over the real `Backdrop`, with a small panel of controls to flip its
props and check every state. It exists so agents can build a component for a
design study, drop it in by name, and I can open it in the simulator without
standing up a whole feature. The registry key is the canonical name I refer to
in prompts and design docs.

Not Storybook: no new dependency, no web build, no `.storybook` scaffold. Runs
in the simulator we already use. See `docs/... ` discussion — Storybook's extra
value (visual-regression, a shareable web catalog) needs a `react-native-web`
build we're deliberately not paying for yet. The study files written here are
not wasted if we adopt Storybook later — they port to CSF over the same
components.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Jordan | in_progress | |
| Architect | not_started | |

---

# Use Cases

No use-case document exists for internal tooling, so the Flows this design
implements are stated here:

- **F-01 — Browse the studio.** Open `/studio`, see the list of every registered
  study by name (grouped), tap one to open it.
- **F-02 — Inspect a study's states.** On a study screen, see the component
  rendered over the canvas; adjust its controls (toggle a boolean, pick an enum,
  edit text) and watch it re-render live.
- **O-01 — Register a study.** An agent adds one study file and one registry
  entry; the study then appears in F-01 with no other wiring.

---

# Use Case Implementations

## Browse the studio — Implements F-01

~~~mermaid
sequenceDiagram
    participant U as User (simulator)
    participant List as StudioListScreen (app/studio/index.tsx)
    participant Reg as registry (design/registry.ts)
    participant Detail as StudioDetailScreen (app/studio/[name].tsx)

    U->>List: navigate /studio
    List->>Reg: read studies[]
    Reg-->>List: [{name, group, ...}]
    note over List: render grouped, tappable list of names
    U->>List: tap "RecipeCard"
    List->>Detail: router.push(/studio/RecipeCard)
    Detail->>Reg: find study by name param
    Reg-->>Detail: Study
    note over Detail: render Backdrop + Controls + component
~~~

Extension — unknown name (deep-linked / stale reference): the lookup returns
`undefined`; the detail screen shows a "no study named X" message instead of
crashing.

## Inspect a study's states — Implements F-02

~~~mermaid
sequenceDiagram
    participant U as User (simulator)
    participant Detail as StudioDetailScreen
    participant Ctrls as Controls (design/ControlsPanel.tsx)
    participant C as Study component

    Detail->>Ctrls: render study.controls, keyed by study.name
    note over Ctrls: owns values state, seeded from control defaults
    Detail->>C: render(values)  // over Backdrop
    U->>Ctrls: toggle / select / type
    Ctrls-->>Detail: onChange(values')
    Detail->>C: re-render with values'
~~~

The `Controls` state is **keyed by `study.name`** so switching between studies on
the reused detail screen resets the panel — a reused-instance reset
(`docs/rn-nativewind-pitfalls.md`), not stale values leaking across studies.

---

# Entities

~~~mermaid
classDiagram
    class Study {
        +string name
        +string group
        +ControlSpec[] controls
        +render(values) ReactNode
    }
    class ControlSpec {
        <<union>>
        +string key
        +string label
    }
    class BooleanControl {
        +boolean default
    }
    class EnumControl {
        +string[] options
        +string default
    }
    class TextControl {
        +string default
    }
    class NumberControl {
        +number default
    }
    Study "1" --> "*" ControlSpec : controls
    ControlSpec <|-- BooleanControl
    ControlSpec <|-- EnumControl
    ControlSpec <|-- TextControl
    ControlSpec <|-- NumberControl
~~~

`values` is a flat record `{ [control.key]: boolean | string | number }`. A study
with no editable state omits `controls` and ignores the `values` arg.

---

# Modules

~~~mermaid
classDiagram
    class Study {
        <<type>>
        +name string
        +group? string
        +controls? ControlSpec[]
        +render(values Record) ReactNode
    }
    class registry {
        +studies Study[]
    }
    class StudioListScreen {
        +default() ReactNode
    }
    class StudioDetailScreen {
        +default() ReactNode
    }
    class Controls {
        +Controls(specs, values, onChange) ReactNode
    }
    registry --> Study : holds
    StudioListScreen --> registry : reads
    StudioDetailScreen --> registry : looks up by name
    StudioDetailScreen --> Controls : renders
~~~

~~~mermaid
flowchart LR
    S[".study.tsx files"] -->|Study| R[registry.studies]
    R -->|Study name+group| L[StudioListScreen]
    R -->|Study by name| D[StudioDetailScreen]
    D -->|ControlSpec + values| C[Controls]
    C -->|values'| D
    D -->|render values'| Comp[Study component over Backdrop]
~~~

### Interfaces

```ts
// design/types.ts
export type ControlSpec =
  | { kind: "boolean"; key: string; label: string; default: boolean }
  | { kind: "enum";    key: string; label: string; options: string[]; default: string }
  | { kind: "text";    key: string; label: string; default: string }
  | { kind: "number";  key: string; label: string; default: number };

export type ControlValues = Record<string, boolean | string | number>;

export type Study = {
  name: string;                 // canonical name — referenced in prompts/docs
  group?: string;               // list section, e.g. "Cards", "Sheets"
  controls?: ControlSpec[];
  render: (values: ControlValues) => React.ReactNode;
};
```

```ts
// design/registry.ts — the one file agents append to
import { RecipeCardStudy } from "./studies/RecipeCard.study";
export const studies: Study[] = [RecipeCardStudy /* , ... */];
```

A study file:

```tsx
// design/studies/RecipeCard.study.tsx
import { RecipeCard } from "../../components/recime/RecipeCard";
import type { Study } from "../types";

export const RecipeCardStudy: Study = {
  name: "RecipeCard",
  group: "Cards",
  controls: [
    { kind: "text",    key: "title",    label: "Title",     default: "Miso Butter Salmon" },
    { kind: "boolean", key: "hasImage", label: "Has image", default: true },
  ],
  render: ({ title, hasImage }) => (
    <RecipeCard
      id="demo"
      title={String(title)}
      imageUrl={hasImage ? "https://picsum.photos/300" : undefined}
    />
  ),
};
```

`Controls` renders each spec with an existing `ui` primitive — `Switch`
(boolean), a row of `Pressable` chips (enum), `Input` (text/number) — and owns
the `values` state seeded from each control's `default`.

---

# Tables / APIs / Deployment / Monitoring

**N/A.** No persistence, no HTTP, no server, no prod deploy, no metrics — this is
local dev tooling. The only "deploy" concern is that the route must not ship to
real users: see Decision *Gating the route*.

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| O-01: Register a study | Op | x | | |
| F-01: Browse the studio | Flow | x | | |
| F-02: Inspect states | Flow | x | | |

## Test Approach

This repo has **no React renderer in tests** — `npm test` is `node --test` over
pure `.ts` files (see `lib/analytics/*.test.ts`). We do not add jest/RTL just for
this feature. Instead the testable logic is extracted into pure helpers, so the
control state is covered without rendering a component.

- **Registry integrity** (guards O-01): `design/registry.test.ts` asserts every
  `studies[]` entry has a non-empty `name`, names are unique, and each
  `control.key` is unique within its study. The one check that fails loudly when
  an agent adds a duplicate or malformed study.
- **Control helpers** (guards F-02): `seedValues(specs)` returns the defaults;
  `setValue(values, key, v)` returns a new record with one key changed. Pure
  functions, unit-tested directly — this is the state logic `Controls` renders.
- **Lookup** (guards F-01): `studies.find(byName)` returns the study for a known
  name and `undefined` for an unknown one — the branch the detail screen renders
  the not-found message from.

The `Controls` component and the two screens are verified **manual-in-simulator**
by design: open the studio, tap a study, work the controls. Automating that is
exactly the visual-regression cost we chose not to pay (see Decision *Not
Storybook*).

## Test Infrastructure

None new. Uses the existing `node --test` runner; the `test` script's glob widens
to include `design/*.test.ts`.

---

# Decisions

## Not Storybook — a homemade gallery route

**Framework:** Fermi ROI.

- **Impact:** identical for the stated goal — named components, isolated in the
  simulator, with basic prop editing. Storybook adds visual-regression and a
  shareable web catalog, neither currently wanted.
- **Effort:** gallery route ≈ hours (a list screen, a detail screen, a registry,
  a controls panel — all from existing `ui` primitives, zero deps). Storybook RN
  ≈ a day (new dep, Metro/babel reconfigure, `.storybook` scaffold) and its
  marquee testing features (visual regression) need a further `react-native-web`
  build.
- **ROI:** the route wins decisively — same impact, a fraction of the effort and
  zero new surface.

**Choice:** build the route. Adopt Storybook only if/when visual-regression CI or
a shareable web catalog becomes a real need; the `.study.tsx` files port to CSF
over the same components.

### Alternatives Considered
- **Storybook React Native:** rejected — cost without matching the current goal.
- **Storybook + react-native-web:** rejected — new web-compat surface (NativeWind
  under web, Reanimated/expo-native modules) for a shareable link nobody asked for.

## Gating the route — dev-only

**Framework:** Direct criterion — must never reach real users.

**Choice:** register the `studio` Stack screens only when `__DEV__`, and reach it
**only from the `AnalyticsDebugOverlay`** (already dev-gated) — add a "Design
Studio" entry there. No link from any shipping screen. In a production build the
route does not exist and there is no entry point to it.

## Explicit registry over auto-glob

**Framework:** Direct criterion — greppability and the "refer to by name" goal.

**Choice:** an explicit `studies[]` array, not a Metro `require.context` glob. The
array *is* the canonical, greppable list of names I cite in prompts; a one-line
append is cheaper to reason about than a magic glob, and it keeps the name ↔ file
mapping obvious.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | How should `/studio` be reachable — hidden `__DEV__` route only, `__DEV__` + a link from the debug overlay, or always present in-app? | resolved | Hidden `__DEV__`-only route, reached solely from a "Design Studio" entry in `AnalyticsDebugOverlay`. No link from any shipping screen. |
| Q-02 | Studies whose component navigates on tap (e.g. `RecipeCard` → `/recipe/:id`) will route away from the studio. Accept it, or wrap studies in a nav-suppressing context so taps are inert? | resolved | Accept it — no special-casing. Taps navigate like the real app; hit back to return. Zero extra code. A specific study can pass a no-op handler in its own `render` if its destination is a problem; no global suppression shim. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-18 | Jordan | Initial draft |
