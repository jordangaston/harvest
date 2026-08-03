# Harvest server — conventions

Backend coding standards for `server/`. Distilled from review feedback (see `../docs/postmortem.md`)
and `~/workspace/trimbox/trimbox-server` + `~/workspace/phonetastic/phonetastic-server`.

> **The bar: another engineer reads our code and thinks "wow — that's it?". They should be UNDERWHELMED.**
> If it feels clever, heavy, or impressive, delete until it's boring. Boring is the goal.

## Before writing code
- Read `/quality-software-manifesto` and `/ponytail:ponytail`. Understand the change, then take the
  laziest rung that works. **Don't build infrastructure before something uses it.** **Don't add runtime
  self-checks for failures that dev/test/pre-launch catch for free.**

## Architecture
- **No DI container, no decorators.** Wire dependencies by hand.
- **Singletons for shared resources.** The database is created once and exported: `import { db, pool }
  from './db'`. Import it directly; don't thread it through function params or a "container".
- **Classes over free functions.** Repositories, services, providers are classes. Give them a
  **`static create()`** factory that wires their singleton dependencies:
  ```ts
  export class UserRepository {
    constructor(private readonly db: Database) {}
    static create() { return new UserRepository(db); }
    async findByPhone(phone: string): Promise<User | null> { ... }
  }
  ```
- Introduce infra in the ticket that first *uses* it (e.g. DBOS lands with the first workflow, not the scaffold).

## Domain models (Zod)
- Each domain entity is a **Zod schema** (`UserSchema`, `RecipeSchema`, …) — the domain model, distinct
  from the Drizzle table.
- **Repositories `parse` rows into the domain model at the boundary:** `return UserSchema.parse(row)`.
  Parse, don't just cast `$inferSelect` — validate the shape where DB meets domain.

## Drizzle
- **Migrations only.** Never apply DDL directly. `drizzle-kit generate` → `drizzle-kit migrate`.
- **Transactions for multi-table writes:** wrap in `db.transaction()` and pass `tx` to each repo method.
- **Joins + an `expand` param for related data** (`db.query.*.findMany({ with: {...} })`). No N+1 loops.

## HTTP APIs
- **All list endpoints are cursor-paginated.** The token is `page_token` everywhere — query param,
  response field, and variable names.

## Style
- **Methods small (~≤10 lines) and readable.** Readability is the priority.
- **TSDoc public methods:** preconditions, params, return, boundary conditions.
- **Comments only for genuinely non-obvious code.** No JSDoc that restates the code.

## Testing (Vitest)
- Repository/service public methods: unit tests. Controller routes: integration tests.
- **As few tests as cover all paths — no more.** Don't test the obvious (a try/catch, a Zod parse).
- Integration tests run against a local Postgres migrated by `tests/helpers/global-setup.ts`.
