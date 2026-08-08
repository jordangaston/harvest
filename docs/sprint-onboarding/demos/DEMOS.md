# Onboarding Improvements — demo evidence (Phase 7)

## Objective verification (offline, reproducible)
| Check | Command | Result |
|---|---|---|
| Mobile types | `npx tsc --noEmit` | **clean (exit 0)** |
| Server suite (regression) | `server: npm test` | **23 files / 86 tests passed**, offline (~11s) |
| Full iOS integration bundle | `npx expo export --platform ios` | **success — 5.02 MB Hermes bundle** |

The `expo export` is the strongest integration signal available without a native build: it drives every new
route and component through Metro + NativeWind + Reanimated/Worklets babel + expo-router registration +
asset `require()` resolution. A green bundle proves all six sub-stories load together — valid route
default-exports, resolvable assets, transforming `className`s, and no bundle-time import errors.

## Live-sim demo — environment constraint (honest)
Interactive sim screenshots were **not** captured. Two blockers, both environmental (logged in POSTMORTEM):
1. **The import pipeline needs external keys** (DeepSeek/Groq/Apify/LamaTok) that aren't available here, so
   a live "Try with a sample recipe" cannot complete end-to-end (item-1's real import).
2. The app requires a **custom native dev build** (NativeWind + Reanimated + Worklets + expo-video — no
   Expo Go path). A fresh build risks **re-triggering the ENOSPC** that already hit this shared, disk-tight
   volume mid-sprint — building would endanger the five other parallel worktrees. I chose not to.

Recommendation: run interactive demos in an env with import keys + disk headroom; items 2 and 3 complete
with only the local backend and are the quickest to show live.

## Per-sub-story walkthrough (flow + where each AC lives)

### OB-1 — checklist state (`lib/onboardingChecklist.ts`)
- `checklistState({importedFirst,shortcutDone}, cookbookCount)` → per-item + `allDone`. Pure; truth table:
  `(F,F,0)`→all pending; `(T,F,1)`→items 1&3 done; `(T,T,1)`→`allDone`. Flags in AsyncStorage
  (`readFlags` tolerates missing/corrupt → both false). `useOnboardingFlags` (`staleTime:0`) + the two
  `useMark…` hooks (write + invalidate). Verified by tsc + bundle; exercised through OB-2/5/6 below.

### OB-2 — home checklist card (`components/recime/OnboardingChecklist.tsx`, `recipes.tsx`)
- Flow: open the app → recipes screen shows a `bg-cream` "Let's get cooking!" card **above** the Cookbooks
  grid (empty-state art removed). Three `bg-card` rows with icons + `›`. A done row → filled check +
  strikethrough, not tappable. Chevron collapses; auto-collapses when `allDone`. Collapse uses a
  motion-token `LayoutAnimation`, skipped under Reduce Motion.
- End-to-end completions that need NO keys: finishing the unlock carousel strikes item 2 (OB-5); creating a
  cookbook strikes item 3 (`useCreateCookbook` invalidates `cookbooks` → `cookbookCount>0`).

### OB-3 — add-recipe sheet replaces the FAB menu (`components/recime/AddRecipeSheet.tsx`)
- Flow: tap the `+` FAB **or** the checklist's "Import your first recipe" → the **same** sheet (old inline
  Modal deleted — one entry point, Architect must-fix). Root rows: Import from social media / Import from web
  / New cookbook (nothing lost vs. the old menu). "Social" slides to a 4-platform stage (Pinterest/TikTok/
  Instagram/YouTube, no Facebook) with a back chevron. Web→`/import`; platform→`/import-source?source=`;
  New cookbook→`NewCookbookSheet`.
- **Must-fix motion:** the root↔social slide uses `DURATION.medium/fast` + `EASE.smoothOut` and is set
  instantly when `AccessibilityInfo.isReduceMotionEnabled()`.

### OB-4 — per-platform screen (`app/import-source.tsx`, `lib/sampleRecipes.ts`)
- Flow: "Import from {Platform}" with a swipeable 3-slide coaching carousel (mock post → share sheet → done)
  + page dots. "Open {Platform}" tries the app scheme then falls back to the https homepage (so the button
  always acts; `LSApplicationQueriesSchemes` added to `app.json`). "Try with a sample recipe" →
  `/importing?url=<fixed e2e URL>` — a real pipeline import (needs keys to complete; on success flips item 1).

### OB-5 — unlock-faster-importing carousel (`app/unlock-importing.tsx`)
- Flow: checklist item 2 → intro "Save recipes faster 🚀 / Add the shortcut" → 5 illustrated steps (More →
  Edit → +Harvest → drag to top → Done), in-app mocks (OS-share-sheet art may read white per the AGENTS.md
  OS-mimic exception; screen chrome stays `bg-cream`). "Done" → `markShortcutDone()` → back on home item 2
  is struck. Instructional-only (no live Share Extension this wave).
- **Must-fix motion:** step travel uses the tokens and is skipped under Reduce Motion. **Fully demoable with
  no keys** — the whole flags→invalidate→strikethrough loop is exercised here.

### OB-6 — completion wiring (`app/importing.tsx`)
- `markImportedFirst()` is `await`ed on `result.status === "ready"` before `router.replace`, the single
  chokepoint for both web and sample imports. The recipes tab stays mounted, so the awaited invalidate is
  the refresh signal. Verified by code + tsc; end-to-end run needs import keys.
