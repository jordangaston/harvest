---
type: spec-tasks
description: Task checklist for splitting dish_type into course + form.
parent_spec: split-course-facet/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [split-course-facet spec](./spec.md).

## Tasks

- [ ] Add the `course` allow-list to `VOCAB` and remove `main_course` / `side_dish` / `appetizer` / `dessert` from `dishType`; extend `Facet` + `SETS` (`server/src/categorize/vocab.ts`).
- [ ] Add `'course'` to the `recipeCategories.facet` enum and generate the Drizzle migration (`server/src/schema.ts`).
- [ ] Add `course: string[]` to `RecipeCategories` (`server/src/models/recipe.ts`).
- [ ] Route the four role values to `course` in `server/src/categorize/recipe-categorizer.ts` (and `taste-classifier.ts` if it emits facets).
- [ ] Simplify `isStandaloneMeal` to read `categories.course`; delete `NON_MEAL_DISH_TYPES` (`server/src/ranking/course.ts`).
- [ ] Add `course` to `RankableRecipe.categories`; fix readers in `scorers.ts` and `facet-taste-profile-service.ts`.
- [ ] Data migration: move existing `dish_type` role rows to `course`.
- [ ] Grep `server/src` for `main_course|side_dish|appetizer|dessert` used against `dishType` and fix stragglers.
- [ ] Write the unit + integration tests from the spec's test plan; full suite green.

## Done when

- `course` is a first-class facet on read and write; `dishType` holds only forms.
- `NON_MEAL_DISH_TYPES` is deleted and `isStandaloneMeal` reads `course`.
- Existing recipes' role tags read as `course`; the full suite is green.

## Out of scope

- Recommender / embedding changes (the parent proposals).
- Any change to `cuisine`, `mealType`, or `primaryIngredient`.
- Re-classifying recipes from source content.