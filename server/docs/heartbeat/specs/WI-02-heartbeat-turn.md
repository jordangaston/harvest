# WI-02 — The heartbeat turn: actionable(), consumer arm, chef intent

## Background

WI-01 gives us a beat: a bare `{threadId}` doorbell lands on `inbound-messages` on the
thread's cron cadence. This work item makes the consumer act on it. Under the existing
per-thread redlock (`src/imessage/lock.ts`), with no pending inbound, the drain loop in
`src/imessage/consumer.ts` currently exits unless the last turn popped or the active
objective carries the `kickoffPendingAt` marker. The design
(`server/docs/heartbeat/DESIGN.md`, § What's actionable) adds a third arm: run a turn
when the active objective has **actionable** work —

- **Arm 1 (quiet ask):** an `asked` task whose silence gap exceeds the follow-up ladder
  `[5m, 30m, 60m, 4h, 8h, 24h]`, measured from `nudged_at`, counted by the existing
  `follow_ups_sent` column (schema.ts:860, currently unused). After 6 nudges: quiet
  forever (DESIGN.md Q-01 — do NOT default the task).
- **Arm 2 (eligible unasked):** an `unasked` task whose `after_task_ids` gates are all
  terminal — the chef asks/delivers it via its normal behaviour, no ladder wait.

The key invariant: **the sweeper wakes, the consumer decides** — due-ness is evaluated
under the lock against fresh state, so a nudge can never race a reply that already
answered.

## Objective

A bare doorbell on a thread with actionable work produces one chef turn that nudges
quiet asks and/or asks eligible unasked tasks, commits ladder state
(`follow_ups_sent`, `nudged_at`) delivered-only, and is idempotent under redelivery; a
thread with nothing actionable no-ops silently.

## Acceptance Criteria

1. Given the migration, then `tasks` has a nullable `nudged_at` timestamp column.
2. Given a pure function `actionable(tasks, now)`, then it returns: `asked` tasks with
   `follow_ups_sent < 6` and `now - nudged_at >= LADDER[follow_ups_sent]`, plus
   `unasked` tasks whose `after_task_ids` are all terminal (`filled`/`defaulted`) —
   and nothing else (not `filled`/`defaulted` tasks, not exhausted asks, not gated
   unasked tasks).
3. Given a task flips to `asked` (both existing chokepoints: `confirmAcks` and the
   `tasks__update` path), when the flip commits, then `nudged_at` is stamped.
4. Given no pending inbound, no pop, no kickoff marker, and no actionable tasks, when a
   doorbell is handled, then the drain loop returns without a turn (today's behaviour).
5. Given an `asked` task past its ladder rung, when a bare doorbell is handled, then
   the chef runs a turn with the heartbeat intent (task ids), sends via a sink whose
   guid prefix is `<objectiveId>:hb:<taskId>:<n>` (`n` = `follow_ups_sent + 1`), and —
   only if delivered — one transaction increments `follow_ups_sent` and sets
   `nudged_at = now` for each nudged task.
6. Given an eligible `unasked` task, when a bare doorbell is handled, then the chef
   runs a turn that asks/delivers it through the normal paths (its `asked` flip stamps
   `nudged_at` per AC-3); no follow-up counter changes.
7. Given the same doorbell redelivered after a completed heartbeat turn, when handled,
   then no duplicate bubble is sent (deterministic guid) and ladder state is unchanged
   (or re-commits identically).
8. Given pending inbound exists, when a doorbell is handled, then a normal turn runs
   and no heartbeat turn fires in the same iteration (pending wins).
9. Given the chef returns nothing or delivery fails, then ladder state is unchanged and
   at most ONE heartbeat attempt per objective happens per `handle()` call (same
   bounding pattern as the `kickedOff` set).

## Test Cases

Run vitest files individually and `pkill -f vitest` between runs (libSQL file locks).
Consumer tests use the existing stub pattern: stub chef/sender, `StubThreadLock`,
`file:` libSQL DB.

### Test Case 1: actionable() table test (AC-2)

**Preconditions:** none (pure function; pass `now` explicitly).

**Steps:** Cases per arm — each rung boundary (just under: not due; at: due), exhausted
(`follow_ups_sent = 6`), `asked` with null `nudged_at` [ASSUMPTION: treat null
`nudged_at` on an `asked` task as due immediately — it predates this feature or missed
a stamp; a nudge is the safe recovery], eligible unasked (gates terminal), gated
unasked, `filled`/`defaulted`, solo semantics unchanged.

**Expected Outcomes:** Exactly the due/eligible tasks returned.

### Test Case 2: nudge turn commits ladder state (AC-5)

**Preconditions:** Active objective, one `asked` task with `nudged_at` 6 minutes ago,
`follow_ups_sent = 0`; stub chef returns a delivered reply.

**Steps:** Handle a bare doorbell.

**Expected Outcomes:** Chef invoked with heartbeat intent naming the task; sink guid
prefix `<objectiveId>:hb:<taskId>:1`; after commit `follow_ups_sent = 1` and
`nudged_at` ≈ now.

### Test Case 3: eligible unasked task triggers an ask turn (AC-6, AC-3)

**Preconditions:** Active objective, task A `filled`, task B `unasked` gated on A;
stub chef delivers and marks B asked.

**Steps:** Handle a bare doorbell.

**Expected Outcomes:** Chef invoked with heartbeat intent naming B; B ends `asked`
with `nudged_at` stamped; `follow_ups_sent` still 0.

### Test Case 4: silent no-op when nothing actionable (AC-4)

**Preconditions:** Active objective, one `asked` task nudged 1 minute ago.

**Steps:** Handle a bare doorbell.

**Expected Outcomes:** Chef never invoked; no sends; no state change.

### Test Case 5: pending inbound wins (AC-8)

**Preconditions:** Same as TC-2 plus one unprocessed inbound message past the cursor.

**Steps:** Handle the doorbell.

**Expected Outcomes:** A normal turn runs against the inbound (trigger id = message
id); ladder untouched by that iteration.

### Test Case 6: redelivery is idempotent (AC-7)

**Preconditions:** TC-2 completed (nudge sent, state committed).

**Steps:** Handle the same bare doorbell again with the clock unchanged.

**Expected Outcomes:** No new bubble (task no longer due at rung 1 → silent no-op);
state unchanged.

### Test Case 7: silent chef leaves state unchanged, attempt bounded (AC-9)

**Preconditions:** TC-2 setup but stub chef returns null.

**Steps:** Handle the doorbell.

**Expected Outcomes:** No commit; `follow_ups_sent = 0`; chef invoked exactly once for
the objective in this `handle()` call.

## Test Run

To be filled during execution.

## Deployment Strategy

Additive migration (`nudged_at`), safe before code. Behaviour only activates on bare
doorbells with actionable work — with no WI-01 heartbeat rows, production traffic is
unchanged (inbound doorbells always have pending or existing kick-off arms). Deployable
independently of WI-01, in either order. Rollback: plain code rollback; column is
ignored by old code.

## Production Verification

### Production Verification 1: end-to-end nudge on a test thread

**Preconditions:** WI-01 and WI-02 deployed; a test thread with an active objective
whose elicit was asked > 5 minutes ago and never answered; a heartbeat row for the
thread (manual insert until WI-03).

**Steps:** Wait for the next beat; watch `vercel logs` for the "nudge sent" line;
check the iMessage thread.

**Expected Outcomes:** One nudge bubble arrives; log shows
`threadId, taskId, nudgeNo: 1`; `tasks.follow_ups_sent = 1`. A second beat within 30
minutes produces NO second nudge.

### Production Verification 2: reply cancels the ladder

**Preconditions:** PV-1 done (task at nudge 1).

**Steps:** Answer the question from the test device; wait past the next rung; watch
logs.

**Expected Outcomes:** Task `filled` by the reply; no further nudges ever fire for it.

## Production Verification Run

To be filled after deploy.
