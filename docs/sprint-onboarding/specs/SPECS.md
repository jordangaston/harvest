# Onboarding Improvements — per-sub-story specs (Phase 4)

Built from `DESIGN.md` + `WAVE2-DECISIONS.md`. Client-only: no server code, no migrations. Each story
lists acceptance criteria → how it's verified (mobile has **no test runner**, so verification is the pure
reducer's demo + `tsc --noEmit` + a sim demo) and the files it touches.

## OB-1 — Checklist state module (`lib/onboardingChecklist.ts`, `lib/queryKeys.ts`)
Local completion, not server state (decision: two flags device-local, cookbook from cache).
- **AC1** `checklistState(flags, cookbookCount)` is pure and returns `{ importFirst, unlockShortcut, createCookbook, allDone }` where `importFirst=flags.importedFirst`, `unlockShortcut=flags.shortcutDone`, `createCookbook=cookbookCount>0`, `allDone=all three`.
- **AC2** Flags persist in `AsyncStorage` under one namespaced key; `readFlags()` tolerates missing/corrupt storage → both `false`.
- **AC3** `markImportedFirst()` / `markShortcutDone()` write the flag idempotently.
- **AC4** `queryKeys.onboardingFlags` added; `useOnboardingFlags()` reads via `useQuery`; `markImportedFirst/Done` invalidate that key so mounted cards refresh.
- **Verify:** reducer truth table exercised in the OB-2 demo; types via `tsc`.
- **Files:** `lib/onboardingChecklist.ts` (new), `lib/queryKeys.ts` (+key).

## OB-2 — Home checklist card (`components/recime/OnboardingChecklist.tsx`, `app/(app)/recipes.tsx`)
- **AC1** A `bg-cream` card titled "Let's get cooking!" (Lora wordmark accent) sits **above** the Cookbooks grid; it **replaces** the old empty-state art.
- **AC2** Three rows (`bg-card`): "Import your first recipe", "Unlock faster importing", "Create your first cookbook", each with an Ionicon + `›`.
- **AC3** A done row shows a filled check + **strikethrough** label and is not tappable.
- **AC4** Tapping a pending row invokes its handler: import→open AddRecipeSheet; shortcut→`/unlock-importing`; cookbook→open NewCookbookSheet.
- **AC5** Card is collapsible via a chevron; when `allDone` it defaults collapsed. Collapse honors Reduce Motion (LayoutAnimation guarded).
- **AC6** No `bg-white`; tokens from `lib/motion.ts`; card reads `useOnboardingFlags()` + `useCookbooks()`.
- **Verify:** sim demo — fresh state shows 3 pending; after a sample import item 1 strikes; after a cookbook item 3 strikes.
- **Files:** new component; `recipes.tsx` (render card, drop empty-state art).

## OB-3 — Add-recipe sheet replaces the FAB menu (`components/recime/AddRecipeSheet.tsx`, `app/(app)/recipes.tsx`)
Architect must-fix: ONE entry point.
- **AC1** The `+` FAB and the checklist "Import your first recipe" open the **same** `AddRecipeSheet`; the old inline import/cookbook Modal is removed.
- **AC2** Root stage rows (`bg-card` on a `bg-cream` sheet): "Import from social media", "Import from web", "New cookbook". No option is lost vs. the old menu.
- **AC3** "Import from social media" transitions in-sheet to a **social stage** listing 4 platforms (Pinterest, TikTok, Instagram, YouTube) with a back chevron. No Facebook.
- **AC4** Web → `/import`; a platform → `/import-source?source=<Platform>`; New cookbook → NewCookbookSheet; each closes the sheet.
- **AC5 (must-fix)** The root↔social stage transition uses `DURATION`/`EASE` from `lib/motion.ts` and is **skipped when `AccessibilityInfo.isReduceMotionEnabled()`**.
- **Verify:** sim demo — FAB opens sheet; social→4 platforms→back; each route fires; Reduce Motion path instant.
- **Files:** new component; `recipes.tsx` (swap Modal for sheet).

## OB-4 — Per-platform screen (`app/import-source.tsx` rewrite, `lib/sampleRecipes.ts`)
- **AC1** Title "Import from {Platform}"; a **swipeable carousel** (paged ScrollView + dots) of coaching slides (mock post + "tap send → tap share → tap Harvest"). Coaching only.
- **AC2** "Open {Platform} to find a recipe" deep-links via the platform scheme, **falling back to the https homepage** if the app can't open. Schemes for all four (Pinterest/TikTok/Instagram/YouTube); Facebook removed.
- **AC3** "Try with a sample recipe" routes to `/importing?url=<SAMPLE[platform]>` — a **real import** of the fixed e2e URL, which on success marks item 1 done (via importing.tsx, OB-6).
- **AC4** `lib/sampleRecipes.ts` holds one URL per platform (from `server/tests/e2e/*`): pinterest `pin.it/6S1Z5sKLl`, tiktok `tiktok.com/t/ZTAsQBAYX/`, instagram `instagram.com/reel/DYmyAAaMDBj/`, youtube `youtube.com/shorts/JESPUqVMJpU`.
- **AC5** Design tokens; no `bg-white`; coach pulse honors Reduce Motion.
- **Verify:** sim demo per platform — carousel swipes; Open deep-links (or falls back); sample import runs the real pipeline to preview.
- **Files:** `import-source.tsx`, `lib/sampleRecipes.ts` (new).

## OB-5 — Unlock-faster-importing carousel (`app/unlock-importing.tsx`)
- **AC1** Intro slide "Save recipes faster 🚀 — Add Harvest to the share menu…" + a primary CTA advancing to the steps.
- **AC2** Five illustrated steps (More → Edit → +Harvest → drag to top → Done), each an **in-app mock** (built from views, no screenshot assets) + coach text + Next; the OS-share-sheet mocks may use white per the `AGENTS.md` OS-mimic exception, but the screen/sheet chrome stays `bg-cream`/`bg-card`.
- **AC3** Finishing the last step calls `markShortcutDone()` and returns to the recipes screen, where item 2 is now struck.
- **AC4 (must-fix)** Step-to-step travel uses `DURATION`/`EASE` from `lib/motion.ts` and is **skipped under Reduce Motion** (`AccessibilityInfo`).
- **AC5** Framed as instructional ("here's how it works") — honest that the share tail is not live yet (no Share Extension this wave).
- **Verify:** sim demo — intro→5 steps→done; back on home item 2 struck; Reduce Motion instant.
- **Files:** `app/unlock-importing.tsx` (new).

## OB-6 — Completion wiring (`app/importing.tsx`)
- **AC1** On `result.status === "ready"`, `markImportedFirst()` runs (write + invalidate) before navigation, so returning home shows item 1 done. Applies to both web and sample imports (single chokepoint = importing.tsx).
- **AC2** No double-writes or races: mark is fire-and-forget before `router.replace`.
- **Verify:** part of OB-4/OB-2 demos.
- **Files:** `app/importing.tsx`.

## Out of scope / unchanged
Server, migrations, `GET /v1/recipes` (Meal Planning owns; unused here), Share Extension (Wave 3),
Instrumentation SDK (separate task — screens only fire through the shared `Button`).
