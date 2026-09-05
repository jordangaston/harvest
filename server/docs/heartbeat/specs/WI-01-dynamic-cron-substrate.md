# WI-01 — Dynamic cron substrate: table, sweeper, dispatch

## Background

Chef turns only run when an inbound iMessage rings the doorbell, so a stalled objective
never re-engages the household. The design (`server/docs/heartbeat/DESIGN.md`) adds a
per-thread heartbeat built on the kickback-server `dynamic_cron_jobs` pattern: one table
holds a cron expression and `next_run_at` per job; one static Vercel cron sweeps due
rows every minute, advances `next_run_at`, and enqueues each due `thread_heartbeat` as a
bare doorbell on the existing `inbound-messages` queue topic. The sweeper only wakes
threads — all follow-up decisions happen later in the consumer, under the thread lock
(WI-02).

This work item builds the substrate: the table, the repository, the sweep endpoint, and
the static cron. It ships inert — no rows exist until WI-03 creates them, and the
consumer treats a bare doorbell as a no-op until WI-02.

## Objective

A `dynamic_cron_jobs` table plus a `GET /crons/dispatch` endpoint (invoked by a Vercel
cron every minute) that advances due rows via `croner` and sends a `{threadId}` doorbell
to `inbound-messages` for each due `thread_heartbeat` row.

## Acceptance Criteria

1. Given the Drizzle schema, when `npm run db:generate && npm run db:migrate` runs, then
   a `dynamic_cron_jobs` table exists with columns `id` (uuid pk), `job_type`,
   `owner_type`, `owner_id`, `input` (json), `cron_expression`, `next_run_at`
   (timestamp), `is_paused` (bool, default false), `created_at`, `updated_at`; a unique
   index on `(owner_type, owner_id, job_type)`; and an index on
   `(is_paused, next_run_at)`.
2. Given rows that are due (`is_paused = 0`, `next_run_at <= now`), not yet due, and
   paused, when `GET /crons/dispatch` is called with `Authorization: Bearer
   $CRON_SECRET`, then only the due rows have `next_run_at` advanced to the next
   occurrence of their `cron_expression` (computed with `croner`) and exactly one
   doorbell `{threadId}` per due `thread_heartbeat` row is sent to `inbound-messages`
   with idempotency key `hb:<threadId>:<dueSlotISO>`, and the response is
   `200 {"dispatched": n}`.
3. Given a missing or wrong `Authorization` header, when `GET /crons/dispatch` is
   called, then the response is `401` and no rows change.
4. Given the sweep, when a row is advanced, then the advance is committed BEFORE the
   doorbell is enqueued (crash between the two loses one beat, never wedges a row).
5. Given `vercel.json`, when the project deploys, then it contains a `crons` entry
   `{"path": "/crons/dispatch", "schedule": "* * * * *"}`.
6. Given `package.json`, then `croner` is a direct dependency.

## Test Cases

Run vitest files individually and `pkill -f vitest` between runs (libSQL file locks —
see project memory).

### Test Case 1: nextRun wrapper computes the next occurrence

**Preconditions:** none (pure function).

**Steps:** Call `nextRun('*/5 * * * *', new Date('2026-09-05T10:02:00Z'))`.

**Expected Outcomes:** Returns `2026-09-05T10:05:00Z`. Add one case for an hour-bounded
expression (`*/5 8-21 * * *` at 22:00 → next day 08:00).

### Test Case 2: sweep advances due rows and dispatches doorbells

**Preconditions:** `file:` libSQL test DB, migrated. Seed three `thread_heartbeat`
rows: due, future (`next_run_at` tomorrow), paused-but-due. Mock queue client injected.

**Steps:** Invoke the sweep handler with a fixed `now`.

**Expected Outcomes:** Due row's `next_run_at` > `now` and matches
`nextRun(expression, now)`; future and paused rows untouched; exactly one queue send,
payload `{threadId}` of the due row, idempotency key `hb:<threadId>:<slot>`; handler
returns `dispatched: 1`.

