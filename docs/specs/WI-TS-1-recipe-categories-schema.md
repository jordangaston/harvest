# WI-TS-1 — `recipe_categories` schema + persistence plumbing

## Background

The ranking engine needs a per-recipe taste signal: the dish/cuisine/primary-ingredient facets a
later user-preference match ranks on. The design (`docs/design-recipe-categorization-signal.md`,
Direction B) stores these in a normalized, queryable child table so ranking can ask "which recipes
are `primary_ingredient=seafood`?" — a filter across rows an index serves. This work item builds the
**storage and persistence plumbing only**: the table, the migration, and the read/write path. It does
**not** derive any facet values (that is WI-TS-2) or run the categorizer in the pipeline (WI-TS-3).

System context (grounded in `server/`):
- Recipes persist through one chokepoint: `persistAndReady` (`server/src/import-persist.ts`) opens a
  transaction and calls `RecipeRepository.persist(toRecipeInput(data, input), userId, tx)`.
- `RecipeRepository.persistWith` (`server/src/repositories/recipe-repository.ts`) writes the recipe
  row, then `insertIngredients` and `insertSteps` on the same `tx`.
- `findById` reads the recipe plus its ingredient and step child rows into a `RecipeDetail`.
- The schema is SQLite/libSQL via `drizzle-orm/sqlite-core` (`server/src/schema.ts`). Composite-PK
  child tables already exist: `importJobRecipes`, `fdcFoodNutrient` — the pattern to follow.
- Migrations are generated, never hand-applied: `drizzle-kit generate` → `drizzle-kit migrate`.

## Objective

Add a `recipe_categories` table (composite PK `(recipe_id, facet, value)`, FK cascade to `recipes`,
index on `(facet, value)`), extend `RecipeInput` with an optional `categories` field, persist those
rows inside the existing import transaction, read them back in `findById`, and surface them on the
`GET /v1/recipes/:id` response as a `categories` object. When no categories are supplied, the recipe
persists exactly as today with no category rows and empty facet arrays in the response.

## Acceptance Criteria

1. **Schema.** Given the Drizzle schema, when migrations run, then a `recipe_categories` table exists
   with columns `recipe_id` (text, not null, FK → `recipes.id` on delete cascade), `facet` (text enum
   `'cuisine' | 'dish_type' | 'primary_ingredient'`, not null), `value` (text, not null); a composite
   primary key `(recipe_id, facet, value)`; and a non-unique index `recipe_categories_value_idx` on
   `(facet, value)`. The table is registered in the exported `schema` object.
2. **Input type.** Given `RecipeInput`, when a caller builds it, then it accepts an optional
   `categories?: RecipeCategories` where
   `RecipeCategories = { cuisine: string[]; dishType: string[]; primaryIngredient: string[] }`.
   Omitting it is valid and behaves as "no categories".
3. **Persist.** Given a `RecipeInput` with `categories`, when `persistWith` runs, then one
   `recipe_categories` row is written per (facet, value) on the same transaction as the recipe, via a
   new `insertCategories(tx, recipeId, categories)`. Writes use `onConflictDoNothing` so a workflow
   replay re-persisting the same recipe produces no duplicate rows and no error.
4. **Empty/absent categories.** Given a `RecipeInput` with `categories` omitted or with all-empty
   facet arrays, when `persistWith` runs, then zero `recipe_categories` rows are written and the
   recipe persists unchanged.
5. **Read.** Given a persisted recipe, when `findById` runs, then the returned `RecipeDetail` includes
   `categories: { cuisine: string[], dish_type: string[], primary_ingredient: string[] }`, each array
   holding that facet's values (empty when none). Rows are bucketed by facet at the repository
   boundary.
6. **API.** Given `GET /v1/recipes/:id` for an existing recipe, when the response is built, then the
   `recipe` object contains a `categories` object with the three facet arrays (snake_case keys), always
   present, arrays possibly empty. No new endpoint is added.
