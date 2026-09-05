# WI-03 — Heartbeat lifecycle: create, resume, pause, backfill

## Background

WI-01 sweeps `dynamic_cron_jobs`; WI-02 makes the beat useful. This work item wires row
lifecycle to the objective stack so heartbeats exist exactly when they can matter: a
thread beats while it has an active objective and goes silent when the stack empties.
Lifecycle lands at the chokepoints that already flip objective status
(`src/chef/objective-repository.ts`) — no new decision points
(`server/docs/heartbeat/DESIGN.md`, § O-02).

## Objective

Heartbeat rows are upserted/resumed when an objective becomes active, paused when a
thread's stack empties, and backfilled once for existing threads with an active
objective.

## Acceptance Criteria

1. Given a thread gains an active objective (initial creation of an objective stack,
   or `completeAndPop` activating a successor), when the write commits, then a
   `thread_heartbeat` row exists for the thread with `is_paused = 0`,
   `cron_expression = '*/5 * * * *'` [ASSUMPTION: plain 5-minute default; quiet-hours
   expression deferred per DESIGN.md Q-02], and `next_run_at = nextRun(expression, now)`
   — created if absent, resumed (unpaused, `next_run_at` recomputed) if present. An
   existing row's custom `cron_expression` is preserved on resume.
2. Given `completeAndPop` finds no successor (the stack emptied), when the completion
   commits, then the thread's heartbeat row has `is_paused = 1`.
3. Given a one-off script `scripts/backfill-heartbeats.ts`, when run against a DB with
   threads that already have an active objective, then each such thread gets a
   heartbeat row per AC-1, threads without an active objective get none, and re-running
   the script changes nothing (idempotent).

## Test Cases

Run vitest files individually and `pkill -f vitest` between runs (libSQL file locks).

### Test Case 1: activation creates or resumes the row (AC-1)

**Preconditions:** `file:` libSQL test DB, migrated.

**Steps:** (a) Create a thread and push its first objective; inspect
`dynamic_cron_jobs`. (b) Pause the row manually, set a custom expression
`*/10 * * * *`, complete the objective with a suspended successor on the stack;
inspect again.

**Expected Outcomes:** (a) One row: `thread_heartbeat`, owner = thread, unpaused,
default expression, `next_run_at` in the future. (b) Row resumed (`is_paused = 0`),
custom `*/10` expression preserved, `next_run_at` recomputed; still exactly one row
(unique index holds).

### Test Case 2: empty stack pauses the row (AC-2)

**Preconditions:** TC-1(a) state — one active objective, live heartbeat row.

**Steps:** Complete the only objective (no successor).

**Expected Outcomes:** `is_paused = 1`; `objectives.status = 'complete'` committed in
the same flow.

### Test Case 3: backfill is correct and idempotent (AC-3)

**Preconditions:** Test DB seeded with: thread A (active objective, no row), thread B
(no active objective), thread C (active objective, row already present and paused —
edge: pre-existing row).

**Steps:** Run the backfill script twice.

**Expected Outcomes:** After run 1: A has a fresh unpaused row; B has none; C's row is
resumed. Run 2 changes no rows (compare `updated_at`/values).

## Test Run

Lifecycle + backfill cover the three test cases as new tests in
`test/increment2-repositories.test.ts` (`describe('heartbeat lifecycle (O-02)')`), run
against a `file:` libSQL DB migrated from the generated DDL.

```
$ pkill -f vitest; ulimit -n 30000; npx vitest run test/increment2-repositories.test.ts

 ✓ test/increment2-repositories.test.ts (17 tests) 764ms
   ✓ heartbeat lifecycle (O-02) > activation creates the row, then resume unpauses and preserves a custom cron (TC-1, AC-1)
   ✓ heartbeat lifecycle (O-02) > emptying the stack pauses the row (TC-2, AC-2)
   ✓ heartbeat lifecycle (O-02) > backfill covers active-objective threads and is idempotent (TC-3, AC-3)

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

Full suite from clean (canonical command):

```
$ pkill -f vitest; ulimit -n 30000; npm test

 Test Files  83 passed (83)
      Tests  622 passed | 1 skipped (623)
   Duration  10.25s
```

## Deployment Strategy

Deploy after WI-01 (needs the table; the repository API). Code deploy first, then run
the backfill script once against production (`scripts/`, same pattern as existing
one-off scripts). Rollback: pause all rows (`UPDATE dynamic_cron_jobs SET
is_paused = 1`) or plain code rollback — rows without lifecycle hooks are inert.

## Production Verification

### Production Verification 1: backfill covers live threads

**Preconditions:** WI-01–03 deployed; backfill run.

**Steps:** `SELECT count(*) FROM dynamic_cron_jobs WHERE is_paused = 0` vs. count of
threads with an active objective.

**Expected Outcomes:** Counts match; sweep logs show `due` rising accordingly at the
next ticks.

### Production Verification 2: completion silences the thread

**Preconditions:** A test thread mid-objective with a live heartbeat.

**Steps:** Drive the objective to completion (empty stack) from the test device; watch
the row and the sweep logs.

**Expected Outcomes:** Row flips to paused within the completing turn; no further
doorbells for the thread in sweep logs.

## Production Verification Run

To be filled after deploy.
