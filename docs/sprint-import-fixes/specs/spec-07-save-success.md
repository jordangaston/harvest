# Spec 07 — Saving ends in a branded success, not a "save another" modal

## Background
After saving, the app shows the `SuccessCelebration` modal with "View recipe" + "Save another
recipe". User wants: no "save another" modal; instead a success state built around a generated
success image, then navigate back to the home recipes screen.

## Objective
Saving a recipe ends in a delightful branded success moment and returns the user home.

## Acceptance criteria
- AC1: Remove the "Save another recipe" affordance. After a successful save, show a success state
  centered on a **generated success image** (nano-banana, golden-hour painterly style — e.g. a
  celebratory "Now you're cooking!" illustration) with a brief success line.
- AC2: The success state auto-dismisses (or on a single tap) and **navigates back to the home
  Recipes screen** (`/(app)/recipes`) — not back to the preview.
- AC3: Works for both single-recipe and multi-recipe (spec 04) saves.
- AC4: `bg-card`/token surfaces only (no `bg-white`); the generated image is embedded as an asset.
- AC5: If nano-banana quota is exhausted, use a styled token success card (checkmark) and LOG the gap.

## Touches
- `assets/` (new success image, e.g. `success-cooking.jpg`/png).
- `components/recime/SuccessCelebration.tsx` (rebuild: hero success image, no "save another",
  auto-navigate home).
- `app/recipe/[id].tsx` (+ carousel preview) `onSaved` → show success → `router.replace("/(app)/recipes")`.

## Test cases
1. Import → save into a cookbook → success image shows → lands on the Recipes home (cookbook now
   shows the recipe). No "save another" modal appears.

## Verification
Client change; verify in the simulator end-to-end.
