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

To be filled during execution.

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
