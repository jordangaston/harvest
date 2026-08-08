# S3 + S4 — UI walkthrough (code-grounded)

**Live-sim status:** a visual sim capture was **not run** — see the blocker below. Every UI sub-story is
code-complete, `tsc --noEmit` clean (root typecheck passes), the pure logic it relies on is covered by a
runnable check (`lib/__checks__/meal-plan-checks.ts`, all assertions pass), and the data layer it drives is
proven by the S1/S2 backend live demo. This walkthrough maps each acceptance criterion to the implementing
code so a reviewer (or a later sim pass) can verify behavior directly.

## Why no sim capture (environment blocker — logged in POSTMORTEM)
The six parallel sprints share one machine. During this sprint the disk hit **ENOSPC twice**, which crashed
the shared Postgres (recovered both times). The app is a **managed Expo workflow** (no `ios/` dir), no
dev-client or Harvest app is installed on any simulator, and the dev backend's DB (port 5432) is currently
down. Producing screenshots would require a full native `expo run:ios` build (GBs, minutes) on a volatile
disk — the exact pressure that already crashed the shared DB twice and would jeopardize the other five
sprints. The responsible call was to **not** run a heavy native build in a degraded shared environment. The
coordinator (who owns the sim-isolation addendum and the machine) can run the visual pass in a healthy
environment; nothing in the code blocks it.

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
