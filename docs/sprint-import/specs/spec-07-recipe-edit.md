# Spec 07 — Edit recipe (steps & ingredients)

## Background
The user can edit a recipe's steps and ingredients. Recipes are **canonical/shared** — many users
can save the same recipe — so an in-place edit would corrupt every other saver's copy. The edit must
be personal: **copy-on-write**.

## Objective
Let the user edit the ingredient lines and step texts of a recipe in their library and persist those
edits as their own, without affecting other users who saved the same recipe.

## Backend (new)
- `PATCH /v1/recipes/:id { ingredients?: string[], steps?: string[] }` → `200 { recipe }` (the
  public recipe, possibly under a NEW id if forked).
  - Ownership: caller must have the recipe saved (`saved_recipes`), else `404`.
  - **Copy-on-write:** if any other user also has this recipe saved, clone the recipe + ingredients
    (re-run `mapIngredientIcon` on changed lines) + steps into a new recipe row, repoint the
    caller's `saved_recipes` and `cookbook_recipes` to the clone, then apply the edit to the clone.
    If the caller is the sole saver, edit in place. One `db.transaction()`.
  - Ingredients/steps are full replacements (ordered arrays); positions re-derived from array order.
- `CookbookExistsError` pattern reused for any new errors as needed.

## Acceptance Criteria
- AC1: Given a saved recipe, when the user edits a step's text and saves, then re-opening the recipe
  shows the new text.
- AC2: Given a saved recipe, when the user edits/adds/removes an ingredient line and saves, then the
  ingredient list reflects the change (icons re-resolved for changed lines).
- AC3 (isolation): Given two users saved the same recipe, when user A edits, then user B's recipe is
  unchanged (A's edit forked to a new recipe id).
- AC4: Given the sole saver edits, when saved, then no needless duplicate row is created (in-place).
- AC5: Editing UI uses tokens (`bg-card` fields, `bg-brand` save), `<Backdrop />`; reachable from the
  recipe detail "Edit" affordance.
- AC6: After edit, the recipe still appears in the same cookbook(s) it was in.

## Touches
- Backend: `repositories/recipe-repository.ts` (clone + update methods), `services/recipe-service.ts`
  (`update` with COW logic + saver count), route + Zod in `api/`, `openapi/document.ts`.
- App: edit mode in `app/recipe/[id].tsx` (or `app/recipe/[id]/edit.tsx`) — editable ingredient/step
  lists (add/remove/edit rows); `lib/api/recipes.ts` — `updateRecipe(id, {ingredients, steps})`.

## Test Cases
### Test Case 1: Edit a step
**Steps:** Open a saved recipe → Edit → change step 1 → Save → reopen.
**Expected Outcomes:** Step 1 shows new text.

### Test Case 2: Edit ingredients
**Steps:** Edit → change one line, add one, delete one → Save.
**Expected Outcomes:** List matches; icons resolved for changed/added lines.

### Test Case 3: Copy-on-write isolation (backend)
**Preconditions:** Two users saved recipe R.
**Steps:** User A `PATCH /v1/recipes/R` steps.
**Expected Outcomes:** Response recipe id ≠ R; A's saved/cookbook rows point to the clone; B still
reads original R unchanged.

### Test Case 4: In-place for sole saver (backend)
**Preconditions:** Only user A saved R.
**Steps:** A patches R.
**Expected Outcomes:** Same id R; updated in place; no clone.

### Test Case 5: Membership preserved
**Steps:** Recipe in "Mains", edit it, open "Mains".
**Expected Outcomes:** Edited recipe still listed in "Mains".

## Test Run
_To be filled during execution._

## Deployment Strategy
Additive endpoint; COW protects shared data. Backend + client. No flag.

## Production Verification
### Production Verification 1: Edit persists
**Steps:** Edit a real imported recipe, reopen after relaunch.
**Expected Outcomes:** Edits persist for this user only.

## Production Verification Run
_To be filled during execution._
