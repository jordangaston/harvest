# Spec 08 — Delete recipe

## Background
The user can delete recipes. Because recipes are canonical/shared, "delete" means **remove from my
library** — drop the caller's `saved_recipes` row and any `cookbook_recipes` rows for that recipe.
The canonical recipe row remains for other savers.

## Objective
Let the user delete a recipe from their library and cookbooks, with a confirm step, and have it
disappear from the Recipes screen and every cookbook it was in.

## Backend (new)
- `DELETE /v1/recipes/:id` → `204`. Deletes the caller's `saved_recipes` row + the caller's
  `cookbook_recipes` rows for that recipe (one `db.transaction()`). `404 NOT_FOUND` if the caller
  hadn't saved it. Does NOT delete the shared `recipes` row.

## Acceptance Criteria
- AC1: Given a saved recipe, when the user deletes it and confirms, then it is removed from the
  library and from any cookbook that contained it.
- AC2: Given the delete, when confirmed, then other users who saved the same recipe still have it
  (canonical row untouched).
- AC3: Given a destructive action, when the user taps delete, then a confirmation is required before
  the API call (guard against accidental loss).
- AC4: Given deletion succeeds, when returning to Recipes/cookbook, then the recipe/card is gone
  without a manual refresh.
- AC5: Confirmation UI uses tokens (no `bg-white`); destructive action uses the `error` token color.

## Touches
- Backend: `repositories/recipe-repository.ts` (`removeForUser`), `services/recipe-service.ts`
  (`remove`), route in `api/`, `openapi/document.ts`.
- App: delete affordance in `app/recipe/[id].tsx` ("⋯" menu) with a confirm; `lib/api/recipes.ts` —
  `deleteRecipe(id)`; refetch Recipes/cookbook on focus.

## Test Cases
### Test Case 1: Delete removes from library + cookbooks
**Preconditions:** Recipe saved and in "Mains".
**Steps:** Open recipe → ⋯ → Delete → confirm.
**Expected Outcomes:** Gone from Recipes and from "Mains".

### Test Case 2: Confirm required
**Steps:** Tap Delete, dismiss the confirm.
**Expected Outcomes:** No API call; recipe still present.

### Test Case 3: Canonical row survives (backend)
**Preconditions:** Users A and B saved recipe R.
**Steps:** A `DELETE /v1/recipes/R`.
**Expected Outcomes:** 204; A no longer has R; B still reads R; `recipes` row still exists.

### Test Case 4: Delete unsaved 404 (backend)
**Steps:** Delete a recipe the caller never saved.
**Expected Outcomes:** 404.

## Test Run
_To be filled during execution._

## Deployment Strategy
Additive endpoint + client confirm. No flag; the confirm + soft (library-only) delete keep it safe.

## Production Verification
### Production Verification 1: Delete sticks
**Steps:** Delete a recipe, relaunch.
**Expected Outcomes:** Still gone for this user.

## Production Verification Run
_To be filled during execution._
