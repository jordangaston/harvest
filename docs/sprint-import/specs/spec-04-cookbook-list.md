# Spec 04 — List cookbooks on the recipe screen

## Background
The Recipes screen is the app's home (the `Recipes` tab). It must show all of the user's cookbooks;
with none, it shows the empty state. Recime renders a "Cookbooks" section of tiles (thumbnail +
name + "N Recipe" count) with a **+** FAB, and a "Let's get cooking!" empty state when there's
nothing yet.

## Objective
Replace the in-memory sample list on the Recipes screen with the user's real cookbooks from the API,
including counts and a cover thumbnail, plus a proper empty state.

## Backend (new)
- `GET /v1/cookbooks` → `200 { cookbooks: [{ id, name, recipe_count, cover_image_url? }] }` for the
  caller, newest first. `recipe_count` = rows in `cookbook_recipes`; `cover_image_url` = image of the
  most recently added recipe in that cookbook (join, no N+1 per `server/CLAUDE.md`).

## Acceptance Criteria
- AC1: Given the user has cookbooks, when the Recipes screen loads, then each cookbook renders as a
  tile with cover thumbnail, name, and recipe count, newest first.
- AC2: Given the user has no cookbooks, when the Recipes screen loads, then the golden-hour empty
  state shows ("Let's get cooking!" + add affordances), not an empty list.
- AC3: Given a cookbook was just created (spec 03), when returning to the Recipes screen, then it
  appears without a manual refresh (refetch on focus).
- AC4: Tiles use `bg-card` (selected `bg-brand-light`+`border-brand`); `<Backdrop />` behind; the
  **+** FAB uses `bg-brand`; wordmark uses Lora, body Karla.
- AC5: Tapping a cookbook tile navigates to its Show Cookbook screen (spec 05).

## Touches
- `app/(app)/recipes.tsx` — swap `useSavedRecipes()` sample data for `GET /v1/cookbooks`; render
  tiles + empty state + FAB menu.
- `lib/api/cookbooks.ts` — `listCookbooks()`.
- Reuse/extend the empty-state art already in `assets/` + `components/recime/`.

## Test Cases
### Test Case 1: Populated list
**Preconditions:** ≥2 cookbooks, one containing a recipe with an image.
**Steps:** Open Recipes tab.
**Expected Outcomes:** Tiles show cover/name/count, newest first; cover comes from a real recipe.

### Test Case 2: Empty state
**Preconditions:** No cookbooks.
**Steps:** Open Recipes tab.
**Expected Outcomes:** Empty state art + copy; no blank/broken list.

### Test Case 3: Live refresh after create
**Steps:** Create a cookbook, return to Recipes.
**Expected Outcomes:** New tile present without app restart.

### Test Case 4: Backend
**Steps:** `npm test` for the list endpoint (count + cover join).
**Expected Outcomes:** Returns counts and a cover for a cookbook with recipes; empty array for a new
user.

## Test Run
_To be filled during execution._

## Deployment Strategy
Additive read endpoint + client swap. No flag.

## Production Verification
### Production Verification 1: Counts are correct
**Steps:** Add a recipe to a cookbook, reopen Recipes.
**Expected Outcomes:** That cookbook's count increments; cover reflects the added recipe.

## Production Verification Run
_To be filled during execution._
