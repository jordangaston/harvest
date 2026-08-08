# Instrumentation — Sprint Report

**Outcome:** client-only Mixpanel instrumentation, built to `WAVE2-DECISIONS.md` #5. One analytics facade,
three auto events, four owned domain events, onboarding enums as people-properties, and a Noop backend that
sends nothing until a token is configured. No schema, no server code, no new UI.

## What shipped

**New — `lib/analytics/`**
- `core.ts` — backend-agnostic `Analytics` (track / setScreen / onSignup / reset); stamps `screen`, dedupes
  screen views, swallows backend errors so analytics can never break a user action.
- `backend.ts` — `Backend` interface + `NoopBackend` (the default).
- `people.ts` — pure onboarding-payload → people-properties mapper.
- `label.ts` — best-effort Button label extraction (no `[object Object]`).
- `config.ts` — reads `extra.mixpanelToken`; undefined ⇒ stay Noop.
- `mixpanelBackend.ts` — the live SDK path, lazy-required so a token-less build never loads the native module.
- `index.ts` — the `analytics` singleton + `initAnalytics()`.

**Wired chokepoints (no sibling screens touched)**
- `components/ui/index.tsx` — `Button` → `Button Tapped {label, screen}`.
- `components/recime/OnboardingScreen.tsx` — CTA → `Onboarding Step Completed {step}`.
- `components/recime/ScreenTracker.tsx` + `app/_layout.tsx` — `Screen Viewed {screen}` + `initAnalytics()`.
- `lib/api/auth.ts` — `onSignup` (identify + people + `Signup Completed`) **only on a real signup** (guarded on
  the onboarding payload, so anonymous/401 re-provision never fires it).
- `lib/api/imports.ts` / `recipes.ts` / `cookbooks.ts` — `Recipe Imported` / `Recipe Saved` (count>0) /
  `Cookbook Created`.

## Verification
- **Mobile:** `npm run typecheck` clean; `npm test` = **13/13** offline (`node --test`, no RN/network).
- **Server regression:** **86 tests / 23 files green**, offline, against an isolated DB (config reverted — PR
  diff keeps default `harvest`).
- **Live exercise:** `demos/journey-trace.ts` prints the full taxonomy firing end-to-end. See `demos/DEMO.md`.

## Event catalog
`Screen Viewed`, `Button Tapped`, `Onboarding Step Completed` (auto) · `Signup Completed`, `Recipe Imported`,
`Recipe Saved`, `Cookbook Created` (owned domain). Title-Case names, `snake_case` props, `screen` super-property
on every event, onboarding enums as people-properties.

## Deferred / cross-task (coordinator-owned)
- **Sibling `track()` calls** for `Recipe Added to Meal Plan`, `Added to Grocery List`, `Logged Out`,
  `Data Deleted` — a post-merge pass adds one line each at the flows those Leads own; the contract is in
  `DESIGN.md`. Not wired here (would touch sibling screens).
- **Live Mixpanel send** — token + SDK install + prebuild is a founder step (`DESIGN.md` Appendix B).
- **`welcome.tsx`** advances via its own CTA (not `OnboardingScreen`), so it emits `Button Tapped` but not
  `Onboarding Step Completed` — intended (it's the entry, not a step). Only `_layout` + `welcome` skip the shell.

## Migration note
None — this task adds no tables, columns, enums, or migration.

## Risks
1. **Native SDK build** — `mixpanel-react-native` needs a prebuild the founder hasn't run; verified by
   construction/typecheck, not executed. Fallback: a thin HTTP `/track` backend behind the same interface.
2. **Button label coverage** — auto-labels resolve for string/`ButtonText` children; icon-only buttons emit
   `Button Tapped` with no label (by design). If richer labels are wanted, add an optional `trackLabel` prop.
3. **Identify timing vs Phone Auth** — the `onSignup` hook sits in `provisionUser`; Phone Auth is moving user
   creation, so confirm the hook still fires at the real signup after their merge.
