# Spec 06 — Show recipe (tap an ingredient inside a step)

## Background
Tapping a recipe opens its detail page. The signature interaction (from Recime): when an
ingredient's name appears inside a step, it renders as a tappable link; tapping it reveals that
ingredient's exact amount and its icon, with **haptic feedback** on tap. `GET /v1/recipes/:id`
returns `{ id, title, image_url?, servings?, total_minutes?, ingredients:[{name, icon?}], steps:[] }`.

**Backend change required:** the current `PublicRecipe` drops `quantity_text`/`amount`/`unit`, but
the tap interaction needs the exact amount. Widen the ingredient projection to include them.

## Objective
Build the recipe detail screen: hero image, title, meta, ingredient list (icon + amount + name),
numbered steps, and inline tappable ingredient references in steps that reveal amount+icon with a
haptic. Reuse this screen for the import preview (spec 02) and edit (spec 07).

## Backend (change)
- Extend `RecipeDetail.ingredients` and `PublicRecipe.ingredients` to
  `{ name, icon?, quantity_text?, amount?, unit? }`; update `toPublicRecipe` and the repository
  select. Additive to the wire shape.

## Ingredient-in-step matching (client)
- For each step, find occurrences of each ingredient's `name` (longest-first, case-insensitive,
  word-boundary) and render them as tappable spans styled with a token highlight (e.g.
  `text-brand-dark` / `bg-brand-light`, never green-on-white). Tapping opens a small popover/sheet
  showing the ingredient icon + exact amount (`quantity_text` ?? `amount`+`unit`) and fires
  `expo-haptics` `impactAsync(Light)`.
- ponytail: naive name matching is the known ceiling (won't catch plurals/synonyms); upgrade to a
  server-provided step→ingredient index if accuracy matters. Logged in postmortem.

## Acceptance Criteria
- AC1: Given a recipe, when opened, then hero image, title, meta, ingredients (icon+amount+name),
  and numbered steps render, using `bg-card`/tokens and `<Backdrop />`.
- AC2: Given a step that mentions an ingredient by name, when rendered, then that name is visibly
  tappable (token highlight, not plain text).
- AC3: Given a tappable ingredient reference, when tapped, then a popover shows its icon and exact
  amount AND a light haptic fires.
- AC4: Given an ingredient with no icon, when shown, then a token placeholder is used (no `bg-white`,
  no broken image).
- AC5: Given a remote `image_url`, when shown, then it loads via `expo-image`; a missing image uses a
  token placeholder.
- AC6: New dep `expo-haptics` added.

## Touches
- `app/recipe/[id].tsx` — full detail UI (shared preview/detail/edit modes).
- New: `components/recime/StepText.tsx` (inline ingredient linking), ingredient popover.
- `lib/api/recipes.ts` — `getRecipe(id)`.
- Backend: `models/recipe.ts`, `repositories/recipe-repository.ts`.
- Icon mapping: server `icon` key → painterly asset via the existing `assets/ingredients/*` map
  (extend `components/recime/recipes.ts` ICON map / add a resolver); fallback token chip.

## Test Cases
### Test Case 1: Render
**Preconditions:** A recipe id (imported).
**Steps:** Open detail.
**Expected Outcomes:** Image, title, ingredients with icons+amounts, numbered steps.

### Test Case 2: Tap ingredient in step → amount + haptic
**Preconditions:** A step contains an ingredient name.
**Steps:** Tap the highlighted name.
**Expected Outcomes:** Popover shows icon + exact amount; a haptic fires (device/sim log).

### Test Case 3: Missing icon/image placeholders
**Preconditions:** Ingredient with null icon and/or recipe with null image.
**Steps:** Open detail.
**Expected Outcomes:** Token placeholders; nothing white/broken.

### Test Case 4: Backend projection
**Steps:** `npm test` — `GET /v1/recipes/:id` includes `quantity_text`/`amount`/`unit` when present.
**Expected Outcomes:** Fields present; existing tests updated/green.

## Test Run
_To be filled during execution._

## Deployment Strategy
Additive projection widening + client screen. No flag.

## Production Verification
### Production Verification 1: Real recipe interaction
**Steps:** Open an imported recipe, tap an ingredient inside a step.
**Expected Outcomes:** Correct amount + icon + haptic.

## Production Verification Run
_To be filled during execution._
