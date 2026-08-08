# S4 — Add-recipe flow (meal menu, sheet, filters, from-recipe)

## Background
Per `DESIGN.md` F-02/F-03. Reuse the `CookbookPickerSheet` slide-sheet pattern (`Modal transparent
animationType="slide"`, `bg-cream` sheet, `bg-card` rows, state reset on `visible`). Common ingredients come
from `GET /v1/ingredients/common` (Grocery owns; **hard-coded fallback** until it ships — Architect must-fix).

## Objective
From a day (`+`/FAB): pick meal → sheet (cookbook grid → recipe list, search + ingredient/time filters) → tap
recipe → `POST` entry → toast. From a recipe card: recipe pre-chosen → pick day → pick meal → `POST` → toast.

## Acceptance criteria
- **AC1** Tapping a day `+` (or FAB=today) opens `MealMenu` (Breakfast/Lunch/Dinner/Snack); picking one opens
  `AddRecipeSheet` for that date+meal, titled "Add to <Meal>".
- **AC2** The sheet first shows cookbook tiles: a synthetic **All recipes** tile (whole library) + each real
  cookbook; tapping one shows that set's recipe cards.
- **AC3** The search box filters cards by title (case-insensitive substring).
- **AC4** The **Ingredients** filter opens a sheet with a "Popular" grid from `GET /v1/ingredients/common`
  (fallback list if the call fails); multi-select; a card matches only if its `ingredient_names` contain **all**
  selected (AND). Selecting via the ingredient search adds a term too.
- **AC5** The **Total time** filter (radio: Under 15/30/60) keeps cards whose `total_minutes` ≤ bucket; null
  `total_minutes` is excluded while a bucket is active; Clear removes it.
- **AC6** Tapping a recipe `POST`s `{date,meal,recipe_id}`, closes the sheet, shows a toast "Added to <Meal>",
  and the meal-plan week refetches (invalidated).
- **AC7** From a recipe card, "Add to meal plan" opens a day-picker (week `‹ ›`) → `MealMenu` → `POST`; recipe
  stays pre-chosen; toast "Added to <Meal> · <day>".
- **AC8** All sheets: no `bg-white`, reset state on open, animate (motion tokens), honor Reduce Motion.

## Test cases
- **Unit (`lib/__tests__/filterCards.test.ts`)** — `filterCards(cards, {search, ingredients, maxMinutes})`:
  title substring; ingredient AND; time bucket with null excluded; empty filters = identity.
- **Demo D5 (AC1–AC6)** add a recipe to Thursday-lunch via cookbook grid + an ingredient filter; row appears.
- **Demo D6 (AC7)** from a recipe card, add to a day; open Meal Plan → present.

## Files
- `components/recime/MealMenu.tsx` — meal picker (small slide sheet).
- `components/recime/AddRecipeSheet.tsx` — cookbook grid → filtered recipe list; props `{visible,date,meal,onAdded}`.
- `components/recime/AddToPlanSheet.tsx` — recipe pre-chosen; day-picker → MealMenu.
- `components/recime/IngredientFilterSheet.tsx`, `components/recime/TotalTimeSheet.tsx`.
- `lib/filterCards.ts` — pure filter fn (+ test).
- `lib/api/ingredients.ts` — `listCommonIngredients()` with hard-coded fallback.
- `lib/api/recipes.ts` — `listRecipes({expand})` (pages to end).
- `lib/api/hooks.ts` — `useLibraryCards()`, `useCommonIngredients()` (`queryKeys.recipes`, `queryKeys.commonIngredients`).
- `app/recipe/[id].tsx` — add an "Add to meal plan" action (menu row or button) opening `AddToPlanSheet`.

## Notes / decisions
- Client-side filtering over the full library (DESIGN ceiling; fine at v1 scale).
- Fallback common-ingredient list ~12 items with existing `iconKey`s; replaced transparently once Grocery ships the endpoint.
