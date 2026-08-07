# Spec 05 — Remove the "Now you're cooking!" save modal

## Story
After saving, do NOT show the full-screen celebration/success modal. The user lands back on the home
Recipes screen and knows the recipe was saved.

**Decision (Phase 2):** replace with a brief toast on the Recipes screen ("Saved to <cookbook>").
This reverses the earlier sprint's success-image modal.

## Fix
- **`app/recipe/[id].tsx`** (single-recipe preview save): remove `SuccessCelebration`; on `onSaved`
  navigate `router.replace("/(app)/recipes?saved=<cookbookName>")`.
- **`app/preview.tsx`** (carousel): remove `SuccessCelebration` (spec 04 already replaces its flow
  with per-card inline "Saved to X"). The ✕ returns home.
- **`app/(app)/recipes.tsx`**: read a `saved` route param → show a small auto-dismissing toast
  (`Saved to <name>`), then clear the param. Toast is a dark pill (`bg-ink`, `text-cream`, success
  check) — a system-toast affordance, NOT a card; never `bg-white`.
- Delete `components/recime/SuccessCelebration.tsx` (no remaining references) and its unused image.

## Files
- `app/recipe/[id].tsx`, `app/preview.tsx`, `app/(app)/recipes.tsx`
- delete `components/recime/SuccessCelebration.tsx`, `assets/success-cooking.jpg`

## Tests
Client UI — verified live in the simulator.

## Acceptance / verify (live)
Import a single recipe → Save → NO "Now you're cooking!" modal appears; land on Recipes with a brief
"Saved to <cookbook>" toast that fades. `grep` shows no `SuccessCelebration` import anywhere. Record demo.