### Test Case 3: unauthorized request rejected

**Preconditions:** Test DB with one due row; `CRON_SECRET` set in the test env.

**Steps:** HTTP `GET /crons/dispatch` with no auth header; again with a wrong bearer.

**Expected Outcomes:** Both return `401`; the due row's `next_run_at` is unchanged; no
queue sends.

## Test Run

Migration generated from the schema change (AC-1, AC-6):

```
$ npm run db:generate
...
tasks 13 columns 2 indexes 2 fks
...
[✓] Your SQL migration file ➜ drizzle/0041_old_timeslip.sql 🚀

$ cat drizzle/0041_old_timeslip.sql
CREATE TABLE `dynamic_cron_jobs` (
        `id` text PRIMARY KEY NOT NULL,
        `job_type` text NOT NULL,
        `owner_type` text NOT NULL,
        `owner_id` text NOT NULL,
        `input` text NOT NULL,
        `cron_expression` text DEFAULT '*/5 * * * *' NOT NULL,
        `next_run_at` integer NOT NULL,
        `is_paused` integer DEFAULT false NOT NULL,
        `created_at` integer NOT NULL,
        `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `dynamic_cron_jobs_owner_uidx` ON `dynamic_cron_jobs` (`owner_type`,`owner_id`,`job_type`);
CREATE INDEX `dynamic_cron_jobs_due_idx` ON `dynamic_cron_jobs` (`is_paused`,`next_run_at`);
ALTER TABLE `tasks` ADD `nudged_at` integer;
```

New-file tests — Test Cases 1–3 (`nextRun`, sweep advance/dispatch, 401 guard):

```
$ npx vitest run test/heartbeat-cron.test.ts
 ✓ test/heartbeat-cron.test.ts (5 tests) 148ms
   ✓ nextRun > computes the next occurrence of a plain expression
   ✓ nextRun > wraps to the next day for an hour-bounded expression past its window
   ✓ sweep > advances due rows, dispatches their doorbells, and leaves others untouched
   ✓ GET /crons/dispatch > rejects a missing or wrong bearer with 401 and no side effects
   ✓ GET /crons/dispatch > sweeps with a valid bearer

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Typecheck clean:

```
$ npx tsc --noEmit
(exit 0)
```

Full server suite (one clean run; the libSQL lock note applies — clear leaked
`harvest-libsql-*` temp dirs and `pkill -f vitest` before running):

```
$ npm test
 Test Files  82 passed (82)
      Tests  605 passed | 1 skipped (606)
   Duration  9.80s
```

## Deployment Strategy

Additive schema migration, safe before code. Set `CRON_SECRET` in Vercel env BEFORE the
deploy that adds the `crons` entry, or every tick 401s. Feature ships inert (no rows).
Rollback: code rollback is safe against the new table; to silence without a deploy,
`UPDATE dynamic_cron_jobs SET is_paused = 1`.

[ASSUMPTION: the Vercel project is on Pro, so every-minute crons are allowed
(DESIGN.md Q-03). If Hobby, change the schedule and revisit.]

## Production Verification

### Production Verification 1: cron ticks and sweeps

**Preconditions:** Deployed with `CRON_SECRET` set; no heartbeat rows yet.

**Steps:** Wait two minutes after deploy; check `vercel logs` for the sweep's structured
"sweep completed" log line.

**Expected Outcomes:** A sweep log per minute with `due: 0, dispatched: 0`; no errors.

### Production Verification 2: manual due row dispatches

**Preconditions:** PV-1 green. Insert one `thread_heartbeat` row for a test thread with
`next_run_at` in the past.

**Steps:** Wait one tick; check logs; check the row.

**Expected Outcomes:** `dispatched: 1` in the sweep log; the row's `next_run_at`
advanced; consumer log shows the doorbell handled (a no-op turn until WI-02). Delete the
test row afterward.

## Production Verification Run

To be filled after deploy.
