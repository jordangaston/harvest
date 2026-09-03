# Responsive Turn 2 — Mid-turn `send` + `trigger_id` durability

> ## ⚠️ Pre-mortem corrections (AUTHORITATIVE — override any conflicting text below)
>
> - **Table is `thread_messages`, not `messages`** (`server/src/schema.ts:199`). Stack is
>   **libSQL/Turso** (`drizzle-orm/libsql`, `sqliteTable`, `drizzle.config.ts` `dialect:'turso'`) —
>   `server/CLAUDE.md`'s "Postgres/DBOS" prose is stale. Use `sqliteTable` DDL, not `pgTable`.
> - Column: nullable `triggerId: text('trigger_id')` on `threadMessages`; index
>   `index('idx_thread_messages_trigger').on(t.threadId, t.triggerId)`. Generate via
>   `drizzle-kit generate` into `drizzle/` (do NOT hand-write DDL). SQLite `ADD COLUMN` of a nullable
>   FK is fine.
> - Tests already migrate a real libSQL file db (`server/test/helpers/migrated-db.ts` via
>   `drizzle-orm/libsql/migrator`), so TC5 (migration is real) needs no new infra.
>
> ## Implementation design (authoritative — grounded in the post-Story-1 agentic responder)
>
> **Schema (DONE, committed `5be93b5`):** `thread_messages.trigger_id` nullable + `(thread_id,
> trigger_id)` index. Migration `0035_responsive_turn_trigger_id.sql`.
>
> **The outbound sink.** The Consumer owns the `Sender`; the responder must send *during* its generate.
> So the Consumer builds a per-turn **sink** and passes it into `chef.respond(threadId, sink)`:
> ```ts
> interface OutboundSink { send(event: ChatEvent): Promise<void>; }  // journal + live send, idempotent
> ```
> `chef.respond` threads `sink.send` into `SupervisorTurn.send`; the responder's `send` tool calls
> `turn.send(sendEvent(payload, triggerExternalId))`. The sink, per call:
> 1. `messageGuid = `${triggerId}#${ordinal}`` (deterministic; ordinal increments per send this turn).
> 2. Insert the outbound row (tagged `trigger_id`, the deterministic guid) with **onConflictDoNothing**
>    on the unique `message_guid` index. If the insert was a **no-op** (row already exists) AND that
>    row's `sent_at` is set → a redelivery replay, **skip the real send**. Else → send live via
>    `Sender` (text→`send`, tapback→`sendReaction`, richlink→`sendLink`), then `markSent` + `setExternalId`.
> 3. Increment ordinal.
>
> **`chef.respond` contract change.** It no longer returns `chatEvents` for the Consumer to send (sends
> happened live). `ChefReply` becomes `{ confirmTasks, cursorTo, objectiveId, delivered }` where
> `delivered` = "at least one send happened" (the sink tracks it). The `deliberated` flag still gates
> `confirmTasks` (social turn → `[]`).
>
> **Consumer.handle.** After `chef.respond(threadId, sink)` returns, in ONE transaction: `confirmTasks`
> (if delivered) + completion-pop + **`advanceCursor` LAST** + effect-gate stamps. Then fire the
> POST-turn effects via `Sender` (fireworks on completion, rename, contact card) — unchanged, they were
> already separate bubbles. It no longer inserts/dispatches outbound rows.
>
> **Effect gate — greet confetti (the one woven into a bubble).** The confetti rides the *first* live
> send of a greet turn. The sink is built with a `greet` flag; its first text send uses
> `sender.sendEffect(confetti)` instead of `send`, then clears the flag. All other gates stay post-turn.
>
> **Interruption barrier (DELICATE — changes).** Today `chef.respond` discards a render and restarts if
> a message landed mid-reasoning (`MAX_INTERRUPT_RESTARTS`). **Live sends are not discardable** — a
> restarted attempt has already sent. So: **remove the restart**; a message that lands mid-turn is
> picked up by the Consumer's existing drain loop on the next iteration (the reasoner reads all pending
> at its next turn). Log this as the Q-02 resolution in practice.
>
> **Ceilings to log (POSTMORTEM):**
> - Divergent re-run after a mid-turn crash (model sends a different prefix) can drop/misorder the tail
>   — rare; no data loss (reasoner writes persist; ordinals realign next turn).
> - Row-inserted-but-crash-before-`markSent` re-sends that one row on redelivery (the *existing*
>   increment-1 `sent_at`-gate ceiling, now per-row instead of per-batch — strictly narrower).
>
> **Load-bearing test (TC2):** run a turn, throw after the first live send commits (before cursor
> advance), assert cursor unmoved, re-invoke `handle` on the same doorbell, assert the stub `Sender`
> received exactly one of each send across both runs and the cursor advanced after.


## Background

Increments 1-2 made the responder drive the turn and call `deliberate` on demand, but the turn is
still **run-to-completion**: `respond` returns one `ChefReply` and the `Consumer` commits + sends
once, atomically. So a task turn still shows nothing until the ~6s reasoner finishes.

This increment adds the **`send` tool** so the responder can reply *mid-generation* — an instant
contextual ack ("on it 🤔" or a tapback), *then* `deliberate`, *then* the result — decoupling
acknowledgment latency from work latency. Acks are contextual (not every turn), per the design.

Mid-turn sends break the single-transaction turn, so this increment also lands the durability
contract from `docs/objective-system-v2/RESPONSIVE-TURN-DESIGN.md`:

- A nullable `messages.trigger_id` column tags each outbound row with the inbound message that
  caused it.
