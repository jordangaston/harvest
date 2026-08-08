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

## Demo video (Phase 7) — real device, Expo Go on the iOS simulator

`demos/instrumentation-demo.mp4` (26.5s) shows the instrumentation firing through the **live** onboarding
flow on a real sim device. A dev-only `AnalyticsDebugOverlay` (`__DEV__`-gated, `pointerEvents="none"`) feeds
off the analytics core and renders each event as it fires, so the otherwise-invisible instrumentation is
visible on screen. Keyframes: `demos/frame-1-welcome.png` … `demos/frame-4-awesome-step-completed.png`.

Visible on-device: `Screen Viewed` on every route change, `Button Tapped {label}` on each CTA, and
`Onboarding Step Completed {step}` on each onboarding advance — **S3/S4/S5 verified live on the device**.
`Signup Completed` + identify/people (S2) and the four domain events (S6) fire from the main-app/import
chokepoints, which need the server; they remain covered by `demos/journey-trace.ts` + the unit suite. The
Mixpanel send path (S7) is token-gated and dormant by design (decision #5).

**Capture method (honest note):** the clip is assembled from **real on-device screen captures**, not one
continuous `simctl recordVideo` take. During capture the shared host was under a severe, sustained load spike
(load average 150–750) that repeatedly shut down — and at one point *deleted* — the sim device mid-recording
and killed Metro. A single continuous clip was not achievable under that load; a fresh continuous capture can
be produced once host load subsides.

### Boot fix found while wiring the demo (important)

The app **did not boot** with the instrumentation as originally written: Metro could not bundle it. The
`loadMixpanel()` helper used `require(moduleName)` where `moduleName` was a folded string constant, so Metro
still tried to resolve the un-installed native `mixpanel-react-native` (`Unable to resolve …`); making the
name non-constant then hit Expo's transformer, which rejects dynamic `require(variable)` outright
(`Invalid call … require(moduleName)`). Either way the bundle failed and the app crashed to the home screen on
every launch. The offline `node --test` suite never exercises a Metro bundle, so it passed while the app was
unrunnable.

**Fix (two lines of intent):** resolve the optional native dep to an empty module in `metro.config.js` until
it is installed, and use a clean literal `require("mixpanel-react-native")` in `lib/analytics/mixpanelBackend.ts`.
The SDK still only loads when a token is set (decision #5 preserved). Verified: bundle now succeeds
(`iOS Bundled …`), the app boots, and the full onboarding runs with events firing on-device. Typecheck clean.

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
