# Harvest server — conventions

Backend coding standards for `server/`. Distilled from review feedback (see `../docs/postmortem.md`)
and `~/workspace/trimbox/trimbox-server` + `~/workspace/phonetastic/phonetastic-server`.

## Before writing code
- Read `/quality-software-manifesto` and `/ponytail:ponytail`. Understand the change, then take the
  laziest rung that works. **Don't build infra before something uses it** (a fallback, a projection, a
  config, a pagination scheme). **Don't guard failures that dev/test/pre-launch catch for free.**
- **Underwhelm the reader** — they should think "that's it?". Delete until boring; ship the shortest diff.

## Architecture
- **No DI container.** Hand-wire dependencies; don't thread them through params or a "container".
  (Decorators are used *only* for DBOS class-syntax workflows/steps — see Pipelines.)
- **Singletons for shared resources.** The database is created once and exported (`import { db, pool }
  from './db'`); import it directly.
- **Classes over free functions** — repositories, services, providers are classes with a **`static
  create()`** factory that wires their singletons: `static create() { return new UserRepository(db); }`.
- **Model the domain; one job per function.** Don't conflate concepts (a `source` is an enum, not a
  URL-plus-enum grab-bag). Hide a variant behind one interface — the caller shouldn't `if` on it.

## Domain models (Zod)
- Each entity is a **Zod schema** (`UserSchema`, `RecipeSchema`, …), distinct from the Drizzle table.
- **Repositories `parse` rows into the model at the boundary** (`return UserSchema.parse(row)`) — validate
  where DB meets domain; don't cast `$inferSelect`.
- **Model states, don't sprawl them:** one `failed` status + an `error_code`, not a status per outcome.
  Shared ownership is a canonical entity + a join table, never a denormalized owner column.

## Drizzle
- **Migrations only.** Never apply DDL directly. `drizzle-kit generate` → `drizzle-kit migrate`.
- **Transactions for multi-table writes:** wrap in `db.transaction()` and pass `tx` to each repo method.
- **Joins + an `expand` param for related data** — no N+1 loops.

## Pipelines (DBOS)
- **The workflow does status + exceptions, nothing else:** mark `running`, then `ready(recipeId)` /
  `failed(code)`. Status writes are `@appDataSource.transaction` so the row and checkpoint commit together.
- **The work is a separate concern, decomposed into one `@DBOS.step` per network call**, so a late failure
  re-runs only the failed stage. All non-deterministic code lives in a step; the workflow only awaits
  steps/transactions.
- **Unit-test the workflow by mocking its steps.** Never test DBOS's own guarantees (recovery).

## HTTP APIs
- **List endpoints are cursor-paginated;** the token is `page_token` everywhere (query param, response
  field, variable names).

## Style
- **Methods small (~≤10 lines) and readable.** Readability is the priority.
- **TSDoc public methods:** preconditions, params, return, boundary conditions.
- **Comments only for genuinely non-obvious code** — never longer than the code they explain.

## Testing (Vitest)
- Repository/service public methods: unit tests. Controller routes: integration tests. **As few as cover
  all paths.** Don't test the obvious (a try/catch, a Zod parse), a third-party guarantee, or a stub
  returning its own constant.
- **Tests never hit the network** — select the offline stubs.
- Integration tests run against a local Postgres migrated by `tests/helpers/global-setup.ts`.
