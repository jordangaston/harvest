# WI-01 — Steady state: onboarding seeds once; empty stack = all tools, no objective

## Background

Live-test bug (2026-09-06): completing `first_meal_plan` empties the objective stack,
and the next inbound hit `loadTurn`'s "no active objective + pending ⇒ seed
onboarding" branch — written for first contact but firing on ANY empty stack. The
household got re-onboarded (thread ec79130b: completed onboarding + completed
first_meal_plan, then a bogus fresh onboarding + suspended first_meal_plan).
Founder's direction, verbatim: "That's a bug — it should only fire the very first
time. We don't want a steady state objective. All tools should be available during
steady state."

So: an empty stack WITH history is a valid, permanent state (the household planned
their week; they're done until they want something). In that state the chef answers
normally with EVERY tool available — no objective row, no tasks, nothing to nudge.

## Objective

Onboarding seeds only when a thread has no objectives at all; a thread with an empty
stack gets normal conversational turns with the full tool set and no objective.

## Acceptance Criteria

1. Given a thread with ZERO objectives rows and pending inbound, then `loadTurn`
   seeds onboarding + first_meal_plan exactly as today (first contact unchanged).
2. Given a thread whose objectives are ALL terminal (complete) and pending inbound,
   then NO objective is seeded; the turn runs in steady state: briefing built from a
   steady-state instruction shell (the `meal-reminder.ts` shell-definition mechanism
   is the precedent — instructions, no DB row, no tasks section content), and the
   tool set is EVERY registered factory tool (all FACTORIES entries), canRun-gated
   as usual. `chat__send`/facts tools work as in any turn.
3. Given a steady-state turn, then the consumer commit path is safe with no
   objective: no confirmTasks, no AC-8 emit net, no kickoff-marker writes, popped
   false, cursor advances normally; `ChefReply.objectiveId` becomes nullable (or a
   sentinel — pick the cleaner type and follow the codebase's domain-naming taste).
4. Given a steady-state thread, heartbeats: `loadActive` returns null → the
   heartbeat arm never fires (already true — verify with a test, don't change the
   arm). Reminders keep working (they don't need an objective — verify the reminder
   arm on a steady-state thread with a planned meal).
5. Given the grocery tools, then they are also in the ONBOARDING tool list (mid-
   onboarding "add milk" works) — one-line wiring + registration test update.
6. A repair script `scripts/repair-reseeded-threads.ts`: deletes objectives (and
   their tasks, cascade) that were re-seeded AFTER a thread already had a completed
   onboarding — i.e., for each thread, any non-terminal onboarding/first_meal_plan
   created after a completed onboarding exists. Idempotent; logs what it deletes.
   (Repairs dev thread ec79130b's 7775d9be + 42c0be5f.)

## Test Cases

Vitest, files individually; canonical `npm test` FROM server/ (cwd trap: repo root
runs the Expo suite), dev server stopped; vitest may hang after its summary — the
summary is the verdict.

### TC-1: first contact still seeds (AC-1)
Fresh thread + inbound → onboarding active + first_meal_plan suspended, as today.

### TC-2: steady state answers with all tools, seeds nothing (AC-2, AC-3)
Thread with completed onboarding + completed first_meal_plan; inbound "what do we
need at the store?" with a stub agent capturing the built tool map → contains every
FACTORIES id (grocery__*, mealplan__*, facts__*, tasks__update…); NO new objectives
rows; reply commits (cursor advances), no throw.

### TC-3: steady-state reminders + heartbeat quiet (AC-4)
Same thread, due dinner reminder + planned dinner → reminder fires; a bare heartbeat
doorbell → silent no-op (no active objective).

### TC-4: grocery tools during onboarding (AC-5)
Onboarding context builds grocery__* alongside its own tools.

### TC-5: repair script (AC-6)
Seed the live-bug shape (complete onboarding + complete fmp + fresh active
onboarding + fresh suspended fmp) → script deletes the two fresh rows + their tasks,
leaves the terminal history; second run deletes nothing.

## Test Run

To be filled during execution.

## Deployment Strategy

Code + one-off repair script (run once against prod after deploy; dev thread
repaired immediately). Rollback: plain code rollback (re-seed bug returns, nothing
corrupts).

## Production Verification

### PV-1: post-plan steady state
On a thread that completes first_meal_plan: next message gets a normal answer (no
re-onboarding); "what do we need" produces the grocery card; dinner reminder still
fires.

## Production Verification Run

To be filled after deploy.
