# Meal Planning — POSTMORTEM (decide-and-log)

Kept open from the start; every blocker and the decision taken.

## Environment (shared machine, six parallel sprints)

- **Disk hit ENOSPC twice.** Mid-sprint the shared volume filled (six `node_modules` + build caches), so
  even tool output couldn't be written. Freed space with `npm cache clean --force`. **Consequence:** the
  shared Postgres crashed **twice** on the disk-full events.
- **The 5432 Postgres (a v17.6 install) crashed and would not restart cleanly.** Its backends lingered as
  zombies serving other sprints' DBs, but the postmaster stopped accepting TCP. `postgresql@15` (also 5432)
  wouldn't come back either. The healthy server was **brew `postgresql@14` on 5433**.
  - **Decision:** run this sprint's isolated suite on **5433** (brew @14). Created role `postgres` +
    `harvest_test_mp` / `harvest_dbos_mp` there. This is *more* isolated than the shared 5432, at the cost of
    two **temporary** config edits, both **reverted before commit**:
    1. `server/vitest.config.ts` `test.env` → the 5433 isolated DB URLs.
    2. `server/tests/helpers/global-setup.ts` → derive the admin URL from `DATABASE_URL` (the hardcoded
       `LOCAL_ADMIN_URL` points at the dead 5432).
  - The PR diff keeps the default `harvest` on 5432 (a local parallelism workaround, not a product change).
- **Server + root deps were not installed** in the worktree; ran `npm install` in `server/` and root.

## Simulator (Phase 7 UI demo) — blocked, did not force it

- The sim-isolation addendum asked for a dedicated device + unique Metro port. But: the app is a **managed
  Expo workflow** (no `ios/`), **no dev-client / Harvest app is installed** on any simulator, and producing
  screenshots needs a full native `expo run:ios` build (GBs, minutes). The dev backend's DB (5432) is also
  down.
- **Decision:** do **not** run a heavy native build on a volatile disk that had already crashed the shared
  Postgres twice — that would jeopardize the other five sprints. Captured the UI demo as a **code-grounded
  walkthrough** (`demos/S3-S4-ui-walkthrough.md`) backed by the backend live demo + pure-logic checks +
  clean typecheck. Flagged for the coordinator to run the visual pass in a healthy environment. **This is
  the one DONE item not met as written (sim capture); everything else is complete and verified.**

## Pre-mortem findings folded in (Phase 5)

- **#1 no swipe pattern exists** → shipped a **tap remove affordance** (trailing `close-circle`) instead of a
  gesture lib. `ponytail:` ceiling — add swipe only if a gesture-handler is wired app-wide.
- **#2 migration missing** → generated `0009_eager_the_watchers.sql` (enum before table, both cascade FKs).
- **#4 cleanup order** → the new suites `db.delete(mealPlanEntries)` **first** (FK-safe).
- **#5 list dedup/keyset** → used a single `recipes` select with `OR EXISTS(cookbook membership)` (one row per
  recipe — no UNION split) + keyset on `(created_at, id)` with a base64 cursor.
- **#6/#14 dates local, not UTC** → `lib/week.ts` builds ISO from local parts; Zod `regex(YYYY-MM-DD)`;
  inclusive range; `filterCards` excludes null `total_minutes` when a bucket is active.
- **#7 position** → `COALESCE(MAX(position), -1) + 1` in a transaction (first = 0).
- **#8/#9 cache** → add/remove invalidate the `["mealPlan"]` **prefix** (handles add-from-recipe to any
  week); remove is optimistic with snapshot/rollback.
- **#10 common-ingredients 404** → `listCommonIngredients()` **catches** and returns the hard-coded fallback.
- **#11 reused sheets** → every sheet resets state on `visible`.
- **#12/#13 cross-task** → `GET /v1/recipes` base card is lean, expand fields omitted unless requested,
  `page_token` naming; "Add to groceries" is a hook-only no-op.

## Timeline of note
Backend built and green (99→100 tests) before the UI. Two PG crashes cost recovery cycles. Net: backend +
mobile complete, typecheck clean, backend demo captured; UI sim capture blocked by the shared environment.
