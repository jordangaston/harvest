# WI — Objective loop: complete-and-pop in `update_tasks`, proactive advance in the drain loop

## Background

The Chef runs one objective at a time. `objectives` is a stack; `ObjectiveRepository.completeAndPop`
marks the active objective `complete` and activates the highest-`stack_position` suspended sibling.
Today a turn only runs in response to an inbound message, and the pop happens *after* the turn, in
`Consumer.handle`'s commit: it confirms fact-less tasks on a coarse `delivered` boolean, checks
`isComplete`, and calls `completeAndPop`.

Two problems block chaining onboarding into a follow-up objective (e.g. a meal-plan objective whose
first task generates the menu):

1. **The model never learns it finished.** The pop is computed in the consumer after `agent.generate`
   returns, so mid-turn the model has no signal to stop working a completed objective.
2. **Nothing runs the next objective.** After a pop, the drain loop re-checks pending inbound, finds
   none, and exits — the newly-active objective sits dormant until the household happens to text again.

Design doc: `docs/objective-system-v2/OBJECTIVE-LOOP.md`.

Key terms — **objective**: a stack row with a definition + tasks. **task**: an `elicit` (asks the
household for a fact) or an `emit` (Chef delivers content, e.g. the onboarding close). **turn**: one
`agent.generate` against the active objective. **kick-off / triggerless turn**: a turn with no inbound
message, run to start a freshly-activated objective.

## Objective

Move objective completion and the pop into the `update_tasks` tool so the model learns in-loop that it
finished and bails out; make `Consumer.handle`'s existing drain loop run a triggerless kick-off turn
against the next objective after a pop. Scope is the loop mechanism only — no new objective definition
is built here (the meal-plan objective is a separate work item). Coverage uses onboarding (the real
completion path, now changed) plus a synthetic two-objective stack for the proactive kick-off.

## Acceptance Criteria

- **AC-1 — `update_tasks` accepts an `emit` task.** Given an eligible required `emit` task, when the
  model calls `update_tasks` with its `task_id`, then the task is set `filled` with no fact write, and
  the result reports it filled. (Today `update_tasks` rejects non-elicit tasks.)

- **AC-2 — `update_tasks` completes and pops in-loop.** Given a call that fills the objective's last
  required non-terminal task, when `update_tasks` runs, then it calls `completeAndPop` in the same
  turn and the objective row is `complete` before `agent.generate` returns.

- **AC-3 — the tool result tells the model to bail.** Given AC-2, when `update_tasks` returns, then the
  result includes `objectiveComplete: true` and `popped: true`, so the model stops working the
  finished objective.

- **AC-4 — the drain loop kicks off the next objective.** Given a turn that popped the active objective
  and a suspended sibling is now active, when the turn commits, then `Consumer.handle` runs one more
  loop iteration with no pending inbound — a triggerless turn built from the newly-active objective.

- **AC-5 — continue iff popped; a non-popping turn parks.** Given a turn that advanced the objective
  but did not complete it (only asked), when it commits, then the drain loop stops (no further turn
  until a new inbound), even if unasked tasks remain.

- **AC-6 — the `delivered`-based emit confirm is gone.** Given onboarding's close is delivered and
  marked via `update_tasks`, when the turn commits, then `Consumer.handle` performs no emit
  confirmation or `completeAndPop` of its own; the commit only advances the cursor. Emits no longer
  complete on the coarse "any bubble sent" heuristic.

- **AC-7 — onboarding still completes end to end.** Given a household that fills every required
  onboarding task and receives the close, when the close `emit` is marked via `update_tasks`, then
  onboarding pops exactly as before (no regression in the observable close behavior).

- **AC-8 — safety net: a delivered but unmarked required emit cannot stall the thread.** Given the
  required close `emit`'s content was delivered this turn but the model did not mark it via
  `update_tasks`, when the turn commits, then `Consumer.handle` completes and pops the objective as a
  fallback, so the terminal flow never hangs waiting on an inbound that may never come. `[ASSUMPTION:
  the doc favors removing the delivered heuristic; this narrow fallback — scoped to a delivered,
  still-unmarked required emit — is retained because onboarding's close has no inbound to trigger a
  retry. Reviewer to confirm.]`

- **AC-9 — triggerless sends are idempotent.** Given a kick-off turn (no inbound id), when it sends
  bubbles, then each outbound guid is keyed on the objective id (`${objectiveId}#${ordinal}`), so a
  redelivered kick-off skips already-sent bubbles.

