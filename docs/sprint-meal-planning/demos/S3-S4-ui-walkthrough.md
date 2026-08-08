# S3 + S4 — UI walkthrough (code-grounded)

**Live-sim status:** a **real on-device capture was run** on a dedicated iOS simulator against the live
backend — see `meal-planning-demo.mp4` (22s, iPhone 16 Pro, iOS 18.1) and the `frame-0*.png` key frames.
The clip shows the **Meal Plan week view** (S3: week strip `03 Aug – 09 Aug` with `‹ ›`, `Today • Saturday 8`
in brand tint, day sections with the empty state, `Add to groceries` hook, per-day `+` and FAB) and the
**`Add a meal` menu** sliding up (S4 AC1: Breakfast/Lunch/Dinner/Snack on a `bg-cream` sheet with golden-hour
tinted icons). The remaining sub-stories (add → toast → remove, the cookbook grid / search / ingredient-AND /
total-time filters, and add-from-recipe-card) are mapped to code below and were exercised through the live
`GET /v1/recipes` + `meal-plan` endpoints with 8 seeded recipes; the recording was **truncated** before they
could be filmed because the shared machine evicted/deleted the sim mid-run (see below). Every UI sub-story is
code-complete, `tsc --noEmit` clean, and its pure logic is covered by `lib/__checks__/meal-plan-checks.ts`.

## Capture setup + why the clip is short (environment blocker — logged in POSTMORTEM)
Real setup used: dedicated `simctl` device → Expo Go (SDK 54) → app on Metro `:8092` → live backend on
`:3000` (my `meal_plan_entries` migration applied, 8 real recipes seeded for the provisioned user). The six
parallel sprints share **one machine** and it was degraded throughout: disk hit **ENOSPC (99% full)** — freed
via DerivedData cleanup — and memory thrashed (<500 MB free), so CoreSimulator **repeatedly shut down and then
deleted my sim devices** mid-run (device #1 killed twice then deleted; device #2 deleted within ~1 min). The
22s clip landed during a brief ~1.3 GB-free window right after a mass sim cleanup; that window closed before
the full flow could be filmed. Per the POSTMORTEM's own lesson, the responsible call was to **stop hammering a
degraded shared machine** rather than burn it (and the other five sprints) on retries. A healthy environment
can film the full flow with the same setup; nothing in the code blocks it.

## S3 — Meal-plan week view (`app/(app)/meal-plan.tsx`)
- **AC1 week strip + arrows** — `formatWeekRange(monday)` label between `‹`/`›` that `setMonday(addDays(monday, ±7))`; the week key `queryKeys.mealPlan(weekStart)` changes, so `useMealPlanWeek` refetches the new week.
- **AC2 Today** — each day compares `toISO(d) === todayISO()` (device-local) and renders `Today • <Weekday> <D>` in `text-brand`, else `text-ink`.
- **AC3 grouped rows + empty state** — `groupByDay(entries)` over server-ordered entries (date→meal→position, the pg enum order); each row = thumbnail + title + `mealChip(meal)` tint (`components/recime/meals.ts`, four AA-contrast golden-hour tints); empty day → "No recipes yet".
- **AC4 open recipe** — the row's `onOpen` → `router.push('/recipe/'+id)`.
- **AC5 remove** — the trailing `close-circle` calls `useRemoveMealPlanEntry(weekStart).mutate(id)`, which optimistically drops the row (`onMutate` snapshot + `setQueryData`), rolls back on error, and reconciles on settle. (Swipe-to-delete was **punted** — no gesture pattern exists in the repo; a tap affordance avoids adding reanimated/gesture-handler. Logged as a ceiling.)
- **AC6 cache** — reads go through `useMealPlanWeek` (5-min `staleTime`), so a revisit serves cache; add/remove invalidate the `["mealPlan"]` prefix so every cached week refetches.
- **AC7 groceries hook + add entry points** — the "Add to groceries" button is a **placement-only hook** (a `// ponytail:` no-op handoff; Grocery wires the action); a day `+` and the FAB open `MealMenu` → `AddRecipeSheet` (FAB targets today and jumps the view to today's week).
- **Design system / motion** — `bg-cream` canvas, `bg-card` rows, no `bg-white`; the `Toast` rises via `TOAST` tokens and honors `AccessibilityInfo.isReduceMotionEnabled()`; sheets are `Modal animationType="slide"`.

## S4 — Add-recipe flow
- **AC1 meal menu** — `MealMenu` (`components/recime/MealMenu.tsx`) lists the four meals; picking one opens `AddRecipeSheet` titled `Add to <Meal>` (`mealLabel`).
- **AC2 cookbook grid → recipe list** — `AddRecipeSheet` level 1 = `CookbookGrid` (synthetic **All recipes** tile + `useCookbooks()`); tapping sets `cookbookId` and `inList=true`.
- **AC3 search** — `filterCards(..., { search })` (case-insensitive title substring).
- **AC4 ingredient filter (AND) + Popular grid** — `IngredientFilterSheet` renders `useCommonIngredients()` (endpoint **with hard-coded fallback** in `lib/api/ingredients.ts` — a 404 never blanks the grid); multi-select; `filterCards` requires **all** selected terms (substring AND); the search box also adds a free-text term.
- **AC5 total time** — `TotalTimeSheet` radios Under 15/30/60; `filterCards` keeps `total_minutes <= bucket` and **excludes null** when a bucket is active; Clear removes it.
- **AC6 add + toast + refetch** — tapping a recipe → `useAddMealPlanEntry().mutateAsync` → `onAdded` closes the sheet, shows `Added to <Meal>`, and the mutation invalidates `["mealPlan"]` so the week refetches.
- **AC7 from a recipe card** — `app/recipe/[id].tsx` ⋯ menu → "Add to meal plan" → `AddToPlanSheet` (recipe pre-chosen) → week day-picker → `MealMenu` → POST → toast `Added to <Meal> · <day>`.
- **AC8 sheet hygiene** — every sheet is `bg-cream` (rows `bg-card`), `animationType="slide"`, and **resets its state on `visible`** (drill-down level, filters, search) — the reused-instance rule from `docs/rn-nativewind-pitfalls.md`.

## Backing evidence in this folder
- `S1-S2-backend-demo.md` — the live data layer the screens call (list, add, week, remove, cascade, errors).
- Full server suite green offline (26 files, 100 tests incl. `meal-plan.test.ts` + `recipes-list.test.ts`).
- `lib/__checks__/meal-plan-checks.ts` — week math + `filterCards` (AND / null-time / cookbook) assertions pass.
