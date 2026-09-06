# WI-03 — Reminder tools: set the time, pause/resume

## Background

WI-01/02 give standing per-course reminder crons that react to settings.
`server/docs/meal-reminders/DESIGN.md` (§§ F-03, F-06, APIs, Modules) adds the
conversational surface: "remind me at 4 for dinner" retunes the standing row —
NOT a one-shot — and "stop reminding me about lunch" pauses it durably.

## Objective

Two chef tools, registered per the design: `mealplan__set_reminder_time`
{ meal, time } updates the course row's cron to the requested household-local
wall-clock time (and clears `pausedByUser` — asking to be reminded is intent to be
reminded); `mealplan__set_reminder_enabled` { meal, enabled } sets/clears
`pausedByUser` in the row's `input` JSON and recomputes `is_paused`.

## Acceptance Criteria

1. Given `mealplan__set_reminder_time` with { meal: 'dinner', time: '16:00' }, when it
   runs, then the dinner row's cron becomes 16:00 daily in the household zone,
   `next_run_at` recomputes, `input.pausedByUser` clears, `is_paused` re-derives, and
   the tool returns { meal, reminder_time } (DESIGN § APIs). A missing row (e.g.
   snack) is upserted on demand (DESIGN Q-06 resolution).
2. Given `mealplan__set_reminder_enabled` with enabled=false, then
   `input.pausedByUser=true` and `is_paused=true`; enabled=true clears the flag and
   `is_paused` re-derives from the weekly count (0 stays paused).
3. Both tools follow the ChefTool pattern (class, `canRun()` gating on
   householdId/threadId per TurnContext, `asMastraTool()` with zod input schemas,
   FACTORIES registration) and are wired into the objective tool lists the DESIGN
   names (follow § Modules/changes-by-file; they are mealplan-family tools).
4. Given a turn where the model calls set_reminder_time twice (redelivery replay),
   then the result is identical (UPDATE — idempotent by construction).
5. Time input validation: local wall-clock (HH:MM); invalid values are rejected with
   a reason in the tool result (the model self-corrects), never a throw.

## Test Cases

Vitest, files individually, `pkill -f vitest`; canonical `npm test`, dev server
stopped.

### Test Case 1: set time retunes and un-pauses (AC-1)

**Preconditions:** provisioned rows, dinner paused via `pausedByUser` + tz
America/Chicago set.

**Steps:** Run the tool with { dinner, '16:00' }.

**Expected Outcomes:** cron = 16:00 America/Chicago daily; `pausedByUser` gone;
`is_paused=false` (weekly count nonzero); return shape per design; second identical
call changes nothing further.

### Test Case 2: enable/disable precedence (AC-2)

**Steps:** disable lunch → paused + flagged; run a weekly-meals persist (count 3) →
still paused; enable → live.

### Test Case 3: snack upsert on demand (AC-1)

**Steps:** set_reminder_time { snack, '15:00' } with no snack row → row created live
at 15:00 local.

### Test Case 4: tool registration + canRun (AC-3)

**Steps:** build tools for the objectives the design wires them into → both present;
a context with no householdId → filtered out by canRun.

## Test Run

Implemented as two `ChefTool`s in `src/chef/tools/mealplan.ts` (`SetReminderTimeTool`,
`SetReminderEnabledTool`), backed by `RemindersService.setReminderTime` / `.setReminderEnabled` and
two narrow `ReminderRepository` methods (`findCourseReminder`, `setEnabled`; `upsertCourseReminder`
now accepts the db singleton so a tool write runs outside a txn). Registered in the tool `FACTORIES`
and wired into the `first_meal_plan` objective's tool list (the durable steady-state objective — the
only stack home a post-plan household lives in; the `meal_reminder` shell stays tool-less as it is a
scheduled announce, not a retuning surface).

**Deviations / decisions:**
- **AC-1 "0 stays paused" vs. DESIGN F-03 "is_paused=0".** The spec is the newer authority and is
  explicit ("re-derives from the weekly count (0 stays paused)"), so `set_reminder_time` clears
  `pausedByUser` and sets `is_paused = weeklyCount === 0`. `setReminderTime` moves the tuned time even
  for a 0-count course, but leaves it paused. Snack is the exception: it is not a weekly-count course,
  so an explicit snack time/enable goes live (the request itself is the intent — DESIGN Q-06).
- **`set_reminder_enabled` missing row (DESIGN F-06).** `enabled=false` with no row is a no-op (nothing
  to pause). `enabled=true` upserts the course at its default time (snack upserts too) so "remind me
  about lunch again" works even if provisioning never ran — an enable is an intent to be reminded, and
  F-06 hands control back to the preference-derived rule.
- **No backfill script.** DESIGN § Deployment (Migrations row 2) makes the existing-household backfill
  optional ("can be provisioned by a one-off script if desired") — reminders provision lazily at the
  next first-plan-confirm and there is no live data, so the script is skipped (YAGNI).

**Vitest** (`test/meal-reminders.test.ts`, run individually, dev server stopped):

```
$ pkill -f "nitro dev"; pkill -f vitest; ulimit -n 30000; npx vitest run test/meal-reminders.test.ts
 ✓ test/meal-reminders.test.ts (30 tests) 2451ms
   Test Files  1 passed (1)
        Tests  30 passed (30)
```

New WI-03 cases (8): set time retunes + clears `pausedByUser` + `is_paused` re-derives, in
America/Chicago (Test Case 1, AC-1); 0-count course keeps paused but moves its time (AC-1); bad-time
rejection with a reason, never a throw, nothing changed (AC-5); snack upsert-on-demand at 15:00 live
(Test Case 3, AC-1/Q-06); disable → paused+flagged, a weekly bump can't resurrect it, enable → live
(Test Case 2, AC-2); enable re-derives from the count (0 stays paused, AC-2); disable-missing no-op /
enable-missing upserts live; both tools build for `first_meal_plan` with household+thread and are
`canRun`-filtered without a household (Test Case 4, AC-3). AC-4 (idempotent replay) is the second
identical `set_reminder_time` call in Test Case 1.

**Full canonical suite** (`npm test`, dev server stopped):

```
$ pkill -f "nitro dev"; pkill -f vitest; ulimit -n 30000; npm test
   Test Files  84 passed (84)
        Tests  659 passed | 1 skipped (660)
   Duration  26.07s
```

## Deployment Strategy

Code-only; after WI-02. Rollback: plain code rollback (rows untouched by rollback).
If the design's provisioning-backfill note (WI-01 deployment) is wanted, a
`scripts/` one-off can ride this WI — check DESIGN § Deployment and do what it says.

## Production Verification

### PV-1: retune from the phone

**Steps:** Text Sage "remind me at 4 about dinner"; check the row + tomorrow's fire.

**Expected Outcomes:** cron 16:00 local; confirmation bubble; next day's reminder
arrives ~16:00.

### PV-2: pause from the phone

**Steps:** "stop reminding me about lunch" → row paused + flagged; no lunch reminder
next day.

## Production Verification Run

To be filled after deploy.
