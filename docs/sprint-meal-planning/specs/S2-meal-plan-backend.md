# S2 — Meal-plan backend (schema, repo, service, routes)

## Background
Meal Planning stores recipe assignments per `date × meal`. No table exists. Per `DESIGN.md`: one flat table,
many recipes per slot, absolute `DATE`, cascade on recipe- and user-delete.

## Objective
Add the `meal_slot` enum + `meal_plan_entries` table (migration), a repository/service, and three routes:
`GET /v1/meal-plan?start&end`, `POST /v1/meal-plan`, `DELETE /v1/meal-plan/:id`.

## Acceptance criteria
- **AC1** Given `POST /v1/meal-plan {date,meal,recipe_id}`, then `201` with the entry + its recipe card
  `{id,title,image_url}`; `position` = current max in that slot + 1.
- **AC2** Given `GET /v1/meal-plan?start=D1&end=D2`, then all the caller's entries with `D1<=date<=D2`, each
  with its recipe card; other users' entries never appear.
- **AC3** Given `DELETE /v1/meal-plan/:id` for the caller's entry, then `204`; a second delete or another
  user's id → `404`.
- **AC4** Given a recipe is deleted (`DELETE /v1/recipes/:id`), then every `meal_plan_entries` row for it is
  gone (FK `ON DELETE CASCADE`).
- **AC5** Given `POST` with an unknown `recipe_id`, then `404 RECIPE_NOT_FOUND`.
- **AC6** Given missing/invalid `start`/`end` or a range > 31 days, then `400 INVALID_RANGE`.
- **AC7** Given no bearer token on any route, then `401`.

## Test cases (integration — `tests/integration/meal-plan.test.ts`, offline)
- **T1 (AC1,AC2)** persist a recipe; POST breakfast + lunch same day → 201 each, positions 0; GET the week →
  both entries with cards.
- **T2 (AC1 position)** POST two recipes to the same slot → positions 0 then 1.
- **T3 (AC3)** POST then DELETE → 204; DELETE again → 404; DELETE as another user → 404.
- **T4 (AC4 cascade)** POST an entry; DELETE the recipe; GET the week → empty.
- **T5 (AC5)** POST unknown recipe_id → 404.
- **T6 (AC6)** GET without start/end, bad dates, and a 40-day range → 400.

## Files
- `server/src/db/schema/enums.ts` — add `mealSlotEnum` (`breakfast·lunch·dinner·snack`).
- `server/src/db/schema/meal-plan-entries.ts` — new table (FKs cascade on `users.id` and `recipes.id`);
  index `(user_id, date)`. Export from `schema/index.ts`.
- `server/drizzle/0009_*.sql` — generated migration (enum + table). Self-contained.
- `server/src/models/meal-plan.ts` — `MealPlanEntrySchema`, `MealSlot`, `PublicMealPlanEntry` + projector.
- `server/src/repositories/meal-plan-repository.ts` — `listRange`, `add`, `remove` (classes + `static create()`).
- `server/src/services/meal-plan-service.ts` — wraps repo + `RecipeRepository.exists` for AC5.
- `server/src/api/app.ts` — three routes.
- `server/src/api/schemas.ts` — `createMealPlanEntrySchema`, `mealPlanRangeQuerySchema`.
- `server/src/api/errors.ts` — reuse `NotFoundError`; add `InvalidRangeError` (400).

## Notes / decisions
- No library-membership check on add (recipes are shared-readable; UI only offers library recipes); FK + an
  existence check give 404 on unknown id (DESIGN decision).
- Migration adds enum `meal_slot` + table `meal_plan_entries`; number 0009 may be renumbered by the coordinator.
