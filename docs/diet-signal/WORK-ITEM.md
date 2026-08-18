# WI-DS-1 — Diet-compatibility signal (`dietStep`)

## Background

Ranking needs a per-recipe diet-compatibility signal: which diets each recipe fits and
which it rules out (vegan, vegetarian, pescatarian, dairy-free, keto, low-carb, …). The
full rationale, research, and decisions live in [`DESIGN.md`](./DESIGN.md); this ticket
is the build.

The pipeline already gives us everything needed, all LLM-free: `FoodMatcher` matches an
ingredient name to an FDC food + WWEIA category via deterministic trigram search over the
seeded SQLite catalog, and the per-serving carbohydrate/fiber macros yield net carbs. The
`AllergenDetector` (`server/src/allergen/`) is the pattern to mirror — same ingredient
loop, same "unmatched ⇒ undetermined, never absent" fail-safe.

**Definitions.** *Exclusion diet* — decided by a blocklist over ingredient food-classes
(vegan, vegetarian, pescatarian, dairy-free, carnivore). *Macro diet* — decided by a
per-serving macro threshold (keto = net carbs ≤ ceiling; low-carb = carb share of
calories). *Verdict* — `compatible | incompatible | unknown` per diet. *Coverage* — the
fraction of ingredients that matched; below the bar, exclusion verdicts fail safe to
`unknown`.

## Objective

Add an **isolated, best-effort** `dietStep` to the import workflow that classifies each
recipe against a config-driven diet list and writes one `recipe_diets` row per diet. The
step depends only on the raw recipe (D-00): it runs its own FDC-match and net-carb pass
and consumes no other step's output.

## Acceptance Criteria

1. **Schema** — A new `recipe_diets` table exists (`recipe_id`, `diet_id`, `verdict`,
   `blocker_kind`, `blocker_value`, `blocker_class`), composite PK `(recipe_id, diet_id)`,
   index on `(diet_id, verdict)`, `recipe_id` FK cascade — created by a Drizzle migration.
2. **Config** — Diets are a `DietRule[]` code constant. Each rule = `{ id, blockedClasses,
   blockedIngredients?, macro? }`. Launch set: vegan, vegetarian, pescatarian, dairy_free,
   red_meat_free, carnivore, keto, low_carb. Adding a rule needs no classifier change.
3. **Food-class map** — `toFoodClass(fdcCategory)` maps a WWEIA category to a diet
   `FoodClass` (meat, poultry, seafood, dairy, egg, grain, legume, vegetable, fruit, …),
   covering dairy/milk/butter/fats that `toPrimaryIngredient` collapses to null.
4. **Exclusion verdicts** — Given a recipe, when any ingredient's food-class ∈ a diet's
   `blockedClasses`, or an ingredient name hits `blockedIngredients`, then that diet's
   verdict is `incompatible` with the blocker recorded. When coverage is adequate and no
   blocker is found, `compatible`. When coverage is inadequate (unmatched/low-quality
   ingredients over the bar), `unknown`.
