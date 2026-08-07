# Spec 03 — Add a cookbook (two entry points) & save recipe into it

## Background
Cookbooks organize recipes. They don't exist server-side yet. This spec adds the `cookbooks` table
+ `cookbook_recipes` join, the create/save endpoints, and the two UI entry points from the story:
(1) Recipes screen **+** → "Add a cookbook"; (2) while saving a recipe on the preview screen, tap
**+** to create a cookbook and save into it **without leaving the screen** (matches Recime's
"New cookbook" sheet → returns to the save screen with the new cookbook selected as a chip).

## Objective
Let a user create a named cookbook from both places, with empty-name validation and owner-scoped
name-collision handling, and file a recipe into one or more cookbooks during save.

## Backend (new)
- Table `cookbooks` (id, user_id→users, name text, created_at) + `uniqueIndex(user_id, name)`.
- Table `cookbook_recipes` (id, cookbook_id→cookbooks cascade, recipe_id→recipes cascade,
  created_at) + `uniqueIndex(cookbook_id, recipe_id)`.
- `POST /v1/cookbooks { cookbook:{ name } }` → `201 { cookbook:{ id, name, recipe_count:0 } }`.
  - Empty/whitespace name → `400 INVALID_REQUEST` (Zod `.min(1)` after trim).
  - Duplicate name for this user → `409 COOKBOOK_EXISTS` (new `CookbookExistsError`).
- `PUT /v1/recipes/:id/cookbooks { cookbook_ids: string[] }` → `200 { cookbook_ids }`. Sets the
  caller's membership for that recipe: inserts missing, deletes removed. Ensures a `saved_recipes`
  row exists. 404 if the recipe id is unknown; ignores cookbook ids the caller doesn't own.
- `CookbookRepository`/`CookbookService` with `static create()`, Zod `CookbookSchema`, multi-table
  writes in `db.transaction()`, per `server/CLAUDE.md`.

## Acceptance Criteria
- AC1: Given the Recipes screen, when the user taps **+** → "Add a cookbook", enters a name, and
  confirms, then a cookbook is created and appears in the cookbook list.
- AC2: Given the recipe **preview/save** screen, when the user taps **+** (new cookbook), enters a
  name, and confirms, then the sheet closes back to the save screen, the new cookbook shows as a
  selected removable chip, and the user has NOT left the save screen.
- AC3 (empty name): Given the create sheet, when the name is empty/whitespace and the user confirms,
  then an inline validation error shows and no request is sent (create button disabled until valid,
  matching Recime).
- AC4 (collision): Given a cookbook named "Mains" already exists for the user, when the user creates
  another "Mains", then the API returns 409 and the UI surfaces a friendly "You already have a
  cookbook called “Mains”" message (offers to use the existing one).
- AC5: Given cookbooks selected on the save screen, when the user taps Save, then
  `PUT /v1/recipes/:id/cookbooks` records membership and the recipe appears inside each chosen
  cookbook (spec 05).
- AC6: All sheets/inputs use design tokens (`bg-card` surface, `bg-brand` primary, `border-brand`
  selected), `<Backdrop />` behind; char counter mirrors Recime's `0/50`.

## Touches
- Backend: `db/schema/cookbooks.ts`, `db/schema/cookbook-recipes.ts`, schema `index.ts`, a migration,
  `repositories/cookbook-repository.ts`, `services/cookbook-service.ts`, routes + Zod in `api/`,
  `CookbookExistsError` in `api/errors.ts`, `openapi/document.ts`.
- App: New-cookbook sheet component (shared by both entry points), `app/(app)/recipes.tsx` (+ menu),
  recipe save screen (cookbook multi-select + inline new-cookbook), `lib/api/cookbooks.ts`.

## Test Cases
### Test Case 1: Create from Recipes screen
**Preconditions:** Session active.
**Steps:** + → Add a cookbook → "Weeknight" → Create.
**Expected Outcomes:** 201; "Weeknight" in the cookbook list with 0 recipes.

### Test Case 2: Create during save, stay on screen
**Preconditions:** On preview/save screen for an imported recipe.
**Steps:** Tap + (new cookbook) → "Desserts" → Create → Save.
**Expected Outcomes:** Sheet closes to the same save screen; "Desserts" chip selected; after Save the
recipe is in "Desserts".

### Test Case 3: Empty name blocked
**Steps:** Open create sheet, leave name blank.
**Expected Outcomes:** Create disabled / inline error; no network call.

### Test Case 4: Duplicate name handled
**Preconditions:** "Mains" exists.
**Steps:** Create "Mains" again.
**Expected Outcomes:** 409 COOKBOOK_EXISTS; friendly collision message; no duplicate row.

### Test Case 5: Backend unit/integration
**Steps:** `cd server && npm test`.
**Expected Outcomes:** New cookbook create (happy/empty/collision) and membership-set tests pass;
existing tests still green.

## Test Run
_To be filled during execution._

## Deployment Strategy
Backend migration first (additive tables — safe), then client. No flag; additive.

## Production Verification
### Production Verification 1: Create + collision
**Steps:** Create a cookbook, then create it again.
**Expected Outcomes:** First 201, second 409 surfaced friendly.

## Production Verification Run
_To be filled during execution._
