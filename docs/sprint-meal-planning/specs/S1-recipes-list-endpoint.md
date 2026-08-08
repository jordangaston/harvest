# S1 — `GET /v1/recipes` (library list)

## Background
The add-recipe sheet needs the caller's whole library. Today only `GET /v1/recipes/:id` exists;
`RecipeRepository.listOwned` returns owned rows without pagination or cookbook entries. Meal Planning **owns**
this shared endpoint; Onboarding and Grocery consume it (`WAVE2-DECISIONS.md` #1).

## Objective
Expose a cursor-paginated `GET /v1/recipes` returning the caller's library = recipes they own ∪ recipes in any
of their cookbooks, deduped by id, newest first, with an opt-in `expand` for `ingredient_names` and
`cookbook_ids`.

## Acceptance criteria
- **AC1** Given a user who owns recipes A,B and has C (owned by another user) filed in their cookbook, when
  `GET /v1/recipes`, then the body lists A,B,C once each, newest-first, no duplicates.
- **AC2** Given a recipe owned **and** also in the caller's cookbook, when listed, then it appears exactly once.
- **AC3** Given >`page_size` recipes, when listing, then the response carries a `page_token`; following it
  returns the next page with no overlap and no gap; the final page's token is `null`.
- **AC4** Given `expand=ingredient_names,cookbook_ids`, when listed, then each card includes its ingredient
  names (ordered) and the ids of the caller's cookbooks holding it; without `expand`, neither field is present.
- **AC5** Given no bearer token, when `GET /v1/recipes`, then `401`.
- **AC6** Given another user's cookbook holds recipe C, when that other user lists, then C's `cookbook_ids`
  reflects only *their* cookbooks (membership is caller-scoped).

## Test cases (integration — `tests/integration/recipes-list.test.ts`, offline)
- **T1 (AC1,AC2)** mint user, persist A,B; mint other, persist C, file C into user's cookbook via PUT; GET →
  ids [A,B,C] deduped, order by `created_at desc`.
- **T2 (AC3)** persist `page_size+1` recipes; GET with `page_size=2` → 2 cards + token; follow token → rest,
  no overlap; last token null.
- **T3 (AC4)** persist A with 2 ingredients, file into a cookbook; GET `?expand=ingredient_names,cookbook_ids`
  → card has `ingredient_names` + `cookbook_ids=[cb]`; GET without expand → fields absent.
- **T4 (AC5)** GET without auth → 401.

## Files
- `server/src/repositories/recipe-repository.ts` — add `listCards(userId, {limit, cursor, expand})`.
- `server/src/services/recipe-service.ts` — add `listCards(...)` (parse + project to public cards, page token).
- `server/src/models/recipe.ts` — `PublicRecipeCard` shape + `toPublicRecipeCard`.
- `server/src/api/app.ts` — `GET /v1/recipes` route (authGuard, parse query).
- `server/src/api/schemas.ts` — `listRecipesQuerySchema` (`page_token?`, `page_size?`, `expand?`).
- `server/tests/integration/recipes-list.test.ts` — new.

## Notes / decisions
- Cursor = base64 of `{createdAt, id}`; keyset `WHERE (created_at,id) < (cursor)` over the deduped set. Union
  owned + cookbook-joined recipes in one query (`UNION`), then order/keyset in SQL.
- `[ASSUMPTION]` default `page_size` 50, max 200 (per DESIGN); the mobile sheet pages to the end.