5. **Macro verdicts** — Given per-serving net carbs (= carbohydrate − fiber, from
   published macros if present else the step's own aggregation), when ≤ the keto ceiling
   then keto `compatible`, else `incompatible`; likewise low_carb by its rule. When macros
   or servings are missing, `unknown` (never `incompatible`).
6. **Isolation** — `DietClassifier.classify` takes only the recipe's own fields
   (ingredients, servings, source-published nutrition) and reads no `estimate`,
   `allergens`, or `categories`. Unit-testable from a recipe alone.
7. **Persist** — `dietStep` attaches the result to `ExtractedRecipeData`; `persistAndReady`
   writes `recipe_diets` rows in the existing transaction, replay-safe
   (`onConflictDoNothing`). A classifier failure persists no rows and does not fail the
   import.
8. **Public read** — The persisted verdicts surface on the recipe read
   (`PublicRecipe.diets`), snake_case, blocker included for `incompatible`.
9. **Tests pass** — New unit + integration tests pass, and the full existing suite still
   passes.

## Test Cases

### Test Case 1: Exclusion blocklist by food-class (bacon salad)
**Preconditions:** Offline FDC stub seeded (as in `nutrition-matching.test.ts`); a recipe
with ingredients `["bacon", "romaine lettuce", "olive oil"]`, servings 2.
**Steps:** `DietClassifier.create(db).classify(ingredients, 2)`.
**Expected Outcomes:** `vegan`, `vegetarian`, `red_meat_free`, `carnivore`→ n/a plant
block; `vegan`/`vegetarian` = `incompatible`, blocker `{kind:'ingredient', value:'bacon',
class:'meat'}`. `pescatarian` = `incompatible` (contains meat). No throw.

### Test Case 2: Hidden animal ingredient (anchovy Caesar)
**Preconditions:** Recipe with `["romaine", "parmesan", "worcestershire sauce"]`.
**Steps:** classify.
**Expected Outcomes:** `vegetarian` = `incompatible` with blocker naming the
worcestershire/anchovy entry from `blockedIngredients`, even though no whole-meat
ingredient is present. `dairy_free` = `incompatible` (parmesan → dairy).

### Test Case 3: Keto by net carbs
**Preconditions:** A recipe whose per-serving net carbs (carbs − fiber) computes ≤ the
keto ceiling; a second whose net carbs are well above it.
**Steps:** classify both.
**Expected Outcomes:** First → keto `compatible`; second → keto `incompatible`. A recipe
with no macros and no servings → keto `unknown`.

### Test Case 4: Coverage fail-safe (unmatched ingredients)
**Preconditions:** A recipe where two of three ingredients do not match the FDC stub.
**Steps:** classify.
**Expected Outcomes:** Exclusion diets read `unknown` (coverage below bar), never
`compatible`. No throw.

### Test Case 5: Workflow integration + persistence
**Preconditions:** Integration harness (local migrated DB) importing a known recipe.
**Steps:** Run the import workflow; read the recipe back.
**Expected Outcomes:** `recipe_diets` rows exist for the recipe; a re-run (replay) does
not duplicate them; `PublicRecipe.diets` reflects them. A forced classifier failure yields
zero rows and a successful import.

## Test Run

Implemented 2026-08-17. Commands from `server/`:

- `npm run db:generate` → `drizzle/0006_marvelous_kate_bishop.sql` (creates `recipe_diets` +
  `recipe_diets_lookup_idx`).
- `npm run typecheck` → clean (`tsc --noEmit`, exit 0).
- `npx vitest run` → **34 files, 223 passed / 1 skipped**, then 224 passing with the new
  suites. New coverage:
  - `test/diet-classifier.test.ts` (6 tests) — TC1 exclusion by food-class (bacon → vegan/
    vegetarian/pescatarian incompatible, cheese → dairy_free; plant-only → carnivore
    incompatible, vegan/vegetarian compatible); TC2 hidden worcestershire → vegetarian
    incompatible (class `hidden`); TC3 keto compatible/incompatible/unknown by net carbs;
    TC4 coverage fail-safe (unmatched → `unknown`, blocker still definitive); withheld → null.
  - `test/recipe.test.ts` — persist diet verdicts + blocker and surface them on the recipe
    read (`recipe.diets`); existing public-shape test updated for the new `diets: []` field.

All green. Implementation: `src/diet/{diet,food-class-map,diet-rules,diet-classifier}.ts`,
`recipe_diets` in `src/schema.ts`, `dietStep` in `src/workflows/import-workflow.ts`,
persistence in `src/repositories/recipe-repository.ts`, wiring in `src/parse/mapping.ts` +
`src/parse/extractor.ts`, public projection in `src/models/recipe.ts`.

## Deployment Strategy

Direct deploy. One backwards-compatible migration (new table; old code ignores it). No
feature flag: the step is best-effort and its output is inert until ranking reads it (out
of scope). No backfill — unsignalled recipes read *undetermined*; a later one-off recompute
fills history if wanted.

## Production Verification

### Production Verification 1: Signal emitted on real imports
**Preconditions:** Deployed; a test account.
**Steps:** Import 3–5 recipes of known composition (a clearly-vegan bowl, a bacon dish, a
low-carb steak). Inspect `recipe_diets` and the recipe read.
**Expected Outcomes:** Verdicts match expectation; blockers name the right ingredient; the
`diet job=…` log line shows `complete=` coverage and per-diet verdicts.

## Production Verification Run

_To be filled during execution._
