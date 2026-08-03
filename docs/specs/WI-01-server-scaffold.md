# WI-01: Server scaffold — Fastify + Neon/Drizzle + DBOS bootstrap

## Background

Harvest today is a front-end-only Expo prototype: recipes are hardcoded, "import" is a faked timeout,
saved recipes live in an in-memory store, and there is no backend or auth. The design (`docs/core-design.md`,
`docs/core-use-cases.md`) adds a backend in a **`server/`** package inside this repo with its **own**
`package.json`. Everything downstream (phone auth, recipe import, the parse pipeline) depends on a working
scaffold: a Fastify app, a single Neon Postgres datasource via Drizzle, the domain schema, and an in-process
DBOS runtime that shares that same Postgres.

Key decisions this ticket implements (see the design's Decisions section):
- **One process for now:** Fastify + DBOS run in the same Node process.
- **No DI container:** dependencies are wired by hand in a composition root (`server/src/container.ts`).
- **Single datasource:** Neon serverless Postgres via Drizzle `pgTable`; DBOS keeps its system schema on the
  same Neon instance (created by `DBOS.launch()` / `initializeDBOSSchema()`), so there is no second datastore.
- **`import_jobs` writes are DBOS transactions** (atomic with the workflow checkpoint) — the scaffold must
  wire the DBOS datasource so later tickets can use it.

Reference implementation for layering (controller → service → repository, Zod parse at the repo boundary,
ECDSA/JWT auth): `~/workspace/phonetastic/phonetastic-server` — but note it uses tsyringe (we do **not**),
`pgTable` on its own Postgres (we use Neon), and Fly.io (we use Railway).

[ASSUMPTION: local development and CI use a disposable local Postgres (Docker `postgres:16` or Testcontainers);
Neon is the staging/prod datasource. This keeps tests offline and free.]

**APIs that change often — read current docs before coding, do not rely on memory:** DBOS Transact TS
(`docs.dbos.dev/typescript`), Drizzle Postgres + drizzle-kit (`orm.drizzle.team`), Fastify v5, Neon serverless
driver (`neon.tech/docs`), Vitest projects/workspace config.

## Objective

Stand up the `server/` package: a Fastify HTTP server and an in-process DBOS runtime sharing one Neon
Postgres via Drizzle, with the five domain tables migrated, a composition root wiring dependencies, a
`/healthz` endpoint that proves DB + DBOS are live, and a Vitest setup (unit + integration projects). No
business endpoints yet — this is the foundation WI-02+ build on.

## Acceptance Criteria

1. **Package isolation.** Given the repo, when I inspect `server/`, then it has its own `package.json`,
   `tsconfig.json`, and lockfile independent of the Expo app; the Expo app build never imports from `server/`.
2. **Boot.** Given valid `DATABASE_URL` and `DBOS_SYSTEM_DATABASE_URL` env vars, when I run `npm run start`
   in `server/`, then the process applies/verifies migrations are present, calls `DBOS.launch()`, and Fastify
   listens on `PORT` — logging one line each for "db connected", "dbos launched", "listening".
3. **Schema.** Given a fresh Postgres, when I run `npm run migrate`, then tables `users`, `recipes`,
   `ingredients`, `steps`, `import_jobs` exist with the columns, types, PKs, FKs, uniqueness, and indexes
   specified in `docs/core-design.md#tables` (uuid PKs `gen_random_uuid()`, `timestamptz` timestamps, `jsonb`
   onboarding, `numeric` amounts, `pgEnum` for `source_type` and job `status`, unique `users.phone`, indexes
   `recipes_user_idx`, `import_jobs_user_idx`).
4. **DBOS shares the datasource.** Given the app booted, when DBOS initializes, then its system schema is
   created on the **same** Postgres instance as the domain tables (no second database/connection string beyond
   the DBOS system DB URL pointing at the same server), and a trivial registered DBOS workflow can be started
   and complete.
5. **Transactional datasource wired.** Given the composition root, when a caller runs a
   `dataSource.runTransaction()` that writes a row and the surrounding DBOS workflow checkpoints, then both
   commit atomically (proven by the O-08 pattern later; here: a smoke transaction that inserts and reads back).
6. **Composition root, no DI container.** Given `server/src/container.ts`, when I read it, then it constructs
   the Drizzle client, repositories, and services with plain constructor calls (no `tsyringe`/decorators), and
   exposes a typed `buildContainer(overrides?)` used by both `index.ts` and tests.
7. **Health endpoint.** Given the server is running, when I `GET /healthz`, then it returns `200` with
   `{ status: "ok", db: "ok", dbos: "ok" }`, and returns `503` with the failing component when the DB is
   unreachable.
8. **Vitest projects.** Given `server/`, when I run `npm test`, then Vitest runs the `unit` project (no DB);
   when I run `npm run test:integration`, then it runs the `integration` project against an ephemeral Postgres
   with migrations applied. Coverage is available via `npm run test -- --coverage`.
9. **Config validation.** Given a missing/invalid required env var, when the process starts, then it exits
   non-zero with a clear message naming the missing var (Zod-validated `env.ts`), rather than failing later.

## Test Cases

### Test Case 1: Migrations create the exact schema (AC-3)
**Preconditions:** Empty local Postgres reachable via `DATABASE_URL`.
**Steps:** Run `npm run migrate`. Introspect: `\d users`, `\d recipes`, `\d ingredients`, `\d steps`,
`\d import_jobs`; list indexes and enums.
**Expected Outcomes:** All five tables exist; `users.phone` is `unique not null`; PKs are `uuid` default
`gen_random_uuid()`; `import_jobs.status` and `recipes.source_type` are `pgEnum`s with the design's values;
FKs present with cascade on `ingredients.recipe_id`/`steps.recipe_id`; indexes `recipes_user_idx` and
`import_jobs_user_idx` exist. Re-running `migrate` is a no-op (idempotent).

### Test Case 2: Boot + health (AC-2, AC-4, AC-7)
**Preconditions:** Migrated Postgres; valid env.
**Steps:** `npm run start`; wait for "listening"; `curl localhost:$PORT/healthz`.
**Expected Outcomes:** Logs show db connected → dbos launched → listening. `/healthz` → `200`
`{status:"ok",db:"ok",dbos:"ok"}`. DBOS system tables (`dbos` schema) are present in the same database.

### Test Case 3: DBOS workflow + transactional write round-trip (AC-4, AC-5)
**Preconditions:** Booted app (or integration harness).
**Steps:** Start a registered smoke workflow `pingWorkflow()` that runs one `DBOS.runStep` returning "pong"
and one `dataSource.runTransaction` inserting a throwaway row into a temp/`import_jobs` test row, then reads
it back. Await the handle.
**Expected Outcomes:** Workflow completes; step returns "pong"; the inserted row is readable; re-running the
same workflow id resumes from checkpoint without duplicating the insert.

### Test Case 4: Health degrades when DB is down (AC-7)
**Preconditions:** App running; then stop Postgres (or point to a bad URL in a child process).
**Steps:** `GET /healthz`.
**Expected Outcomes:** `503` with `{status:"error", db:"error", ...}`; process does not crash.

### Test Case 5: Config validation fails fast (AC-9)
**Preconditions:** Unset `DATABASE_URL`.
**Steps:** `npm run start`.
**Expected Outcomes:** Non-zero exit within ~1s; stderr names `DATABASE_URL` as missing; no partial listen.

### Test Case 6: Vitest projects run (AC-8)
**Preconditions:** Deps installed; Docker/Postgres available for integration.
**Steps:** `npm test` (unit), then `npm run test:integration`.
**Expected Outcomes:** Unit project passes with no DB connection attempted. Integration project provisions an
ephemeral Postgres, migrates, runs Test Cases 1–4 as automated specs, and passes. `--coverage` emits a report.

### Test Case 7: Package isolation (AC-1, AC-6)
**Preconditions:** Repo checked out.
**Steps:** Inspect `server/package.json`; grep `server/src` for `tsyringe`/`@injectable`; build the Expo app.
**Expected Outcomes:** `server/` has its own manifest + lockfile; zero `tsyringe`/decorator usage; the Expo
app builds without resolving anything under `server/`.

## Test Run

_To be determined (filled in during execution)._

## Deployment Strategy

Backend-only, no user-facing surface yet → **direct deploy to a Railway staging service** rooted at `server/`
(`start` boots Fastify + `DBOS.launch()`). Provision a **Neon** project and set `DATABASE_URL` +
`DBOS_SYSTEM_DATABASE_URL` (same Neon instance; separate logical DB/schema for DBOS) and `PORT`. Migrations
run via `npm run migrate` as a pre-deploy/release step (additive, safe before code). No production traffic,
no feature flag needed. Rollback = redeploy the previous image; schema is additive so no down-migration.
**Q-08 gate:** during this ticket, confirm DBOS runs through Neon's connection (pooled vs direct/PgBouncer)
and set Neon autosuspend deliberately; record the finding on Q-08.

## Production Verification

### Production Verification 1: Staging health
**Preconditions:** Deployed to Railway staging against Neon.
**Steps:** `curl https://<staging>/healthz`.
**Expected Outcomes:** `200 {status:"ok",db:"ok",dbos:"ok"}`. Neon shows the domain tables + a `dbos` system
schema. Railway logs show a clean boot.

### Production Verification 2: DBOS durability across restart
**Preconditions:** Staging up.
**Steps:** Start the `pingWorkflow` via a temporary admin route (or a one-off script), restart the Railway
service mid-workflow, observe recovery.
**Expected Outcomes:** The workflow resumes and completes exactly once (no duplicate transactional insert),
demonstrating DBOS checkpoint recovery against Neon.

## Production Verification Run

_To be determined (filled in during execution)._
