# S1 — Server: `DELETE /v1/users/me` (full account deletion)

**Goal:** a bearer-authenticated endpoint that permanently deletes the caller and every row they own,
in one transaction, in FK-safe order. Implements DESIGN F-03 (server half).

## Files
- `server/src/repositories/user-repository.ts` — add `deleteAccount(userId)`.
- `server/src/services/user-service.ts` — add `deleteAccount(userId)` (thin pass-through).
- `server/src/api/app.ts` — add `DELETE /v1/users/me` route (authGuard, 204).
- `server/tests/integration/user-delete.test.ts` — new.

## Behaviour
`deleteAccount(userId)` runs one `db.transaction`, deleting in this order:
1. `import_jobs` where `user_id` (carries `recipe_id` FK).
2. `meal_plan_entries` — **defensive**, `to_regclass`-guarded (absent on this branch); before recipes.
3. `grocery_items` — **defensive**, `to_regclass`-guarded; before recipes.
4. `recipes` where `user_id` (cascades ingredients, recipe_steps, cookbook_recipes, import_job_recipes).
5. `cookbooks` where `user_id` (cascades cookbook_recipes).
6. `users` where `id`.

Route: `DELETE /v1/users/me` → `users.deleteAccount(request.authUserId!)` → `reply.code(204).send()`.
No ownership check needed — the caller can only name themselves (token subject).

## Acceptance criteria → tests
| AC | Test |
|---|---|
| Authed delete returns 204 and removes the user | integration: mint bearer, seed recipe+cookbook+import_job, DELETE /v1/users/me → 204; assert user, recipes, cookbooks, import_jobs rows for that user all gone |
| Children cascade | same test asserts ingredients/recipe_steps/cookbook_recipes rows gone |
| No token → 401, nothing deleted | integration: DELETE with no auth → 401; a seeded user still present |
| Defensive sibling-table deletes fire when the tables exist | integration: `CREATE TABLE meal_plan_entries(user_id uuid)` + `grocery_items(user_id uuid)`, seed a row for the user, deleteAccount, assert both emptied, then drop the temp tables |
| deleteAccount succeeds when sibling tables are absent | covered implicitly by the happy-path test (guards no-op) |

## Notes
- Table name in the guarded delete is a hardcoded source literal (not user input); only `userId` is bound.
- Tests never hit the network; run against the isolated local Postgres.
