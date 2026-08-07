# Cleanup — Feature Lead Brief

You are the **Feature Lead** for the **Cleanup** task (Wave 1) of Harvest v1. You own it end to end
and work **in this worktree** (`/Users/jordangaston/orca/workspaces/harvest/cleanup`, branch
`jordangaston/cleanup`, based on `origin/main`). A coordinator supervises via Orca orchestration and
routes your work through an Architect review + founder sign-off at each gate.

## Right now you are at the DESIGN gate — design only
Produce `docs/sprint-cleanup/DESIGN.md`. **Do NOT write implementation code, run migrations, seed data,
or open a PR yet.** Stop when the design doc is written and report `worker_done`.

## Read first (binding — these OVERRIDE your defaults)
- `CLAUDE.md`, `AGENTS.md` — Harvest design system: golden-hour tokens; **no pure `bg-white`** (modals/sheets
  use `bg-cream`, rows/tiles use `bg-card`); Lora/Karla type; **Motion** conventions.
- `docs/harvest-principles.md` — verify-against-live-reality; fix at the single chokepoint; tiered fallback;
  **data transforms must never destroy good data**; underwhelm the reader.
- `docs/rn-nativewind-pitfalls.md`.
- `server/CLAUDE.md` — DBOS pipelines; Drizzle **migrations only**; Zod models parsed at the repo boundary;
  classes with `static create()`; **tests never hit the network**; shared ownership = canonical entity + join
  table; model states don't sprawl them; laziest rung that works.
- `lib/motion.ts`.

## Product context — read ALL eight v1 tasks to see how Cleanup relates
v1 = save recipes, weekly meal plans, one-click grocery ordering. Tasks: **1 Cleanup** (yours; every other
task depends on it), then Wave 2 in parallel (Onboarding Improvements, Meal Planning, Grocery Lists, Profile,
Instrumentation, Phone-based Auth), then Wave 3 (Serverless Spike). Your schema decisions underpin Wave 2 —
Meal Planning references recipes; Grocery Lists needs a canonical food/ingredient catalog with common-ingredient
defaults + aisle grouping and must scale a recipe's ingredients by serving size; Phone Auth creates the user at
the end of onboarding.

## Founder's resolved decisions (do not relitigate — design to these)
- **C1 · Hide Discover** — hide the Discover tab in `app/(app)/_layout.tsx` (e.g. `href: null`); keep the screen
  file for v2. Do NOT delete.
- **C2 · Onboarding → columns** — `users.onboarding` is a non-queryable `jsonb` blob POSTed at signup. Move to
  **typed columns on `users`** (multi-selects like goals/recipe-sources as Postgres `text[]`) + an
  `onboarding_completed_at` timestamp. No separate table, no per-step server progress (no user exists until
  signup). Enumerate the real fields by reading every screen under `app/(onboarding)/`.
- **C3 · Ingredient measurements separated** — the `ingredients` table already has `name`,`quantity_text`,
  `amount`,`unit`, but import stuffs the whole line into `name` and leaves amount/unit null. Populate them so
  recipes can be **scaled**. Adopt heb-bot's model: `name` = the ingredient itself; `amount` (numeric) + `unit`
  (lowercase singular: "teaspoon"/"cup"/"gram"/"count"); `quantity_text` = verbatim line for display. **Combine
  multiple amounts of one ingredient into the smallest unit in the same system** (volume→teaspoons, weight→grams)
  so it stays a single amount+unit. The rare genuinely cross-system line ("1 lb + 2 cups") that can't combine
  without density: store the dominant measurement, keep the verbatim line in `quantity_text`, log the decision.
  Implement by **extending the existing LLM extractor** to return structured `{name, amount, unit}` per ingredient
  (one network call, enforced at the single chokepoint `toRecipeInput`), not a second pass. Reference heb-bot at
  `~/workspace/heb-bot` — `src/normalizeIngredients.ts` (the `Ingredient`/`Measurement` shape + normalization
  prompt) and `src/pantry.ts`.
- **C4 · Serving sizes** — `recipes.servings` (integer) already exists and import already parses schema.org
  `recipeYield`. Add an **estimate** when the recipe omits it, plus a way to know it's an estimate
  (`servings_estimated` boolean or a source enum). Scaling = pure multiplication of the separated amounts; no
  food DB needed for scaling.
- **C5 · Nutrition** — new. Parse schema.org `NutritionInformation` when present. When absent, **compute
  per-serving macros from a static USDA FoodData Central (FDC) dataset** (founder's decision — NOT an LLM
  estimate). Store `nutrition_source` (`parsed`|`computed`). Macros = the four (calories, protein_g, carbs_g,
  fat_g) per serving; punt micronutrients.
- **C5a · Food catalog (shared infra)** — seed a subset of USDA FDC into our own tables so nutrition compute is
  **offline** (tests never hit the network). Same catalog is consumed by Wave-2 Grocery Lists (common-ingredient
  defaults, aisle grouping). Design the `foods` (+ `food_portions`) tables, the one-time seed/build step, the
  ingredient→food matcher, and unit→grams conversion. FDC facts: bulk CSV download at
  https://fdc.nal.usda.gov/download-datasets — **SR Legacy** is the best fit for generic cooking ingredients;
  nutrients per-100g (ids energy=1008/protein=1003/fat=1004/carbs=1005); `food_portion.csv` gives per-food
  portion→gram weights (handles cups→grams density). Use the bulk CSV for the seed, NOT the live API at import.
  Be conservative (data-transforms-never-destroy-good-data): an unmatched ingredient must NOT null the whole
  recipe's nutrition — decide partial-match behavior (e.g. nutrition null/partial, don't fabricate) and log it.