- **AC-10 — a completed drain redelivers cleanly (no duplicate sends).** Given a `handle` pass that ran
  to completion (turns committed, cursor advanced), when the same doorbell redelivers, then the re-run
  sends no duplicate bubbles (the sink's deterministic guids skip already-sent rows) and commits nothing
  new. `[DEFERRED: crash-recovery for a stranded kick-off — a crash between a pop and its kick-off leaves
  the newly-active successor's opener undelivered with no cold-start re-entry — is deferred to the first
  successor-objective (meal-plan) WI, which adds a durable "awaiting-opener" marker set on
  completeAndPop + a re-entry arm in the drain loop. It is unreachable in production until a successor
  objective ships (nothing is pushed below onboarding today). A `ponytail:` comment marks the exact gap
  in `server/src/imessage/consumer.ts`.]`

- **AC-11 — explainer-ack unchanged.** Given the fact-less explainer-ack `elicit`, when it is delivered
  and answered, then it transitions `unasked → asked` (on delivery) → `filled` (on the next inbound),
  unchanged — it has no fact for `update_tasks` and completes before the close.

## Test Cases

### TC-1 — `update_tasks` fills an emit and pops (AC-1, AC-2, AC-3)
**Preconditions:** In `server/`, a test DB (as `increment2-repositories.test.ts` sets up). Seed one
objective with a single required `emit` task, status `unasked`, eligible.
**Steps:** Build `UpdateTasksTool` against a `TurnContext` whose `tasks` include the emit. Call
`run([{ task_id: emitId, value: undefined }])`.
**Expected Outcomes:** The emit row is `filled`; the objective row is `complete`; the result is
`{ results: [{ task_id: emitId, status: 'filled' }], objectiveComplete: true, popped: true }`.

### TC-2 — `update_tasks` fills the last elicit and pops when no emit remains (AC-2, AC-3)
**Preconditions:** Objective with two required `elicit` tasks; one already `filled`, the other eligible.
**Steps:** Call `update_tasks` with a valid value for the remaining elicit.
**Expected Outcomes:** Task `filled`, objective `complete`, `popped: true`. A sibling suspended
objective, if present, is now `active`.

### TC-3 — filling a non-terminal task does not pop (AC-5)
**Preconditions:** Objective with two required elicits, both non-terminal.
**Steps:** Call `update_tasks` filling one.
**Expected Outcomes:** That task `filled`, objective still `active`, `objectiveComplete: false`,
`popped: false`.

### TC-4 — drain loop runs a triggerless kick-off after a pop (AC-4, AC-5)
**Preconditions:** `imessage-consumer-logic.test.ts` harness with a `ScriptedChefAgent`. Thread with
objective A active and objective B suspended. Script the agent so its first turn pops A (via
`update_tasks` on A's last task) and its second (triggerless) turn sends one bubble against B, leaving
B active.
**Steps:** Enqueue one inbound; run `Consumer.handle`.
**Expected Outcomes:** Two turns ran from one inbound. After turn 1, A is `complete` and B `active`.
Turn 2 ran with no pending inbound (a kick-off). The loop stops after turn 2 (B survived). The cursor
sits at the single inbound.

### TC-5 — onboarding completes via `update_tasks`, consumer only advances the cursor (AC-6, AC-7)
**Preconditions:** `chef-onboarding.test.ts` end-to-end harness driving onboarding to the close.
**Steps:** Fill every required task; deliver the close; script the agent to mark the close `emit` via
`update_tasks`.
**Expected Outcomes:** Onboarding pops; the close bubbles are observed exactly as in the pre-change
test; `Consumer.handle` runs no `completeAndPop` of its own (assert via a spy or by removing the
consumer path) — only the cursor advances.

### TC-6 — safety net completes a delivered, unmarked required emit (AC-8)
**Preconditions:** Onboarding at the close; script the agent to deliver the close bubbles but NOT call
`update_tasks` on the emit.
**Steps:** Run the turn.
**Expected Outcomes:** The objective still pops (consumer fallback); no duplicate close bubbles on a
re-run; the thread does not hang.

### TC-7 — kick-off sends dedupe on objective id under redelivery (AC-9, AC-10)
**Preconditions:** TC-4 setup. Run `Consumer.handle` once to completion, capturing the sent guids.
**Steps:** Simulate a crash before the cursor advance (or re-invoke `handle` on the same inbound), then
re-run.
**Expected Outcomes:** Kick-off outbound guids are `${objectiveB.id}#0…`; the re-run inserts no new
sends (`alreadySent`), B stays active, the cursor advances on the successful pass.

### TC-8 — explainer-ack lifecycle unchanged (AC-11)
**Preconditions:** Fresh onboarding thread.
**Steps:** Deliver the explainer; send the next inbound.
**Expected Outcomes:** The ack task is `asked` after delivery and `filled` after the next inbound —
identical to the current `chef-onboarding.test.ts` assertions.

## Test Run

_To be filled during execution. All of `server/`'s suite must pass (`pnpm test` in `server/`), not
only the new cases._

## Deployment Strategy

Direct deploy to the Chef backend; no user-facing flag. The proactive kick-off is **dark** in
production until a suspended successor objective exists — nothing pushes one yet, so `completeAndPop`
returns null after onboarding and the loop exits exactly as today. The one behavior that changes for
live threads is onboarding's completion *path* (emit marked via `update_tasks`, with the AC-8 safety
net), so the risk is contained to "does onboarding still pop?", covered by TC-5/TC-6 and the full
suite. Land behind the existing offline-stub gate (`GEMINI_API_KEY` selects the live agent); verify on
the iMessage sim harness before the founder sees it.

## Production Verification

### Production Verification 1 — onboarding still completes on a real thread
**Preconditions:** A real iMessage test thread (the `ime-turn.sh` / chef-sim harness).
**Steps:** Run a household through onboarding to the close.
**Expected Outcomes:** The three close bubbles arrive once; the objective row is `complete`; no
duplicate close on any redelivery.

### Production Verification 2 — a two-objective stack chains without an inbound
**Preconditions:** Temporarily seed a trivial suspended successor objective (single `emit`) behind
onboarding on a test thread.
**Steps:** Complete onboarding.
**Expected Outcomes:** Immediately after the close, the successor's kick-off bubble arrives with no
further inbound; the successor is `active`; sends are keyed on its objective id.

## Production Verification Run

_To be filled after deployment._
