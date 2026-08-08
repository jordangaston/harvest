# Cleanup DESIGN.md — Revision 2 (fold in founder decisions + Architect review)

Still **DESIGN ONLY** — update `docs/sprint-cleanup/DESIGN.md` in place; no implementation. Keep the doc
coherent (re-run `/writing-design-documents` structure where sections change; edit with
`/writing-clearly-and-concisely`). Update the Reviews table (Architect = approve-with-changes, incorporated;
Founder = decisions provided) and add a Revision-2 changelog row. The Architect's full review is at
`docs/sprint-cleanup/ARCHITECT-REVIEW.md` — read it; fold in every must-fix and should-fix below.

## Founder's final decisions — make the design match these exactly

1. **Nutrition = Nutrition-Facts label core, per serving** (not just 4 macros). Recipe columns, using the
   founder's explicit naming:
   `calories`, `grams_of_fat`, `grams_of_saturated_fat`, `grams_of_carbohydrate`, `grams_of_fiber`,
   `grams_of_sugar`, `grams_of_protein`, `milligrams_of_sodium`, plus `nutrition_source` enum
   (`parsed` | `computed`; null = unknown). Model the numeric columns as **string-nullable** in Zod to match
   the existing `numeric` convention (`RecipeSchema.confidence`, `PublicRecipe.amount` are string) — Architect S3.

2. **Onboarding stored as ENUMS, not free text** (reverses Revision-1's text/text[] choice — founder's call).
   Each field is a pg enum; multi-selects are `enum[]`. Display copy maps to a stable snake_case enum value
   (`"Eat healthier"` → `eat_healthier`), so re-wording a label needs no migration; only add/remove of an
   option does. Define the enums + the label→value mapping from the screens. Multi: `goals[]`,
   `recipe_sources[]`, `cook_days[]` (weekday enum). Single: `when_cook`, `cook_time`, `how_heard`, `age`.
   Plus `onboarding_completed_at timestamptz`. The mobile accumulator (`lib/onboarding.ts`) holds the
   label→enum map and sends enum values. Cleanup **owns the `POST /v1/users` wiring this sprint** (columns +
   accumulator + send) against the current user-creation; Wave-2 Phone Auth swaps in the real phone later
   (resolves Architect S1 / the C2 seam).

3. **Food catalog is IN-MEMORY from a bundled file — NO DB tables, NO `pg_trgm`, NO migration 0009**
   (founder's call; the clincher: nutrition is computed at import and stored onto the recipe, so the catalog
   only serves the import path transiently — it never serves a read query, so it shouldn't be a table).
   - Commit `server/seed/foods.json` — a **curated cooking subset** (Q-05) of USDA SR Legacy: each food has a
     canonical `name`, an `aliases` list, the 8 label-core nutrients per 100 g, and portion→gram weights.
   - `FoodCatalog` class with `static create()` loads the file once (singleton, per conventions).
     `matchFood(name)` = exact canonical/alias → minimal in-process fuzzy over the small set → null.
     `toGrams(amount, unit, food)` = weight direct; volume via the food's portions; **water-density fallback
     for water-like liquids only**; dry-good volume with no portion → unmatched (Architect M4).
   - A small committed fixture subset is what tests load (offline by construction — no DB seed, no CSV download in CI).
   - Update the migration plan: **0006** C6, **0007** C2 (enum types + enum[]/enum columns, drop `onboarding`
     jsonb), **0008** C4+C5 (`nutrition_source` enum + `servings_estimated` + the 8 nutrient columns). **No 0009.**

4. **Q-01 coverage floor:** mark `nutrition_source='computed'` only when the matched fraction ≥ ~0.6 (by
   ingredient count); below it, leave nutrition null. **Q-02:** deterministic website parser only, kept minimal
   (ambiguous → `amount/unit` null, `quantityText` preserved; no unit-algebra — Architect S4). **Q-03:** build
   `RecipeRepository.listOwned` but do **not** expose `GET /v1/recipes` this sprint. **Q-04:** flat
   `servings=4` + `servings_estimated` flag; keep the `ponytail:` note.

## Architect must-fixes to bake into the design (from ARCHITECT-REVIEW.md)

- **M1** — parse ingredients at the `ExtractedRecipe → ExtractedRecipeData` adapter (the 5 JSON-LD spread
  sites in `import-pipeline.ts`), NOT at `toRecipeInput`. Name the adapter. Also: `stripSectionLabels` must
  operate on `.name` (or on raw lines before parsing); decide and state whether `ExtractedRecipe.ingredients`
  (`fetch/website.ts`) + `StubWebsiteFetcher.FIXTURE` stay `string[]` (adapter parses) or become structured
  (mapRecipe parses) — pick one.
- **M2** — `RecipeRepository.insertIngredients` and `replaceIngredients` must persist `amount`/`unit`/
  `quantity_text`, and the PATCH edit path must run `parseIngredientLine` on edited lines so editing doesn't
  strip scalability. State it.
- **M3** — the canonical-name + alias approach now lives in `foods.json` (curated), which is exactly what
  makes matching viable; document the matcher accordingly.
- **M4** — bounded density fallback (above).
- **M5** — the coverage floor (Q-01 above).
- **S2** — the C5 *parsed* path: add a nutrition field to `ExtractedRecipe`, map it in `mapRecipe`
  (`fetch/website.ts`), flow it through `ExtractedRecipeData → toRecipeInput`. Trace it in Modules/Entities.
- **N1** — non-owner edit/delete returns **404** (not 403); fix the test text.

## Also
- Add the existing `cookbooks` / `cookbook_recipes` model to the doc (columns as in `schema/cookbooks.ts` +
  `cookbook-recipes.ts`); note the only Cleanup change is dropping the `savedRecipes` insert in
  `cookbook-repository.setMembership` and correcting the stale "ownership lives in saved_recipes" comments.
- Note that C6's single-owner column is consistent with `server/CLAUDE.md` ("shared ownership = canonical
  entity + join"): a recipe has exactly one creator (column), while shared *saving* is the `cookbook_recipes`
  join — not a contradiction.
- Re-check the test plan against all the above (enum round-trips for C2; label-core parse+compute for C5;
  in-memory catalog matcher/toGrams unit tests; owner-404).

When done, report `worker_done` summarizing what changed vs Revision 1. Do not implement — the coordinator
refreshes the founder's artifact and gets a final go first.
