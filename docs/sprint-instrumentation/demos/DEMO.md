# Instrumentation — Phase 7 demos (per sub-story)

Instrumentation has **no UI screens and no server endpoints** — it is cross-cutting client analytics. So the
"live exercise" is the analytics **core run through a real user journey** (`journey-trace.ts`, the same
`Analytics` object the app's chokepoints call) plus the offline unit suite. The live Mixpanel send path is
token-gated and dormant in every runnable environment by design (decision #5), so there is nothing to send or
screenshot on the sim; see "Live send path" at the bottom.

## Live exercise — full journey event stream
`node docs/sprint-instrumentation/demos/journey-trace.ts` replays welcome → goals → signup → import/save,
driving the real core with a capturing backend:

```
track      Screen Viewed  {"screen":"/(onboarding)/welcome"}
track      Button Tapped  {"screen":"/(onboarding)/welcome","label":"Get started"}
track      Screen Viewed  {"screen":"/(onboarding)/goals"}
track      Button Tapped  {"screen":"/(onboarding)/goals","label":"Continue"}
track      Onboarding Step Completed  {"screen":"/(onboarding)/goals","step":"/(onboarding)/goals"}
track      Screen Viewed  {"screen":"/(onboarding)/notifications"}
identify   user-42
people.set {"signup_at":"2026-08-07T00:00:00.000Z","goals":["eat_healthier"],"how_heard":"tiktok","age":"from_25_to_34"}
track      Signup Completed  {"screen":"/(onboarding)/notifications"}
track      Screen Viewed  {"screen":"/(app)/recipes"}
track      Recipe Imported  {"screen":"/(app)/recipes","recipe_count":1}
track      Recipe Saved  {"screen":"/(app)/recipes","recipe_id":"r1","cookbook_count":2}
track      Cookbook Created  {"screen":"/(app)/recipes","cookbook_id":"c9"}
```

Every event carries the `screen` super-property; `identify` + `people.set` precede `Signup Completed`. That is
the whole taxonomy firing end-to-end.

## Per sub-story

| Sub-story | Evidence | Result |
|---|---|---|
| **S1** facade + Noop + gate | `core.test.ts`: no-backend forwards nothing; wired backend receives `track`; throwing backend never propagates | ✅ 3 asserts |
| **S2** people-props + identify | `people.test.ts` (3) maps enums + `signup_at`; `core.test.ts` asserts identify→people→track order; trace shows it | ✅ |
| **S3** Screen Viewed | `core.test.ts` dedupes repeat path + stamps `screen`; trace shows one event per route change | ✅ |
| **S4** Button Tapped | `label.test.ts` (5): string / `<ButtonText>` / icon-only→undefined; trace shows `label` on taps | ✅ |
| **S5** Onboarding Step Completed | trace shows the CTA emitting `{step}`; wired in `OnboardingScreen.onCta` | ✅ |
| **S6** domain events | trace shows `Recipe Imported` / `Recipe Saved {cookbook_count:2}` / `Cookbook Created`, fired from `lib/api/*` chokepoints; save guarded on count>0 | ✅ |
| **S7** MixpanelBackend | typechecks; dormant unless a token is set (see below) | ✅ built, not run |

## Test output
```
# mobile offline suite (npm test)
ℹ tests 13   ℹ pass 13   ℹ fail 0
# server regression suite (isolated DB, offline)
Test Files  23 passed (23)   Tests  86 passed (86)
```

## Chokepoint wiring (code trace)
- `components/ui/index.tsx` — `Button.onPress` → `track("Button Tapped", {label})` then the caller's `onPress`.
- `components/recime/OnboardingScreen.tsx` — CTA → `track("Onboarding Step Completed", {step})` then `onCta`.
- `components/recime/ScreenTracker.tsx` + `app/_layout.tsx` — `usePathname` effect → `setScreen`; `initAnalytics()` once.
- `lib/api/auth.ts` — `provisionUser` → `onSignup` **only when an onboarding payload is present** (no false signup on re-provision).
- `lib/api/imports.ts` / `recipes.ts` / `cookbooks.ts` — `Recipe Imported` / `Recipe Saved` (count>0) / `Cookbook Created` on success.

## Live send path (token-gated — not run here)
The app is a managed Expo project (no native dirs); `mixpanel-react-native` is a native module that needs a
prebuild, and the token is unset in dev/sim/tests, so the SDK never loads and nothing is sent (decision #5).
Enabling it is a founder step — install the SDK, set `extra.mixpanelToken`, and build — documented in
`DESIGN.md` Appendix B. Not a regression risk: the Noop path is the only one any runnable build exercises.