- The cursor advances **last** (after the result), unchanged as the end-of-turn high-water mark.
- On redelivery the responder reads its own already-sent outbound for the trigger and resumes:
  **fresh** (no rows → ack maybe → deliberate → result), **acked** (ack row exists → skip ack →
  deliberate → result), **done** (result row exists → advance cursor, stop).
- Reasoner mutations are idempotent upserts; sends dedupe by `trigger_id`. This is the whole
  contract.

This is the highest-risk increment: it rewires the `Consumer`'s commit/send model. Do it last,
with the crash/resume integration test as the load-bearing check.

Key current code:
- `server/src/imessage/consumer.ts` — `handle` (drain loop, single-txn commit, effect gates,
  `dispatch`, `markRowsSent`).
- `server/src/repositories/thread-repository.ts` — `insertOutbound`, `loadUnsentOutbound`,
  `advanceCursor`, `markSent`.
- Drizzle schema for `messages` (`[ASSUMPTION: locate — server/src/db/schema or drizzle/; verify
  the store is libSQL/Turso per the current stack, not Postgres as server/CLAUDE.md still says]`).

## Objective

Give the responder a `send` tool that flushes + journals an outbound row (tagged with
`trigger_id`) mid-turn, add the `messages.trigger_id` column + index, and rework the `Consumer`
so the cursor advances after the full ack→deliberate→result sequence with correct crash/resume
and send-dedup. Preserve every existing effect gate (greet/celebrate/rename/card), task
confirmation, and completion-pop behaviour.

## Acceptance Criteria

1. **Given** a task turn where the responder acks then deliberates, **when** it runs, **then** the
   ack outbound row commits and sends **before** `deliberate` runs (verified by send ordering),
   and the result sends after.
2. **Given** a crash after the ack row commits but before the result, **when** the doorbell
   redelivers, **then** exactly **one** ack and **one** result reach the sender across both runs
   (no double-ack), and the cursor advances only after the result.
3. **Given** each outbound row, **then** it carries `trigger_id` = the inbound id that caused the
   turn (null for legacy/greeting rows).
4. **Given** a social turn (opener handles, no deliberate), **then** the cursor still advances and
   the row is tagged with `trigger_id` — the fast-path stays correct.
5. **Given** all existing effect gates (confetti greet, fireworks celebrate, rename, contact
   card), task confirmations, and completion-pop, **then** they fire exactly once with the same
   timing as before.
6. **Given** the migration, **then** it is additive (nullable column + index), backwards-compatible
   (old code ignores the column), and safe to run before the code deploys.

## Test Cases

### Test Case 1: Ack sends before deliberate (AC 1)

**Preconditions:** Integration harness with a stub `Sender` recording ordered sends, a spy
`deliberate` that records when it is invoked. A task trigger; responder configured to ack.

**Steps:**
1. Run `Consumer.handle`.

**Expected Outcomes:**
- The stub sender received the ack send at a timestamp before `deliberate` was invoked; the result
  send after.

### Test Case 2: Crash/resume sends exactly one ack and one result (AC 2) — load-bearing

**Preconditions:** Integration harness on real Turso (test db) + stub `Sender`. A task trigger.

**Steps:**
1. Run the turn but throw after the ack outbound row commits (inject a fault before the result).
2. Assert the cursor has **not** advanced.
3. Re-invoke `Consumer.handle` on the same doorbell.

**Expected Outcomes:**
- Across both runs the stub sender received exactly one ack and one result.
- After the second run the cursor has advanced past the trigger.

### Test Case 3: `trigger_id` is set on outbound rows (AC 3)

**Preconditions:** As Test Case 1.

**Steps:**
1. Run a turn; query the `messages` outbound rows.

**Expected Outcomes:**
- Each outbound row for the turn has `trigger_id` = the inbound message id.

### Test Case 4: Effect gates unchanged (AC 5)

**Preconditions:** The existing consumer effect-gate tests.

**Steps:**
1. Run the existing suite (greet/celebrate/rename/card, confirm, completion-pop).

**Expected Outcomes:**
- All pass unchanged.

### Test Case 5: Migration is additive and reversible (AC 6)

**Preconditions:** A db at the pre-migration schema.

**Steps:**
1. Run `drizzle-kit migrate`.
2. Run old code (column ignored), then new code.

**Expected Outcomes:**
- Migration applies with no data change; old and new code both run against the new schema.

## Test Run

_To be filled in during execution._

## Deployment Strategy

1. **Migration first** — add nullable `messages.trigger_id` + `idx_messages_trigger` on
   `(thread_id, trigger_id)`. Additive and backwards-compatible; deploy before the code.
2. **Code deploy** — the mid-turn-send Consumer. Behaviour change is code-only.
3. **Rollback** — revert the code to the increment-2 run-to-completion Consumer; leave the nullable
   column in place (unused, harmless). No down-migration needed.

## Production Verification

### Production Verification 1: Instant ack on a task turn

**Preconditions:** A real thread mid-objective. Logs.

**Steps:**
1. Send a message that requires real work ("plan me a week of dinners").

**Expected Outcomes:**
- A contextual ack arrives quickly (~1-2s); the substantive result follows after deliberation.
- `chef_double_send_dropped` metric stays ~0.

### Production Verification 2: No double-texting under redelivery

**Preconditions:** Same thread; induce or observe a redelivery (Vercel Queues at-least-once).

**Steps:**
1. Observe a turn where the doorbell redelivers.

**Expected Outcomes:**
- The user sees exactly one ack and one result — no duplicates.

## Production Verification Run

_To be filled in during execution._
