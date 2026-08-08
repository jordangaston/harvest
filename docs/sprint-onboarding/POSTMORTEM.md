# Onboarding Improvements — POSTMORTEM (kept open during the sprint)

Decide-and-log: every non-obvious call made without pausing the founder.

## Environment / parallelism workarounds
- **Test-DB isolation:** six worktrees share one Postgres; `global-setup` resets the schema. Before
  running the server suite I point it at `harvest_test_onboarding` / `harvest_dbos_onboarding` via
  `server/vitest.config.ts` `test.env`, run green, then **revert the edit before commit** (log the run).
- **Sim isolation (addendum):** the iOS sim is shared. I boot a dedicated device `Harvest-onboarding`,
  target it via `IDB_UDID`, and run Metro on a unique port. Sessions kept short.

## Environment reality (decide-and-log)
- **No `node_modules`** in the fresh worktree; the committed `package-lock.json` is **out of sync** with
  `package.json` (missing `react-dom`/`scheduler`), so `npm ci` fails. Used `npm install` to get a working
  tree; **reverted `package-lock.json` before commit** so the PR carries no lockfile churn. Mobile
  `tsc --noEmit` → **clean**.
- **Postgres was not running** and the EDB service needs elevated/interactive auth. Instead of the brief's
  "shared 5432 + unique DB name" (blocked: `create-databases.ts` hardcodes the admin URL to `:5432` and the
  DB names `harvest`/`harvest_dbos`, so global-setup can't provision a custom-named DB), I stood up a
  **private throwaway PG 17 cluster** via `initdb` (data dir in scratchpad, `--auth=trust`, superuser
  `postgres`) on `:5432`. Isolation is the private data dir, so **no `vitest.config.ts` edit was needed**
  (reverted the exploratory one) → zero committed-file churn. Server suite: **23 files / 86 tests, all
  green, offline** (~11s). Cluster stopped after the run.
- **Disk hit ENOSPC mid-sprint** (six worktrees + node_modules share a small data volume); freed space by
  deleting the CLARIFY-phase video frames/montages from scratchpad.
- **Import pipeline needs external keys** (DeepSeek/Groq/Apify/LamaTok) unavailable here, so a live "Try
  with a sample recipe" can't complete end-to-end in this environment — item-1 completion is verified by
  code + the shared `importing.tsx` chokepoint. Items 2 (shortcut) and 3 (cookbook) need only the local
  backend and ARE demoed end-to-end.

## Decisions log
- (see below)

## Pre-mortem findings folded in (Phase 5 subagent)
- **P0-1** `queryKeys.onboardingFlags` missing → tsc break. Added the key.
- **P0-2** sample "Try" routed to `/importing` with no url → always failed. `lib/sampleRecipes.ts` + `?url=` wiring.
- **P0-3 / P1-1** item 1 never struck: `markImportedFirst` not wired. Wired into `importing.tsx` on `ready`, and
  **awaited before `router.replace`** — the recipes tab stays mounted, so the invalidate (not stale-time) is the
  only refresh signal; it must complete.
- **P0-4** `/unlock-importing` route didn't exist / unregistered. New screen + `Stack.Screen` entry.
- **P1-2** persisted query cache could resurrect a stale `importedFirst:false`. `useOnboardingFlags` set
  `staleTime: 0` so every mount refetches AsyncStorage (the source of truth).
- **P1-3** iOS `canOpenURL` returns false without `LSApplicationQueriesSchemes`. Added the four schemes to
  `app.json`; deep-link uses try-`openURL`-catch→https fallback so the button always does something. Dropped Facebook.
- **P1-5** the FAB-Modal→AddRecipeSheet swap must keep the toast untouched and one screen-level `NewCookbookSheet`
  (AddRecipeSheet's "New cookbook" closes + calls back to toggle it). Kept the Cookbooks grid.
- **P2-1/2-2** Reduce Motion + JS-driver-on-mount + LayoutAnimation guard + inline colour in `Animated.View` on the
  new animated surfaces. (Slide transitions are user-triggered on already-mounted views, so native driver for
  `translateX` is safe; opacity-on-fresh-mount would not be.)
- **P2-5** guard `undefined` counts: `checklistState(flags ?? EMPTY, cookbooks?.length ?? 0)`; render the card for
  empty and non-empty accounts.

## Decisions log
- **AddRecipeSheet keeps "New cookbook"** as a third row so replacing the FAB menu loses nothing (Architect
  must-fix: one entry point). Checklist item 3 opens the same `NewCookbookSheet` directly.
- **`unlock-importing` is a pushed screen**, not a Modal (design showed a Modal) — simpler back-handling and
  full-bleed step art; still honors motion tokens + Reduce Motion. Framed as instructional (no live Share Extension).
- **No mobile unit test for `checklistState`** — the app has no RN test runner (only `tsc`); standing one up is
  scope creep (Q-04). The pure reducer is verified in the OB-2 sim demo + types. Logged per design Q-04.
