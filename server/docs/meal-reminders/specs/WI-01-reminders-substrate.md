# WI-01 — Reminders substrate: schema, sweep dispatch, provisioning, fire arm

## Background

`server/docs/meal-reminders/DESIGN.md` (the contract — read it fully; §§ Tables, F-01,
F-02, Decisions) adds meal reminders on the heartbeat substrate: one RECURRING
`dynamic_cron_jobs` row per (thread, course) firing daily at household-local time; at
fire time the consumer reads TODAY's plan for that course — planned → Sage announces,
empty → silent. No coupling to plan mutations. This WI builds the substrate; the
timezone fact and recompute chokepoints are WI-02; the tools are WI-03 (until then,
`DEFAULT_TZ` env governs and reminder times are the provisioning defaults).

## Objective

Reminder rows exist per course after the first plan confirm (paused when the
household's weekly count for the course is 0), the sweep dispatches them, and the
consumer's reminder arm announces today's planned meal ahead of it — exactly once per
(thread, meal, local day).

## Acceptance Criteria

1. Given the migration, then `dynamic_cron_jobs` has a nullable `meal` text column and
   the owner unique index covers `(owner_type, owner_id, job_type, meal)` (per DESIGN
   § Tables; existing heartbeat rows have `meal` NULL and keep their uniqueness).
2. Given the sweep, when due rows include `meal_reminder` jobs, then they dispatch the
   same bare `{threadId}` doorbell as heartbeats (idempotency key from job id +
   due-slot) and their `next_run_at` advances by their cron in the household zone —
   the `jobType !== 'thread_heartbeat'` early-continue is replaced by dispatch that
   handles both types.
3. Given `first_meal_plan` completes (the `completeAndPop` chokepoint, gated on that
   definition, BEFORE the heartbeat pause), then breakfast/lunch/dinner rows are
   upserted with cron = (course anchor − lead) in the household zone (`DEFAULT_TZ`
   until WI-02) and `is_paused` derived from the household's weekly meal counts
   (count 0 ⇒ paused). Snack is NOT provisioned. Idempotent on re-run. Rows are NOT
   paused when the objective stack empties (reminders outlive the objective —
   DESIGN F-01).
4. Given a due `meal_reminder` doorbell and a planned meal today for that course, when
   the consumer handles it, then a reminder turn runs REGARDLESS of thread quiet (no
   quiet gate — DESIGN Decision), the chef gets the reminder intent (meal + today's
   recipes), and bubbles ride guid scope `reminder:<meal>:<local-date>`.
5. Given nothing planned today for the course, then the arm is a silent no-op and the
   row stays for tomorrow.
6. Given a redelivered doorbell or same-day re-fire, then no duplicate bubble (the
   sink's `alreadySent` guard on the per-day scope).
7. Given pending inbound at the doorbell, then the inbound turn runs first and the
   reminder rides a later loop iteration (DESIGN F-02 extension).

Anchor/lead defaults per DESIGN Q-02 resolution (dinner 18:00−90m, lunch 12:00−60m,
breakfast next-morning handling per the doc — follow whatever the doc's F-02/Q-04
resolution says; if the doc leaves breakfast open, ship dinner+lunch and leave the
breakfast row provisioned-but-paused, noting it in the spec's Test Run).

## Test Cases

Vitest, files individually, `pkill -f vitest` between runs; canonical suite =
`npm test`; stop the dev server before full-suite runs (fd contention).

### Test Case 1: migration + provisioning (AC-1, AC-3)

**Preconditions:** migrated `file:` libSQL DB; thread + household with weekly meals
{dinner: 5, lunch: 3, breakfast: 0}; active first_meal_plan objective.

**Steps:** Complete the objective (no successor). Inspect `dynamic_cron_jobs`. Re-run
provisioning.

**Expected Outcomes:** dinner + lunch rows live with correct local-time crons;
breakfast row present but paused; heartbeat row paused (existing stack-empty rule);
re-run changes nothing.

### Test Case 2: sweep dispatches both job types (AC-2)

**Preconditions:** due heartbeat row + due meal_reminder row + future reminder row;
mock queue.

**Steps:** Run the sweep handler.

**Expected Outcomes:** two doorbells sent; both due rows' `next_run_at` advanced;
future row untouched.

### Test Case 3: fire arm announces the planned meal (AC-4)

**Preconditions:** meal_reminder row due for dinner; a dinner entry planned today for
the thread owner; RECENT conversation activity (< 5m old message — proves no quiet
gate); stub chef/sender/lock.

**Steps:** Handle a bare doorbell.

**Expected Outcomes:** chef invoked with the reminder intent naming dinner + today's
recipes; outbound guid prefix `reminder:dinner:<today>`; heartbeat arm did NOT also
fire in the same turn.

### Test Case 4: silence when nothing planned (AC-5)

**Steps/Expected:** same setup, no dinner entry today → chef not invoked, nothing
sent, row remains.

### Test Case 5: same-day idempotency (AC-6)

**Steps/Expected:** after TC-3, handle the doorbell again same day → no new bubble,
no new outbound row.

### Test Case 6: pending inbound wins the iteration (AC-7)

**Steps/Expected:** due reminder + unprocessed inbound → normal turn runs against the
inbound first; the reminder fires on a subsequent iteration/doorbell, not lost.

## Test Run

Implemented and verified on `jordangaston/first-meal-plan` (2026-09-05).

**Scope.** Per this spec's Background, WI-01 is the substrate: schema, sweep dispatch, provisioning
(F-01), and the fire arm (F-02). The timezone fact + recompute (F-04) and the chef tools (F-03/F-06,
`set_reminder_time` / `set_reminder_enabled`) and `syncPause` (F-05) are WI-02/WI-03 and are NOT built
here. Until then `DEFAULT_TZ` (env, UTC fallback) governs and reminder times are the provisioning
defaults; the tz is carried on each reminder row's `input.tz` so the sweep advances in the household
zone with no join.

**Anchors/leads (DESIGN Q-02 proposal).** dinner 18:00 − 90m ⇒ cron `30 16 * * *`; lunch 12:00 − 90m
⇒ cron `30 10 * * *`. **Breakfast** ships provisioned-but-**paused** (its lead crosses midnight —
DESIGN Q-04 open; the "announce tomorrow's breakfast" rule is deferred). **Snack** is not provisioned
(DESIGN Q-06). So a household with counts {dinner>0, lunch>0} gets two live rows + a paused breakfast
row; snack has no row.

**Migration.** `drizzle/0042_black_zombie.sql` (generated by `npm run db:generate`): adds
`dynamic_cron_jobs.meal` (nullable), rebuilds the owner unique index to
`(owner_type, owner_id, job_type, meal)`, and adds `household_preferences.timezone`. Additive.

**One deviation worth noting (root-cause fix, not a symptom patch).** SQLite treats a NULL column in
a UNIQUE index as *distinct*, so `ON CONFLICT (owner_type, owner_id, job_type, meal)` can never match
an existing heartbeat row (its `meal` is NULL) — an `onConflictDoUpdate` would insert a duplicate
instead of resuming. `CronJobsRepository.upsertHeartbeat` was therefore switched from
`onConflictDoUpdate` to an explicit update-or-insert (safe: activation runs under the per-thread lock,
which the code already relied on). The reminder upsert keeps `onConflictDoUpdate` — its `meal` is
non-null, so the index dedupes normally. This fixed two `increment2-repositories` lifecycle tests that
the index change had broken.

**Automated tests** — `test/meal-reminders.test.ts` (12 tests, all green), covering:
- cron math: dinner `30 16 * * *`, lunch `30 10 * * *`; `nextRun` reads the expression in the
  household zone (16:30 America/New_York = 20:30Z).
- TC-1 provisioning (AC-1, AC-3): dinner+lunch live, breakfast paused, snack absent; a 0-count course
  starts paused; re-run is idempotent (one row per course, unchanged next-run); provisioning fires on
  the `first_meal_plan` pop and the rows stay live even though the stack-empty rule pauses the
  heartbeat; a non-`first_meal_plan` pop provisions nothing.
- TC-2 sweep (AC-2): a due heartbeat + a due reminder both dispatch (2 doorbells, keys `hb:…` and
  `mr:dinner:…`); the reminder advances tz-aware (America/New_York); a future row is untouched; a
  paused reminder is skipped.
- TC-3 fire arm (AC-4): the chef gets the reminder intent naming dinner + today's recipe; the outbound
  guid is `reminder:dinner:<today>#0` with a null trigger; a message seconds old does NOT suppress it
  (no quiet gate).
- TC-4 silence (AC-5): a due reminder with nothing planned today never invokes the chef, sends
  nothing, and leaves the row for tomorrow.
- TC-5 same-day idempotency (AC-6): a second doorbell the same day sends no new bubble (the per-day
  guid's `alreadySent` guard) and writes no new outbound row.
- TC-6 pending inbound wins (AC-7): an unprocessed inbound runs the normal turn; the reminder does not
  fire this doorbell and its row is left for the next sweep.

**Suite.** Full `npm test` from clean (dev server stopped): **641 passed, 1 skipped, 0 failed**
(84 files). `npm run typecheck`: clean.

## Deployment Strategy

Additive migration (nullable column + index rebuild), safe before code. Ships inert
until a first_meal_plan completes post-deploy (no backfill for already-confirmed
households in this WI — note it; a backfill script can ride WI-03 if wanted).
Rollback: code rollback safe; `UPDATE dynamic_cron_jobs SET is_paused=1 WHERE
job_type='meal_reminder'` silences without deploy.

## Production Verification

### PV-1: end-to-end dinner reminder

**Preconditions:** deployed; test household with a confirmed plan and a dinner entry
today; dinner row's `next_run_at` forced due.

**Steps:** wait a sweep tick; watch logs + the thread.

**Expected Outcomes:** one reminder bubble naming tonight's meal; a second tick sends
nothing; `next_run_at` advanced to tomorrow.

## Production Verification Run

To be filled after deploy.
