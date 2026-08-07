# Spec 04 — Multi-recipe carousel: set the cookbook per recipe

## Story
When a slideshow import yields several recipes in the swipe carousel, the user must be able to choose
a different cookbook for each recipe. Today the save files them all into the same one.

**Decision (Phase 2):** per-card "Save to cookbook" button — each carousel page saves that one recipe
via the existing picker, mirroring the single-recipe preview screen.

## Fix (`app/preview.tsx`)
Restructure the carousel:
- Drop the global keep-toggle + single "Save N recipes to cookbook" footer.
- Each `RecipePreviewPage` gets its own bottom "Save to cookbook" button (like `recipe/[id].tsx`
  preview mode). Tapping opens `CookbookPickerSheet` with `recipeIds={[thatRecipe.id]}`.
- On save: mark that card saved (inline "Saved to <cookbook> ✓" state) and keep the user in the
  carousel to save the others. The header ✕ returns to `/(app)/recipes`.
- Track saved state per recipe id (`Set` or `Map<id, cookbookName>`).

`CookbookPickerSheet.onSaved` gains the chosen cookbook name(s) so the card can show "Saved to X"
(and story 05's toast can name it). Existing `setRecipeCookbooks(recipeId, ids)` already scopes to one recipe.

## Files
- `app/preview.tsx` — per-card save button + saved state; remove global save/keep.
- `components/recime/CookbookPickerSheet.tsx` — `onSaved(cookbookNames: string[])`.

## Tests
Client UI — verified live in the simulator (no unit test framework for RN screens here).

## Acceptance / verify (live)
Import the IG carousel → swipe to recipe A, save to cookbook "Dinner"; swipe to recipe B, save to a
DIFFERENT cookbook "Quick". Confirm in the app that A is in Dinner and B is in Quick (not all in one).
Record the demo.
