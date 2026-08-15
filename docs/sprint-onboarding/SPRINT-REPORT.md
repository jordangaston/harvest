# Onboarding Improvements — Sprint Report

## What shipped
A recipes-screen **onboarding checklist** ("Let's get cooking!" — import a recipe, unlock faster importing,
create a cookbook) plus the flows it launches: a single **Add-a-recipe** sheet (social / web / new cookbook)
that replaces the old FAB menu, per-platform **import coaching** with a real sample import, and the
**Unlock-faster-importing** shortcut carousel. Client-only — **no server code, no migrations**.

## Sub-stories (all implemented)
| ID | Story | Files |
|---|---|---|
| OB-1 | Local checklist state (pure reducer + AsyncStorage flags + cached hooks) | `lib/onboardingChecklist.ts`, `lib/queryKeys.ts` |
| OB-2 | Home checklist card (replaces empty-state, collapsible, strikethrough) | `components/recime/OnboardingChecklist.tsx`, `app/(app)/recipes.tsx` |
| OB-3 | Add-recipe sheet replaces the FAB menu (one entry point) | `components/recime/AddRecipeSheet.tsx`, `app/(app)/recipes.tsx` |
| OB-4 | Per-platform coaching + Open-app deep-link + sample import | `app/import-source.tsx`, `lib/sampleRecipes.ts`, `app.json` |
| OB-5 | Unlock-faster-importing shortcut carousel | `app/unlock-importing.tsx`, `app/_layout.tsx` |
| OB-6 | First-import completion wiring | `app/importing.tsx` |

## Architect must-fixes — both done
- **Motion tokens + Reduce Motion** on the add-recipe sheet (root↔social slide) and the unlock carousel
  (step travel): both drive `Animated.timing` off `DURATION`/`EASE` and set the value instantly when
  `AccessibilityInfo.isReduceMotionEnabled()`. The checklist collapse uses a token `LayoutAnimation`, also
  Reduce-Motion-guarded.
- **One entry point:** the `+` FAB and the checklist both open the *same* `AddRecipeSheet`; the old inline
  FAB Modal is deleted, and "New cookbook" moved into the sheet so nothing is lost.

## Verification
- **Mobile `tsc --noEmit`: clean.**
- **Server suite: 23 files / 86 tests green, offline** (~11s) — confirms the (untouched) backend didn't
  regress. Run against a private throwaway PG cluster; no committed config change (see POSTMORTEM).
- **`expo export --platform ios`: success (5.02 MB bundle)** — every new screen integrates through Metro/
  NativeWind/Reanimated/expo-router.

## Live demo video
A real screen recording of the full flow runs in **Expo Go (SDK 54)** on an iPhone 16 simulator against the
local backend (server + Postgres, live Apify/Groq keys): `docs/sprint-onboarding/demos/onboarding-demo.mp4`
(~88s, h264). It walks the home checklist → Add-a-recipe sheet → social platforms → YouTube import-coaching
carousel (3 slides) → **Try with a sample recipe**, which runs a real import and lands on the imported
**Buffalo Chicken Hot Pockets** recipe with a Save-to-cookbook sheet. Four key frames sit beside it in
`demos/` (`onboarding-demo-frame-1..4-*.png`). This supersedes the earlier "sim screenshots not captured"
note in `DEMOS.md` — the environmental blockers (import keys + a no-prebuild run path) were both resolved:
Expo Go SDK 54 runs the app with no dev build, and the pipeline keys were present in `server/.env`.

## Binding-doc compliance
No `bg-white` on Harvest surfaces (sheets `bg-cream`, rows `bg-card`); the only white is the OS-share-sheet
mock art in the coaching carousels — the sanctioned `AGENTS.md` OS-mimic exception. Motion via `lib/motion.ts`
tokens, Reduce Motion honored everywhere. Client caching: `useOnboardingFlags` via `queryKeys`, marks
invalidate their key (no hand-rolled fetching).

## Cross-task seams
- **Consumes** `GET /v1/cookbooks` (checklist item 3) and the import pipeline (`runImport`). Does **not**
  consume Meal Planning's `GET /v1/recipes` — item-1 completion is a local flag, by design.
- **Adds no migration** (`main` at 0008 untouched). **Owns nothing** other tasks consume.
- Screens fire Instrumentation events through the shared `Button`; the SDK is that task's to add.

## Known limitations / follow-ups
- **Social share-back is instructional only** — Harvest isn't in the iOS share sheet until the Share
  Extension ships (Wave 3). Copy frames the carousels as "here's how it will work." Top product risk.
- **Sample-recipe URLs are hardcoded** (from `server/tests/e2e/*`) and can rot; the e2e suite is the canary.
- **Live-sim demo was environment-blocked** (no import keys + native-build disk risk); see `demos/DEMOS.md`.
