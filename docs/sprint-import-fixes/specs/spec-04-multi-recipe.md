# Spec 04 — Multi-recipe imports surface every recipe (swipeable carousel)

## Background
Slideshows yield multiple recipes. The backend **already** persists every slide
(`import_job_recipes`) and `GET /v1/imports/:id` returns `recipe_ids` (full ordered array) plus
`recipe_id` (primary). The app reads only `recipe_id`, so only the first recipe is shown. Pure
client fix. Repro: https://www.tiktok.com/t/ZTAsQP5Ah

Phase-2 decision: **swipeable preview carousel** — after import, show a horizontally swipeable stack
of the N recipe previews with a page indicator; Save files all kept recipes into a cookbook.

## Objective
When an import produces multiple recipes, the user reviews each in a swipeable preview and saves
them (all, or the ones kept) into a cookbook.

## Acceptance criteria
- AC1: The client `ImportJob` type includes `recipe_ids: string[]`; `runImport` returns all recipe
  ids (prefer `recipe_ids`, fall back to `[recipe_id]`).
- AC2: On a single-recipe import, behavior is unchanged (straight to the single preview).
- AC3: On a multi-recipe import, the preview screen shows a horizontally paged carousel of the N
  recipe previews (hero + title + ingredients per page) with a page indicator (e.g. "2 / 4").
- AC4: Each page can be removed/kept; "Save to cookbook" opens the cookbook picker once and files
  **all kept** recipes into the chosen cookbook(s) via `PUT /v1/recipes/:id/cookbooks` per recipe,
  then shows the success flow (spec 07) and returns home.
- AC5: Fetch each recipe via `GET /v1/recipes/:id`; a per-page fetch failure shows that page's
  error state without breaking the others. Design tokens throughout.

## Touches
- `lib/api/types.ts` (`recipe_ids`), `lib/api/imports.ts` (return all ids), `app/importing.tsx`
  (route to preview with the id list), `app/recipe/[id].tsx` OR a new `app/preview.tsx` carousel
  wrapper reusing the recipe preview rendering.
- `components/recime/CookbookPickerSheet.tsx` (accept multiple recipe ids to file).

## Test cases
1. Live: import the TikTok slideshow → the preview is a swipeable carousel of all recipes; save all
   → each appears in the chosen cookbook.
2. Live: import a single-recipe link → unchanged single preview + save.

## Verification
Client change; verify against the slideshow link on the running server.