- **C6 · Recipe ownership; remove copy-on-write** — add `recipes.user_id` (= creator, has edit rights),
  **DELETE the copy-on-write clone path** (owner edits in place), and **drop the `saved_recipes` table**. The
  `cookbooks` + `cookbook_recipes` tables already exist — `cookbook_recipes` IS the CookbookEntry and becomes the
  save mechanism. Recipes-screen list = recipes where `user_id` = me. Saving another user's recipe in the future
  = a `cookbook_recipes` row pointing at a recipe you don't own (leave that door open, don't build it).

## Pre-launch assumption (founder confirmed): no real users/data yet
Destructive migrations are fine (drop `saved_recipes`, change `ingredients.name` semantics, add/rename columns).
**No backfill scripts.** Still: Drizzle migrations only (`drizzle-kit generate` → `migrate`), never hand-applied DDL.

## C6 impact map (already traced — verify against live code, don't re-trace from scratch)
Every `saved_recipes` / copy-on-write touch point:
- **Schema:** `server/src/db/schema/saved-recipes.ts` (table + `SavedRecipe`/`NewSavedRecipe` types);
  `server/src/db/schema/index.ts:4` re-export; `server/drizzle/0000_volatile_zarda.sql` (table + indexes
  `saved_recipes_user_recipe_uidx`, `saved_recipes_user_idx`).
- **`server/src/repositories/recipe-repository.ts`** — DELETE/rework: `saveForUser()` (~139), `isSavedBy()`
  (~148), `updateContent()` (~174, remove CoW), `removeForUser()` (~195), `countSavers()` (~212),
  `cloneRecipe()` (~218), `repointUser()` (~254); `persist()` (~76) calls `saveForUser()`.
- **`server/src/repositories/cookbook-repository.ts`** — `setMembership()` (~118) currently inserts into
  `savedRecipes`; remove that.
- **Services:** `recipe-service.ts` `update()` (~38, uses `isSavedBy`+`updateContent`), `remove()` (~50);
  `cookbook-service.ts` `setMembership()` (~69).
- **Routes:** `server/src/api/app.ts` — `PATCH /v1/recipes/:id` (~139), `DELETE /v1/recipes/:id` (~149),
  `PUT /v1/recipes/:id/cookbooks` (~158). HTTP contract can stay; internals change. New edit-authorization rule:
  owner (`recipes.user_id`) only.
- **Schemas/OpenAPI:** `server/src/api/schemas.ts` `updateRecipeSchema` (~39), `setMembershipSchema` (~35);
  `server/src/openapi/document.ts` (~13,187).
- **Mobile:** `lib/api/recipes.ts`, `lib/api/cookbooks.ts` (HTTP signatures unchanged); `components/recime/
  recipes.ts` in-memory `saveRecipe`/`isRecipeSaved`/`useSavedRecipes`; `CookbookPickerSheet.tsx`;
  screens `app/recipe/[id].tsx`, `app/(app)/recipes.tsx`, `app/cookbook/[id].tsx`, `app/preview.tsx`.
- **Tests to update:** `server/tests/integration/` — `recipe.test.ts`, `parse-persist.test.ts`, `cookbook.test.ts`,
  `user-repository.test.ts`, `phone-auth.test.ts`, `import.test.ts`, `scaffold.test.ts` (asserts `saved_recipes`
  table/index — update to new schema).

## Method
Reason-act-observe. Verify every claim against the live code before writing it into the design — the maps above
are hypotheses. Read the actual schema files under `server/src/db/schema/`, the import pipeline
(`server/src/pipeline/import-pipeline.ts`, `toRecipeInput`), `server/src/parse/extractor.ts`,
`server/src/repositories/recipe-repository.ts`, the onboarding screens, and `app/(app)/_layout.tsx`. Read
heb-bot's `src/normalizeIngredients.ts` + `src/pantry.ts`.

## Deliverable: `docs/sprint-cleanup/DESIGN.md`
Per sub-story: exact schema/migration changes (tables, columns, types, nullability, enums); the
API/service/repository/pipeline code paths that change (file paths + function names); mobile changes; and a
**test plan** (which unit/integration tests, offline). Include:
- A consolidated, ordered migration plan + new Drizzle enums.
- The full onboarding-field list (from the screens) → column mapping.
- The structured-ingredient extractor output shape + the smallest-unit normalization rule and its safety guard.
- The food-catalog table design, seed pipeline, matcher strategy (e.g. normalized-name + `pg_trgm` trigram),
  unit→grams conversion, and partial-match behavior.
- The ownership refactor impact list (above, verified) + the new edit-authorization rule.
- Decisions-you-made-and-logged, risks (call out C5/C5a as the largest piece), and open questions for the founder.
- Keep it concrete and lazy: smallest change that satisfies each story; underwhelm the reader; flag anything speculative.

**Authoring requirement (founder standing rule):** write `DESIGN.md` **using the `/writing-design-documents`
skill** (invoke via the Skill tool), and after writing, **edit it with the `/writing-clearly-and-concisely`
skill**. This applies to every design doc.

When done, report `worker_done` with: the design-doc path, a tight per-sub-story summary of key decisions, the
ordered migration plan, and your top risks/open questions. Do not proceed to implementation — the coordinator
routes your design through the Architect and founder for sign-off first.
