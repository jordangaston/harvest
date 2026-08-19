# WI-STUDIO-1 — Design Studio core: types, control helpers, registry

## Background

Agents need to build components for design studies and drop them into an in-app
gallery *by name*, so I can inspect each component's states in the simulator
without standing up a whole feature. The full design is in
`docs/design-studio-tdd.md`.

This work item builds the **non-visual foundation**: the `Study` type, the pure
control-state helpers, and the explicit registry that is the canonical list of
component names. It ships no screens — WI-STUDIO-2 consumes it. Splitting the pure
core out means its logic is unit-tested with the repo's existing `node --test`
runner and no React renderer.

Repo facts that constrain this work:
- Tests run via `npm test` → `node --test lib/analytics/*.test.ts`. There is **no
  jest and no `@testing-library/react-native`** — do not add them. Testable logic
  must be pure and importable as plain TS.
- `RecipeCard` (`components/recime/RecipeCard.tsx`) takes
  `{ id: string; title: string; imageUrl?: string }` and navigates to
  `/recipe/:id` on tap via `expo-router`. It is the seed study.

## Objective

Create `design/types.ts` (the `Study` and `ControlSpec` model), `design/controls.ts`
(pure `seedValues` / `setValue` helpers), `design/registry.ts` (the exported
`studies` array), and the first study `design/studies/RecipeCard.study.tsx`. Cover
registry integrity and the control helpers with `node --test`, and widen the test
script to include `design/*.test.ts`.

## Acceptance Criteria

1. Given `design/types.ts`, when imported, then it exports `ControlSpec` (a
   discriminated union over `kind: "boolean" | "enum" | "text" | "number"`, each
   with `key`, `label`, and a `default` of the matching type; `enum` also has
   `options: string[]`), `ControlValues` (`Record<string, boolean | string | number>`),
   and `Study` (`{ name: string; group?: string; controls?: ControlSpec[]; render: (values: ControlValues) => React.ReactNode }`).
2. Given a `ControlSpec[]`, when `seedValues(specs)` is called, then it returns a
   `ControlValues` mapping each spec's `key` to its `default`. Given `undefined`
   or `[]`, it returns `{}`.
3. Given a `ControlValues`, when `setValue(values, key, v)` is called, then it
   returns a **new** object equal to `values` with `key` set to `v`; the input
   object is not mutated.
4. Given `design/registry.ts`, when imported, then it exports
   `studies: Study[]` containing `RecipeCardStudy`.
5. Given `RecipeCardStudy`, then its `name` is `"RecipeCard"`, `group` is
   `"Cards"`, and its `render(values)` produces a `RecipeCard` element whose
   `title` and `imageUrl` derive from the control values (`title` text control,
   `hasImage` boolean control toggling a placeholder image URL vs `undefined`).
6. Given the registry, when `design/registry.test.ts` runs under `node --test`,
   then it asserts: every study `name` is non-empty; all `name`s are unique across
   `studies`; within each study, all `control.key`s are unique. Any violation
   fails the test.
7. Given `npm test`, when run, then the `test` script's glob includes
   `design/*.test.ts` and every test passes.

## Test Cases

### Test Case 1: Control helpers are pure and correct (AC 2, 3)

**Preconditions:** `design/controls.ts` and `design/controls.test.ts` exist.

**Steps:**
1. Run `npm test`.
2. Inspect assertions in `design/controls.test.ts`.

**Expected Outcomes:**
- `seedValues` with a mixed `ControlSpec[]` (one of each kind) returns the four
  defaults keyed correctly; `seedValues(undefined)` and `seedValues([])` return `{}`.
- `setValue({a:1}, "b", 2)` returns `{a:1, b:2}`; the original `{a:1}` is unchanged
  (assert with a not-equal reference check or a frozen-input check).
- All assertions pass.

### Test Case 2: Registry integrity guards malformed studies (AC 4, 6)

**Preconditions:** `design/registry.ts` and `design/registry.test.ts` exist.

**Steps:**
1. Run `npm test`.
2. Temporarily add a second study with the name `"RecipeCard"` (duplicate) and
   re-run, to confirm the integrity test fails; then revert.

**Expected Outcomes:**
- With the real registry, integrity assertions pass and `studies` includes
  `RecipeCardStudy`.
- With the injected duplicate, the "names are unique" assertion fails — proving
  the guard works. [ASSUMPTION: this negative check is done manually during
  review, not committed.]

### Test Case 3: RecipeCardStudy renders from control values (AC 5)

**Preconditions:** `design/studies/RecipeCard.study.tsx` exists.

**Steps:**
1. Read the study; confirm `controls` declares a `text` control `title` and a
   `boolean` control `hasImage`.
2. Confirm `render({ title, hasImage })` passes `title={String(title)}` and
   `imageUrl={hasImage ? <placeholder-url> : undefined}` to `RecipeCard`.

**Expected Outcomes:**
- The study is a valid `Study`; TypeScript compiles with no errors
  (`npx tsc --noEmit` clean for these files).

## Test Run

_To be filled in during execution._

## Deployment Strategy

Direct commit to the feature branch. This ships no runtime surface on its own
(nothing imports `design/` yet), so there is zero user-facing risk. No feature
flag needed.

## Production Verification

Not applicable — no production surface. Verification is the passing `node --test`
suite and a clean `tsc --noEmit`.

### Production Verification 1: N/A

**Preconditions:** —
**Steps:** —
**Expected Outcomes:** —

## Production Verification Run

_N/A._
