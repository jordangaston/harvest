# Cleanup Sprint — Report

**PR:** https://github.com/jordangaston/harvest/pull/15 (`jordangaston/cleanup-sprint` → `main`)

Wave-1 **Cleanup**. Built the founder-approved Revision-2 design (`DESIGN.md`) across all seven sub-stories,
run as a `/autonomous-sprint` (Phase 0/1 → 4→8). Backend is complete with the **whole suite green (100
tests)**; mobile changes are typecheck-clean and code-verified.

## Story → status → proof

| Story | Status | Proof |
|---|---|---|
| **C1** hide Discover | ✅ Done | `href: null` on the discover `<Tabs.Screen>` (`app/(app)/_layout.tsx:56`); screen file kept. **Sim proof:** `demos/sim-03-c1-tabs-no-discover.png` — tab bar shows only Recipes · Meal Plan · Groceries. |
| **C2** onboarding → enum columns + POST | ✅ Done | Migrations 0007/0008 (enum types + `enum[]`/`enum` columns, `onboarding_completed_at`, jsonb dropped); typed `createUserSchema`; mobile `lib/onboarding.ts` accumulator (label→enum map) wired across `app/(onboarding)/`; Cleanup owns the signup POST at the **end** of onboarding (`setting-up.tsx` → `ensureSession`; startup no longer provisions eagerly — see POSTMORTEM D8). **Sim proof (end-to-end):** walked onboarding on the sim (`demos/sim-02-c2-goals.png`) → the exact selections persisted as enum columns in the DB (`demos/c2-sim-end-to-end-db.txt`). Also `demos/c2-backend-live.txt` (live server), `phone-auth.test.ts`, `user-service.test.ts`, `scaffold.test.ts`. |
| **C3** structured ingredients | ✅ Done | `parse/ingredient.ts` (minimal deterministic parser); `toExtractedData` adapter at the JSON-LD promotion sites; extractor returns `StructuredIngredient[]`; `stripSectionLabels` filters by `.quantityText`; repo insert + PATCH-edit persist `amount/unit/quantity_text`. No migration. Proof: `ingredient.test.ts`, `parse-persist.test.ts`, `recipe.test.ts` (edit re-parses), `demos/backend-c3-c5-c5a.txt`. |
| **C4** servings estimate | ✅ Done | `recipes.servings_estimated` (0008); flat `servings=4` estimate at `toRecipeInput` when yield absent; surfaced on `PublicRecipe`. Proof: `import.test.ts` (imported stub → `servings=4, servingsEstimated=true`). |
| **C5** nutrition | ✅ Done | 8 label-core columns + `nutrition_source` enum (0008), string-nullable Zod; parsed path in `mapRecipe`; `NutritionService.compute` with **coverage floor ≥ 0.6**; unmatched → 0 + logged, never fabricated. Proof: `nutrition-service.test.ts`, `website-nutrition.test.ts`, `import.test.ts` (below-floor → null), `demos/backend-c3-c5-c5a.txt` (real computed + parsed). |
| **C5a** food catalog | ✅ Done | In-memory `FoodCatalog` (`static create()` loads committed `server/seed/foods.json`, 45 foods) — **no DB tables, no pg_trgm, no 0009**. Matcher = normalize+stop-list → exact/alias → head-noun/token-subset → **Dice bigram ≥ 0.8** (swappable `FoodMatcher`); `toGrams` weight/portion/water-like-fallback. `build-foods-seed.ts` documents the USDA SR Legacy rebuild. Proof: `food-catalog.test.ts` (incl. `"cream"` ≠ `"ice cream"`), `scaffold.test.ts` (no `foods` table / no `pg_trgm`). |
| **C6** ownership | ✅ Done | `recipes.user_id` + index (0006); **dropped `saved_recipes` + copy-on-write** (clone/repoint/countSavers/isSavedBy/saveForUser gone); `updateContent` edits in place; `deleteOwned`/`findOwner`/`listOwned`; owner-only edit/delete → **404** for non-owner; `cookbook_recipes` is the save mechanism. Proof: `recipe.test.ts` (in-place edit, non-owner→404, delete cascades), `scaffold.test.ts`. |

## Migrations (Drizzle, generate→migrate; destructive OK, no backfill)
- **0006** C6 — `recipes.user_id` (NOT NULL fk) + `recipes_user_idx`; drop `saved_recipes`.
- **0007** C2 — create the 7 onboarding enum types (+ `nutrition_source`); add the `users` enum/`enum[]` columns + `onboarding_completed_at`.
- **0008** C4+C5 — `recipes.servings_estimated` + 8 nutrient columns + `nutrition_source` column; drop `users.onboarding`.
No `0009` (catalog is in-memory). The 0007/0008 split (enum adds, then jsonb drop) keeps both `drizzle-kit generate` runs non-interactive — see POSTMORTEM D1.

## Tests
Whole server suite green: **100 passed (25 files)**, offline (no network; providers stubbed under `NODE_ENV=test`). New guardrail units: `ingredient`, `food-catalog`, `nutrition-service`, `website-nutrition`. Evidence: `demos/full-suite-green.txt`, `demos/backend-integration-per-story.txt`.

## What went well
- The pre-mortem produced an exact, dependency-ordered blocker list that matched reality; implementation followed it top-down with no surprises.
- Splitting the schema staging so `drizzle-kit generate` never hit its interactive rename resolver kept migrations clean and reviewable.
- Delegating the specs, the curated `foods.json`, and the mobile wiring to subagents kept the lead context focused on the tightly-coupled backend core.

## What to improve / follow-ups
- ~~**OpenAPI `publicRecipe` schema** doesn't yet include the new nutrition/`servings_estimated` fields~~ — **Done** (follow-up): added `servings_estimated` + an optional `nutrition` object (source enum + the 8 string macros) to `server/src/openapi/document.ts`; regenerated `openapi.json` + `postman_collection.json`. Shape matches the `toPublicRecipe` wire output (nested, nulls omitted).
- **Matcher accuracy** is the residual risk: generic-name → USDA is lossy even with the curated seed; the coverage floor + `nutrition.unmatched_ingredient` logs keep it honest but expect alias/threshold tuning once real recipes flow. `foods.json` macros are USDA-sourced and hand-curated — rebuild from the SR Legacy bulk CSV via `build-foods-seed.ts` when the CSV is available.
- **`GET /v1/recipes`** (owned list) is intentionally not exposed; `listOwned` exists for when a screen needs it (Wave-2 Profile/Meal Planning).

## Feature-agnostic lesson
Added to `docs/harvest-principles.md`: *"Stage destructive-plus-additive schema changes across separate migrations so codegen stays non-interactive."*
