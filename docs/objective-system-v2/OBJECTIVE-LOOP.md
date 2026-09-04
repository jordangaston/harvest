# Objective loop — implementation guidance

**Goal:** when an objective completes, pop it and advance to the next one — without waiting for a new
inbound. This lets onboarding pop straight into a meal-plan objective whose first task generates and
presents the menu.

## Two ideas

1. **`update_tasks` completes and pops.** The tool already fills a task in-loop and computes
   `isComplete`. Extend it: after applying the fills, if the objective is complete, `completeAndPop`,
   and return that to the model. The model sees "objective complete, popped" in the tool result and
   **bails out of the turn** — it stops working a finished objective instead of pushing on blind. This
   is the only way the model knows to stop: the pop must happen in-loop, visible to it.

2. **The consumer drain loop drives the next objective — `respond` stays one turn.** No loop inside
   `respond`. After a turn pops an objective, the consumer's existing `for(;;)` loop runs one more
   iteration against the now-active objective. That iteration has no inbound (a *kick-off* turn): the
   model reads "here's the next objective" and delivers/asks its opener.

## Changes

**`update_tasks`** (`chef/tools/update-tasks.ts`)
- Accept `emit` tasks: mark `filled`, no fact write (an emit has no fact). So the close is completed
  through `update_tasks`, not the consumer's `delivered` heuristic.
- After the fills: `if (isComplete) completeAndPop`. Return `{ objectiveComplete, popped }` so the
  model wraps up the turn.

**`Consumer.handle`** drain loop
- Continue the loop when **pending inbound remains OR the last turn popped an objective** (kick off the
  newly-active one). Stop when the active objective *survives* a turn — it asked something and is now
  parked, waiting on the household.
- Delete the `delivered` / `confirmTasks(emit)` / `completedNow` / `completeAndPop` block — pop now
  lives in `update_tasks`. The commit is just **advance the cursor**; no transaction (see Retry).

**`RealChef.respond`**
- Runs one turn. When there's no pending inbound but the active objective has un-started work, build a
  **triggerless** briefing (`triggerExternalId = null`, `messageTargets = {}`, no pending-inbound line)
  so it kicks off the new objective. Return whether the turn popped, for the drain loop's continue check.

**`LiveOutboundSink`**
- A triggerless turn has no inbound id: key the send guid on the **objective id**
  (`${objectiveId}#${ordinal}`). Otherwise unchanged.

## Continue iff popped

One turn per objective. If the turn *completes* the objective (model saw the pop, bailed), the drain
loop advances to the next. If the turn only *asked* something (no pop), it parks — even if unasked
tasks remain; that turn bundled what it wanted to ask. Termination is bounded by stack depth.

## Retry / idempotency

No transaction around pop + cursor; correctness is idempotency, not atomicity (same choice
`update_tasks` already makes for its fact/status writes):
- **Sends** dedupe on the deterministic guid (`insertOutboundIdempotent` → `alreadySent` skip).
- **State only advances** (task→filled, objective→complete). A re-run reads advanced state + the
  transcript, sees it already spoke, and no-ops.
- **Cursor advances last.** Popped-but-cursor-unmoved on a crash is fine: the redelivered turn re-runs
  against the now-active objective, no-ops, and the cursor moves.

## Out of scope
- **Explainer-ack** (fact-less elicit): keeps its inbound-driven transition (asked-when-delivered,
  filled-on-next-inbound) — it has no fact for `update_tasks` and completes long before the close.
- **Heavy proactive steps** — if an opener ever runs minutes (not the fast ranking present), re-enqueue
  it as its own turn instead of looping in-process.
- **Inter-bubble pacing** for the menu burst — separate UX concern.
