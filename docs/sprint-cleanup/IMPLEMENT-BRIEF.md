# Cleanup — Implementation Brief

The founder approved the Revision 2 design. **Build it.** Source of truth is
`docs/sprint-cleanup/DESIGN.md` (Revision 2) in this worktree — follow it exactly; don't relitigate settled
decisions. Binding docs still bind (design system / no `bg-white` / motion tokens; `docs/harvest-principles.md`;
`server/CLAUDE.md`: migrations-only, classes with `static create()`, Zod-at-boundary, one chokepoint, methods
≤~10 lines, **tests never hit the network**). Work only in this worktree.

## Step 0 — pin the matcher spec into DESIGN.md, then build
Before writing matcher code, add a short **"Matching"** subsection to `DESIGN.md` documenting the confirmed
approach (founder-approved — **lexical + alias table, NOT embeddings**):
1. Normalize both sides: lowercase, strip punctuation, drop a descriptor/prep **stop-list**
   (`fresh, chopped, minced, diced, sliced, raw, cooked, large, small, medium, finely, roughly, ground,
   to taste, for garnish, for serving, optional, room temperature, …`), singularize, collapse whitespace.
2. Exact hit on the food's canonical `name` or an `aliases` entry (aliases carry known synonyms:
   aubergine↔eggplant, cilantro↔coriander, garbanzo↔chickpea, heavy cream↔heavy whipping cream, …).
3. Head-noun / token-subset match (all of a food's canonical tokens appear in the ingredient; best overlap wins).
4. Bounded fuzzy fallback: **Sørensen–Dice on character bigrams**, best match only if **≥ 0.8**, else null.
5. No confident match → null + `nutrition.unmatched_ingredient` log. The ≥ 0.6 coverage floor then gates `computed`.
Include a unit-test table as the guardrail: exact hit, alias hit (eggplant), head-noun hit
(`extra virgin olive oil`→olive oil), plural (`tomatoes`→tomato), near-miss → null, and **`"cream"` must NOT
match `"ice cream"`** (nutrition-identity, not semantic neighborhood). Keep `matchFood` a swappable interface.

## Step 1 — get the worktree runnable
Install deps as needed (root app + `server/`) so you can run the server test suite and, later, the Expo app on
the booted iOS simulator. Check for a repo setup script first. Confirm the DB/test harness works
(`server` vitest against local Postgres via `tests/helpers/global-setup.ts`).

## Build — all seven sub-stories (per DESIGN.md)
- **C1** hide Discover — `href:null` on the discover `Tabs.Screen` in `app/(app)/_layout.tsx`; keep the file.
- **C2** onboarding → pg enums/enum[] (migration 0007), `createUserSchema` typed, drop `onboarding jsonb`,
  `onboarding_completed_at`; **mobile accumulator** `lib/onboarding.ts` (label→enum map) wired across the
  `app/(onboarding)/` screens; **Cleanup owns the `POST /v1/users` wiring** this sprint (send onboarding at
  signup against the current user-creation). No `bg-white`; honor motion tokens for any UI.
- **C3** structured ingredients — `parse/ingredient.ts` `parseIngredientLine` (minimal); the `toExtractedData`
  adapter at the 5 JSON-LD spread sites; extractor returns `StructuredIngredient[]`; `stripSectionLabels`
  filters by `.quantityText`; `insertIngredients`/`replaceIngredients` + the PATCH edit path persist
  `amount/unit/quantity_text`. No migration.
- **C4** servings — estimate `4` + `servings_estimated` when `recipeYield` absent (migration 0008).
- **C5** nutrition — parse schema.org `NutritionInformation` in `mapRecipe` (parsed path); else
  `NutritionService.compute` from the catalog; 8 label-core columns per serving, string-nullable Zod;
  coverage floor ≥ 0.6 gates `computed` (migration 0008).
- **C5a** food catalog — `FoodCatalog` singleton (`static create()`) loading committed `server/seed/foods.json`
  (**no DB tables, no `pg_trgm`, no migration 0009**). Provide `server/scripts/build-foods-seed.ts` (builds the
  curated JSON from the USDA SR Legacy bulk CSV) **and** a committed curated `foods.json` of common cooking
  staples with real per-100g label-core macros + portion→gram weights + aliases. If the SR Legacy bulk CSV
  isn't reachable in-sprint, hand-author the curated `foods.json` from USDA-sourced values and note provenance;
  a ~10-food subset is the test fixture. `toGrams`: portion-first; water-density for water-like liquids only;
  dry-goods volume w/o portion → unmatched.
- **C6** ownership — migration 0006: `recipes.user_id` (+ index), **drop `saved_recipes`** + copy-on-write
  (`cloneRecipe`/`repointUser`/`countSavers`/`isSavedBy`/`saveForUser`); `updateContent` edits in place;
  `removeForUser`→`deleteOwned`; add `findOwner`, `listOwned`; owner-only edit/delete → **404** for non-owner;
  `cookbook-repository.setMembership` drops the `savedRecipes` insert; update the stale comments.
  `PublicRecipe` gains `servings_estimated` + 8 macros + `nutrition_source`. `GET /v1/recipes` NOT exposed.

## Migrations
Drizzle only: `drizzle-kit generate` → `migrate`. Exactly **0006 (C6), 0007 (C2), 0008 (C4+C5)** — no 0009.
Destructive OK, no backfill.

## Tests (server/CLAUDE.md)
Offline only. Cover per the design's test plan (unit: `parseIngredientLine`, `FoodCatalog.matchFood`/`toGrams`,
`NutritionService`, `mapRecipe` parsed, enum onboarding round-trip; integration: `parse-persist`, ownership/404,
cascade delete, remove all `saved_recipes` references, `scaffold.test.ts` schema audit incl. "no foods table /
no pg_trgm"). A test you wrote is not done until it AND every other test pass.

## Autonomy
Decide-and-log any blocker (record the decision + rationale in the sprint report) and keep moving. Only
`orca orchestration ask` the coordinator for a genuinely founder-level call.

## DONE — all four must hold before `worker_done`
1. **All tests pass** (unit + integration; the whole suite green, not just yours).
2. **Demoed on the booted iOS simulator** (show the real behavior; capture evidence — e.g. screenshots/video
   per the transient-UI verification convention).
3. **PR opened against `main`** from `jordangaston/cleanup-sprint`.
4. **`docs/sprint-cleanup/SPRINT-REPORT.md` + `POSTMORTEM.md` written** (decisions logged; any feature-agnostic
   lesson added to `docs/harvest-principles.md` or `docs/rn-nativewind-pitfalls.md`).

Report `worker_done` only when all four hold, with the PR link, the test summary, the sim-demo evidence, and
the report/postmortem paths. If truly blocked, `escalation` (pre-completion) with the specifics.
