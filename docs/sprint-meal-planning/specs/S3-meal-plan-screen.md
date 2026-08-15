# S3 — Meal-plan screen (week view)

## Background
`app/(app)/meal-plan.tsx` is a static stub. Rebuild it as the live week view per `DESIGN.md` F-01/F-04/F-05,
honoring the design system (no `bg-white`; `bg-cream` canvas, `bg-card` rows), motion tokens, Reduce Motion,
and the client-cache pattern (`docs/client-caching.md`).

## Objective
A Monday-start week the user pages with `‹ ›`, the current day marked "Today", each day's assigned recipes as
rows with a meal chip, tap → recipe card, swipe → remove. Reads via `useQuery` (`queryKeys.mealPlan(weekStart)`),
writes invalidate that key. An "Add to groceries" button is rendered as a **hook only** (no ordering wired).

## Acceptance criteria
- **AC1** The week strip shows `‹ DD Mon YYYY – DD Mon YYYY ›` (Mon–Sun); `‹`/`›` shift the shown week ±7 days
  and refetch that week's entries.
- **AC2** The day matching the device-local date renders `Today • <Weekday> <D>` in `text-brand`; others in `text-ink`.
- **AC3** Each day lists its entries (thumbnail + title + a token-tinted meal chip) grouped/ordered
  Breakfast→Lunch→Dinner→Snack then `position`; an empty day shows "No recipes yet".
- **AC4** Tapping an entry routes to `/recipe/:id`.
- **AC5** Swiping an entry row removes it (optimistic; rollback on error) and the slot updates.
- **AC6** Revisiting the tab within `staleTime` renders from cache (no refetch); after an add/remove the week
  refetches (key invalidated).
- **AC7** An "Add to groceries" button is present but only calls the Grocery hook (documented no-op handoff);
  a day `+` and the FAB open the add flow (S4).

## Test cases (manual demo — sim; typecheck must pass)
- **D1 (AC1,AC2)** open Meal Plan → current week, Today highlighted; tap `›`/`‹` → adjacent weeks.
- **D2 (AC3,AC4)** a day with entries shows rows + chips; tap one → recipe card.
- **D3 (AC5)** swipe a row → it disappears; reopen week → still gone.
- **D4 (AC6)** add via S4 → the day shows the new entry without a manual refresh.

## Files
- `app/(app)/meal-plan.tsx` — rebuild.
- `lib/api/meal-plan.ts` — `listMealPlan(start,end)`, `addMealPlanEntry`, `removeMealPlanEntry`.
- `lib/api/hooks.ts` — `useMealPlanWeek(weekStart)`, `useAddMealPlanEntry()`, `useRemoveMealPlanEntry()`
  (invalidate `queryKeys.mealPlan(weekStart)`).
- `lib/api/types.ts` — `MealSlot`, `ApiMealPlanEntry`, `RecipeCard`.
- `lib/week.ts` — `mondayOf(date)`, `weekDates(monday)`, `formatWeekRange`, `todayISO` (device-local); pure,
  unit-tested (`lib/__tests__/week.test.ts`).

## Notes / decisions
- Meal chips: four soft golden-hour tints (from `tailwind.config.js` tokens), AA-contrast, not Recime blue/yellow.
- Swipe-to-delete via RN `Animated`/gesture already used elsewhere, or a simple right-swipe row; honor Reduce Motion.
- FAB adds to **today**; day `+` adds to that day (opens MealMenu → S4).
