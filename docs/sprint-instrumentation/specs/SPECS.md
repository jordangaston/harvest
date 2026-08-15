# Instrumentation — per-sub-story specs (Phase 4)

Decomposed from `DESIGN.md`, built to `WAVE2-DECISIONS.md` #5. Each sub-story lists acceptance criteria →
test cases → files touched. Offline test = `node --test lib/analytics/*.test.ts` (Node 24 strips TS); RN/expo
are never imported by the tested units. Sim demo exercises the Noop+debug path (token unset).

## S1 — Analytics facade + Noop backend + token gate
**AC:** A singleton `analytics` exposes `track/identify/onSignup/reset/setScreen`; every method is safe before
init and when the token is unset; with no token the backend is `NoopBackend` and forwards nothing.
**Tests:** `core.test.ts` — no-token → injected SDK spy sees 0 calls; fake backend → `track` forwards
`{name, props}`; `track` merges the current `screen`; calling before init does not throw.
**Files:** `lib/analytics/core.ts`, `lib/analytics/backend.ts`, `lib/analytics/config.ts`,
`lib/analytics/index.ts`.

## S2 — People-properties + identify at signup
**AC:** At signup, `onSignup(userId, onboarding)` calls `identify(userId)`, sets the onboarding enums +
`signup_at` as people-properties, and tracks `Signup Completed`, all before `resetOnboarding()` drains the
accumulator.
**Tests:** `people.test.ts` — a sample `Payload` maps to the exact snake_case people object (+ injected
`signup_at`); `core.test.ts` — `onSignup` order = identify → people.set → track.
**Files:** `lib/analytics/people.ts`, `lib/analytics/core.ts`, `lib/api/auth.ts` (call the hook).

## S3 — Screen Viewed (auto)
**AC:** Each route change emits one `Screen Viewed { screen }` and updates the module `currentScreen` so other
events inherit `screen`; no duplicate on re-render of the same path.
**Tests:** `core.test.ts` — `setScreen(a)` then `setScreen(a)` tracks once; `setScreen` updates the screen
merged into later `track` calls.
**Files:** `lib/analytics/core.ts`, `components/recime/ScreenTracker.tsx`, `app/_layout.tsx`.

## S4 — Button Tapped (auto, shared primitive)
**AC:** Every tap on the shared `Button` emits `Button Tapped { label, screen }`, then runs the caller's
`onPress` unchanged; label derives from string children / `ButtonText`; unresolved label is omitted (never
`[object Object]`). Non-interference: emission is fire-and-forget.
**Tests:** `label.test.ts` — string child, `<ButtonText>` child, icon-only (→ undefined); `core.test.ts`
covers dispatch.
**Files:** `lib/analytics/label.ts`, `components/ui/index.tsx` (wrap `Button.onPress`).

## S5 — Onboarding Step Completed (auto)
**AC:** Advancing an onboarding screen via its CTA emits `Onboarding Step Completed { step, step_index }`
(step = route name), then runs the original `onCta`.
**Tests:** covered by `core.test.ts` dispatch + manual sim demo (route → event).
**Files:** `components/recime/OnboardingScreen.tsx` (wrap `onCta`).

## S6 — Named domain events at owned chokepoints
**AC:** `Recipe Imported { recipe_count }` on import ready; `Recipe Saved { recipe_id, cookbook_count }` when
saved to ≥1 cookbook; `Cookbook Created { cookbook_id }` on create. Fired on success only, from `lib/api/*`
functions I own. Sibling actions (meal-plan/grocery/profile) are NOT wired here (deferred post-merge pass).
**Tests:** sim/live demo per event; guards unit-covered where pure (save fires only when count>0).
**Files:** `lib/api/imports.ts`, `lib/api/recipes.ts`, `lib/api/cookbooks.ts`.

## S7 — MixpanelBackend (real path, token-gated) + founder one-pager
**AC:** With a token, the facade lazy-loads `mixpanel-react-native` and maps facade calls to the SDK; the SDK
is never imported/executed when the token is unset. A founder one-pager documents install + token config.
**Tests:** not runnable offline (native, token-gated) — verified by construction + typecheck; dormant by
design.
**Files:** `lib/analytics/mixpanelBackend.ts`, `docs/sprint-instrumentation/DESIGN.md` Appendix B.