7. **Reverse lookup works.** Given persisted category rows, when a query filters
   `recipe_categories WHERE facet = ? AND value = ?`, then it returns the matching `recipe_id`s using
   `recipe_categories_value_idx` (proves the table serves ranking's access pattern).

## Test Cases

### Test Case 1: Migration creates the table and index (AC1)

**Preconditions:** Clean local libSQL test db; schema updated.
**Steps:** Run `drizzle-kit generate`; run the migration via `tests/helpers/global-setup.ts`; inspect
the resulting schema (`PRAGMA table_info(recipe_categories)`, `PRAGMA index_list`).
**Expected Outcomes:** Table exists with the three columns and types; composite PK on
`(recipe_id, facet, value)`; index `recipe_categories_value_idx` on `(facet, value)`; FK to `recipes`
with `ON DELETE CASCADE`.

### Test Case 2: Persist + read round-trip (AC2, AC3, AC5)

**Preconditions:** A user row exists; migrated test db.
**Steps:** Build a `RecipeInput` with
`categories = { cuisine: ['italian'], dishType: ['pasta'], primaryIngredient: ['seafood'] }`; call
`RecipeRepository.persist(input, userId)`; call `findById(recipeId)`.
**Expected Outcomes:** Three rows in `recipe_categories`. `findById` returns
`categories.cuisine = ['italian']`, `categories.dish_type = ['pasta']`,
`categories.primary_ingredient = ['seafood']`.

### Test Case 3: Absent and empty categories persist zero rows (AC4)

**Preconditions:** Migrated test db.
**Steps:** Persist one `RecipeInput` with `categories` omitted and one with all-empty arrays; read
both via `findById`.
**Expected Outcomes:** No `recipe_categories` rows for either recipe; both `findById` responses carry
`categories` with three empty arrays; the recipe rows are otherwise identical to pre-change behavior.

### Test Case 4: Replay writes no duplicates (AC3)

**Preconditions:** Migrated test db.
**Steps:** Persist the same `RecipeInput` (same recipe id) twice within the transaction pattern
`persistAndReady` uses (application-generated id).
**Expected Outcomes:** The second persist adds no new `recipe_categories` rows and raises no unique-
constraint error (`onConflictDoNothing`).

### Test Case 5: Cascade delete (AC1)

**Preconditions:** A recipe with category rows.
**Steps:** Delete the recipe via `RecipeRepository.deleteOwned`.
**Expected Outcomes:** Its `recipe_categories` rows are gone (cascade).

### Test Case 6: Reverse (facet, value) lookup (AC7)

**Preconditions:** Two recipes, one tagged `primary_ingredient=seafood`, one not.
**Steps:** Query `recipe_categories WHERE facet='primary_ingredient' AND value='seafood'`.
**Expected Outcomes:** Only the seafood recipe's id is returned.

### Test Case 7: API response shape (AC6)

**Preconditions:** Integration test harness; a persisted recipe with categories.
**Steps:** `GET /v1/recipes/:id`.
**Expected Outcomes:** `200`; `body.recipe.categories = { cuisine: [...], dish_type: [...], primary_ingredient: [...] }`; keys always present.

## Test Run

_To be determined during execution._

## Deployment Strategy

Single additive deploy. One migration creates a new table — no change to `recipes`. Old code ignores
it; the migration is backwards-compatible and runs before the code deploys with no coordination. No
data migration (categories apply to newly-imported recipes going forward). Rollback: the table is
inert without a writer and `findById` tolerates zero rows (empty arrays); drop the table after a code
rollback if required.

## Production Verification

### Production Verification 1: New table present, reads safe

**Preconditions:** Deployed to production; migration applied.
**Steps:** Confirm `recipe_categories` exists; `GET /v1/recipes/:id` for an existing (pre-migration)
recipe.
**Expected Outcomes:** Endpoint returns `200` with `categories` = three empty arrays for recipes that
predate categorization; no errors in logs.

## Production Verification Run

_To be determined during execution._
