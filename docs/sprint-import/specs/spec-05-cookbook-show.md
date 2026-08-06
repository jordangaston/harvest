# Spec 05 — Show cookbook

## Background
Tapping a cookbook tile opens the cookbook, showing its recipes as cards (thumbnail + name), like
Recime's cookbook screen ("Mains / 1 Recipe" + recipe cards).

## Objective
Add a cookbook detail screen that lists the recipes in a cookbook as thumbnail+name cards, with an
empty state, backed by a real endpoint.

## Backend (new)
- `GET /v1/cookbooks/:id` → `200 { cookbook:{ id, name }, recipes:[{ id, title, image_url? }] }` for
  the caller, newest first. `404 NOT_FOUND` if the cookbook isn't the caller's.

## Acceptance Criteria
- AC1: Given a cookbook with recipes, when opened, then each recipe shows as a card with thumbnail
  and name; header shows the cookbook name and recipe count.
- AC2: Given an empty cookbook, when opened, then a friendly empty state shows.
- AC3: Tapping a recipe card opens the recipe detail screen (spec 06).
- AC4: Cards use `bg-card`, `<Backdrop />` behind; a recipe with no image uses a token-colored
  placeholder (never `bg-white`).
- AC5: A cookbook that isn't the caller's 404s and the UI shows a not-found state rather than
  crashing.

## Touches
- New route `app/cookbook/[id].tsx`.
- `lib/api/cookbooks.ts` — `getCookbook(id)`.
- Reusable `RecipeCard` component (thumbnail + name), reused on Recipes/cookbook screens.

## Test Cases
### Test Case 1: Populated cookbook
**Preconditions:** Cookbook with ≥2 recipes.
**Steps:** Open it.
**Expected Outcomes:** Cards render with thumbnail+name; count correct.

### Test Case 2: Empty cookbook
**Preconditions:** New cookbook, no recipes.
**Steps:** Open it.
**Expected Outcomes:** Empty state, no broken cards.

### Test Case 3: Card → detail
**Steps:** Tap a card.
**Expected Outcomes:** Recipe detail opens for that id.

### Test Case 4: Backend ownership
**Steps:** `npm test` — fetch own cookbook (200 with recipes), another user's (404).
**Expected Outcomes:** As specified.

## Test Run
_To be filled during execution._

## Deployment Strategy
Additive endpoint + new screen. No flag.

## Production Verification
### Production Verification 1: Membership reflects reality
**Steps:** Save a recipe into a cookbook, open the cookbook.
**Expected Outcomes:** The recipe card is present.

## Production Verification Run
_To be filled during execution._
