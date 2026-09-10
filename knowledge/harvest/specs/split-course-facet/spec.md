---
type: spec
description: Split the overloaded dish_type facet into orthogonal course (meal role) and dish_type (form).
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: recommender-eval-harness
tags:
  - spec
  - categorization
  - data-model
---
One-line: give a recipe's **course** (its role in a meal) a dedicated facet so `dish_type` can hold only the dish's **form**.

## Goals

- Split the overloaded `dish_type` facet into two orthogonal facets: **`course`** (role in a meal) and **`dish_type`** (dish form). Each answers one question.
- After the split there are three orthogonal category axes: `mealType` (when) · `course` (role) · `dishType` (form). `mealType` was already split out for this reason (see the comment in `server/src/categorize/vocab.ts`); this finishes the job.
- Delete the hardcoded `NON_MEAL_DISH_TYPES` set in `server/src/ranking/course.ts` — `isStandaloneMeal` reads the `course` facet directly.
- **This spec is a blocker** for the [recommender eval harness](../../proposals/recommender-eval-harness.md) (its Tier 1 positive keys on cuisine + dish *form*, and it uses course as a filter) and for the "course is a filter, not a feature" claim in [embedding-recipe-similarity](../../proposals/embedding-recipe-similarity.md).

## Non-goals

- No change to `cuisine`, `mealType`, or `primaryIngredient`.
- No re-classification from source content — existing rows already carry the role words; this is a static partition + value move, not an LLM re-run.
- No recommender or embedding work — that lives in the parent proposals.

## Design

Today `dishType` (`server/src/categorize/vocab.ts`) holds both role and form in one list:

`main_course, side_dish, appetizer, salad, soup, stew, bread, pancake, pastry, pie, pizza, pasta, sandwich, burger, taco, bowl, casserole, curry, stir_fry, dessert, cookie, ice_cream, sauce, beverage, cocktail`

Partition it into two facets:

| Facet | Values |
|---|---|
| **`course`** (new) — role in a meal | `appetizer, main_course, side_dish, dessert` |
| **`dishType`** — dish form | `salad, soup, stew, bread, pancake, pastry, pie, pizza, pasta, sandwich, burger, taco, bowl, casserole, curry, stir_fry, cookie, ice_cream, sauce, beverage, cocktail` |

The axes then compose independently — apple pie = `course: dessert` + `dishType: pie` + `mealType: snack`.

**Touch points:**

- `server/src/categorize/vocab.ts` — add the `course` allow-list; drop the four role values from `dishType`; extend `Facet` and `SETS`.
- `server/src/schema.ts` — add `'course'` to the `recipeCategories.facet` enum (Drizzle migration).
- `server/src/models/recipe.ts` — `RecipeCategories` gains `course: string[]`.
- `server/src/categorize/recipe-categorizer.ts` — route the four role values to `course`, the rest to `dishType` (a fixed partition; check `taste-classifier.ts` too if it emits facets).
- `server/src/ranking/course.ts` — `isStandaloneMeal` reads `categories.course`; delete `NON_MEAL_DISH_TYPES`.
- `server/src/ranking/types.ts` — `RankableRecipe.categories` gains `course`; fix readers in `scorers.ts` and `facet-taste-profile-service.ts`.

## Migration

Existing `recipe_categories` rows already carry the role words, so no recompute:

1. Drizzle migration adds `'course'` to the facet enum.
2. One-shot data move: `UPDATE recipe_categories SET facet = 'course' WHERE facet = 'dish_type' AND value IN ('appetizer', 'main_course', 'side_dish', 'dessert')`.
3. Row count is preserved. A recipe tagged only `dessert` ends with a `course` and no `dishType` — acceptable (form unknown, not invented).

## Test plan

- **vocab** (unit): `course` members are in-vocab; `dishType` no longer contains any role value.
- **categorizer** (unit): a source yielding `[main_course, pasta]` produces `course = [main_course]`, `dishType = [pasta]`.
- **course.ts** (unit): a `main_course` recipe is standalone; a `dessert`/`side_dish`-only recipe is not; empty stays standalone (no over-filter on missing data).
- **migration** (integration): seed role rows under `dish_type`, run the migration, assert they read as `course` and counts match.
- **API** (integration): the recipe categories response includes `course`.
- Full suite green (repo testing rule: not done until the new tests pass and nothing else regresses).