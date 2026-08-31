# WI-06 — The Chef facade & consumer integration

## Background

Increment 1 shipped a stub chef behind a `Chef` seam the consumer already calls
(`src/imessage/chef.ts`, `src/imessage/consumer.ts`). The inc-1 `Chef.respond(ctx)` takes a
`ChefContext` (pending texts) and returns a plain reply string; the consumer assembles that
context, calls the chef, and commits a single outbound row. That was enough to walk the pipe.

Increment 2 fills the seam with the real reasoning layer — objectives, a slot scoreboard,
validated command runners, an interruption barrier — and makes the household first-class. The
design (`docs/imessage-onboarding/increment-2-reasoning-and-onboarding.md`, esp. "The Chef",
"The turn", "Inside `chef.respond`", D2-7) tightens the boundary so the consumer sees **only** the
`Chef`: it hands the Chef one thing — the thread id — and the Chef loads its own context
(active objective, unfilled slots, transcript, members, pending inbound past the cursor), reasons,
renders, and returns what to commit and send. Reasoning, response, the briefing, the `ReplyPlan`,
and the interruption restart are all Chef-internal and never leak to the consumer.

This work item is the **facade and the wiring**: the `Chef` interface change, `selectChef(db)`,
the interruption barrier, and the consumer edit that commits a `ChefReply` in one transaction. The
reasoning agent (WI-04), response agent (WI-05), `ObjectiveStore` + `objectives`/`slots` schema
(WI-01/02), and the onboarding objective (WI-07) are their own work items; WI-06 depends on them
and composes them behind the facade.

## Objective

Replace the inc-1 stub internals so that:

1. `Chef.respond(threadId: string): Promise<ChefReply | null>` loads its own context, runs
   reasoning → response → the interruption barrier, and returns
   `{ chatEvents, slotUpdates, cursorTo }` — or `null` when nothing is pending to answer.
2. `selectChef(db)` returns the real `Chef` (wired to the reasoning + response agents,
   `ObjectiveStore`, and repos) when the model keys are present, else a `StubChef` (a fixed reply,
   no network), mirroring `selectSender`/`selectThreadLock`.
3. `src/imessage/consumer.ts` calls `chef.respond(threadId)` and commits the reply
   (`chatEvents` → outbound rows, `slotUpdates`, `cursor = cursorTo`) in **one** `db.transaction`,
   then sends the unsent rows — all under the existing Redlock lock and `sender.responding()`
   typing wrap. The consumer imports **only** `Chef` + `selectChef` from the agent.
4. The interruption barrier re-checks for newer inbound before returning and restarts (bounded at
   2, then returns anyway) — D-13.
5. The inc-1 substrate integration tests still pass unchanged.

## Types (the whole boundary)

```ts
// src/imessage/chef.ts — the consumer's entire view of the agent.
interface Chef {
  // Load the thread's context, reason (validated tool writes), render the reply, and return
  // what the consumer must commit and send. null when nothing is pending to answer.
  respond(threadId: string): Promise<ChefReply | null>;
}

type ChefReply = {
  chatEvents: ChatEvent[];   // bubbles/tapbacks → outbound rows to commit + send
  slotUpdates: SlotUpdate[]; // slot status changes to apply in the commit tx
  cursorTo: string;          // advance the thread's last_processed_id to here
};

function selectChef(db: Database): Chef; // real Chef with model keys, else StubChef
```

`ChatEvent` and `SlotUpdate` are defined by WI-05 (response) and WI-01 (slots) respectively; WI-06
consumes them. `ChatEvent` for increment 2 is a text bubble (`respond_with_text`) or a tapback
(`react_with_tapback`); a bubble maps to a `direction=outbound`, `type=text`,`sent_at=NULL` row,
and a tapback to a `type=reaction` row.

[ASSUMPTION: `ChatEvent` carries at least `{ kind: "text"; body: string }` and
`{ kind: "reaction"; targetMessageGuid: string; tapback: string }`; WI-05 owns the exact shape.
WI-06's consumer only needs enough to mint an outbound `thread_messages` row per event and set its
`type`. If WI-05 lands a different shape, WI-06 adapts the `chatEvents → rows` mapping only.]

[ASSUMPTION: `SlotUpdate` is `{ slotId?: string; key: string; memberUserId?: string | null;
status: "asked" | "filled" | "defaulted"; value?: unknown }` and `ObjectiveStore.applySlotUpdates`
(WI-01) enforces the invariant "a value-bearing slot becomes `filled` only if its value landed
through a successful command". WI-06 passes the updates through inside the tx; it does not
re-implement the invariant.]

## Inside `chef.respond` (the consumer never sees this)

Per the design's "Inside `chef.respond`":

1. **Load context** — the thread's active objective + its unfilled slots (via `ObjectiveStore`),
   the recent transcript from `thread_messages`, the household members, and the pending inbound
   past the cursor. Nothing pending ⇒ return `null`.
2. **`prepareBriefing`** (WI-04/briefing) assembles L1/L2/L3 and resolves the objective's resident
   tools.
3. **Reasoning agent** (WI-04) runs the Mastra tool loop → a `ReplyPlan` + `slotUpdates`.
4. **Response agent** (WI-05) renders the plan + transcript window → `chatEvents`.
5. **Interruption barrier** — re-check for newer inbound past what step 1 loaded; on a hit, discard
   the plan + render and restart from step 1 against the fuller conversation (max 2 restarts, then
   return anyway).
6. **Return** `{ chatEvents, slotUpdates, cursorTo }` (cursor = newest processed inbound), or
   `null`.

The barrier's newer-inbound check is injectable so it is unit-testable without a race:
`isInterrupted(loadedCursor): Promise<boolean>` (default reads `thread_messages` for a row past
`loadedCursor`).

## Acceptance Criteria

**AC-1 — the consumer's imports are minimal.** `src/imessage/consumer.ts` imports only `Chef` and
`selectChef` from the agent — nothing from reasoning, response, briefing, the objective store, or
the `ReplyPlan`. A grep of `consumer.ts` for `reasoning`, `response-agent`, `briefing`,
`ReplyPlan`, or `objective-store` returns no import.

**AC-2 — `respond` returns null when nothing is pending → no commit, no send.** When
`chef.respond(threadId)` returns `null`, the consumer commits no transaction and calls the sender's
`send` zero times for that turn.

**AC-3 — a turn commits the whole reply atomically.** When the (stub) chef returns a `ChefReply`
with N `chatEvents` and M `slotUpdates`, the consumer commits, in ONE `db.transaction`: N outbound
`thread_messages` rows (`sent_at NULL`), the M slot updates applied via `ObjectiveStore`, and the
cursor advanced to `cursorTo`. If the transaction throws, none of the three are persisted.

**AC-4 — sends happen after the commit, under the typing wrap, gated by `sent_at`.** After the
commit, each `sent_at NULL` outbound row is sent once via the sender and stamped `sent_at`; the
whole call is inside `sender.responding()` and the Redlock `withThreadLock`. A redelivered doorbell
re-sends nothing (the `sent_at` gate).

**AC-5 — the interruption restart is bounded at 2.** With an injected `isInterrupted` that returns
`true`, `respond` restarts the reason→render at most twice, then returns the reply from the third
attempt. Reasoning/response are invoked at most 3 times total.

**AC-6 — `selectChef(db)` mirrors the env-select pattern.** With no model key in env,
`selectChef(db)` returns a `StubChef` that makes no network call and returns a fixed `ChefReply`;
with the key present it returns the real `Chef`. Same shape as `selectSender`/`selectThreadLock`.

**AC-7 — the inc-1 substrate integration tests still pass.** `test/imessage-substrate.test.ts`
(happy path, duplicate inbound, redelivered doorbell, bad-signature 401, senderless) passes
unchanged after the consumer is rewired, using a `StubChef`.

## Test Cases

Offline throughout: `StubChef` + `migratedFileDb()` + a stub sender + an in-memory queue. No
network. Tests live in `test/imessage-consumer-logic.test.ts` (extended) and
`test/imessage-substrate.test.ts` (unchanged, re-run).

### Test Case 1: Consumer imports only the Chef facade (AC-1)

**Preconditions:** the rewired `src/imessage/consumer.ts`.

**Steps:** grep the file's import statements for `reasoning`, `response-agent`, `briefing`,
`ReplyPlan`, `objective-store`, `mastra`.

**Expected Outcomes:** zero matches; the only agent import is `{ Chef, selectChef } from './chef.js'`.

### Test Case 2: Null reply → no commit, no send (AC-2)

**Preconditions:** a migrated file db with a thread and no pending inbound past the cursor; a
`StubChef` whose `respond` returns `null`; a spy sender.

**Steps:** call `handleDoorbell({ threadId }, deps)`.

**Expected Outcomes:** no outbound row written, cursor unchanged, `sender.send` called 0 times.

### Test Case 3: A stub-chef turn commits N rows + M slot updates + advances the cursor (AC-3, AC-4)

**Preconditions:** a migrated file db with a thread, an active `onboarding` objective + its slots
(seeded via `ObjectiveStore`), and two pending inbound messages; a `StubChef` returning a
`ChefReply` with 2 `chatEvents` (text bubbles), 2 `slotUpdates` (one `asked`, one `filled` with a
value that has a matching landed write), `cursorTo` = the newer pending message's id; a spy sender.

**Steps:** call `handleDoorbell`; then query `thread_messages`, the `slots` rows, and
`threads.last_processed_id`.

**Expected Outcomes:** 2 outbound rows exist (both later `sent_at` set after send); the two slots
reflect their new status/value; `last_processed_id = cursorTo`; `sender.send` called twice, once
per bubble.

### Test Case 4: Commit is atomic — a failing slot update rolls back the rows (AC-3)

**Preconditions:** same as TC3, but the seeded `slotUpdates` include one that violates the
`ObjectiveStore` invariant (marks a value-bearing slot `filled` with no landed write) so
`applySlotUpdates` throws inside the tx.

**Steps:** call `handleDoorbell`; expect it to throw / the doorbell to be retried; then query
`thread_messages` and the cursor.

**Expected Outcomes:** no outbound rows written, cursor unchanged — the whole tx rolled back.

### Test Case 5: Interruption restart bounded at 2 (AC-5)

**Preconditions:** a `Chef` built with stub reasoning + response spies (counting calls) and an
injected `isInterrupted` that always returns `true`.

**Steps:** call `chef.respond(threadId)` on a thread with one pending message.

**Expected Outcomes:** reasoning + response each invoked exactly 3 times (initial + 2 restarts);
`respond` returns the third attempt's reply, not `null`.

### Test Case 6: `selectChef(db)` returns StubChef offline (AC-6)

**Preconditions:** env with no model key.

**Steps:** call `selectChef(db)`; call `.respond(threadId)` for a thread with a pending message.

**Expected Outcomes:** the returned object is a `StubChef`; `respond` makes no network call and
returns a fixed non-null `ChefReply`.

### Test Case 7: Inc-1 substrate suite still green (AC-7)

**Preconditions:** `test/imessage-substrate.test.ts` unchanged except for constructing `deps.chef`
via the inc-2 `StubChef`.

**Steps:** run the substrate suite.

**Expected Outcomes:** all inc-1 cases (happy, duplicate inbound, redelivered doorbell, bad
signature 401, senderless) pass.

## Test Run

_To be filled by the implementer._ Run:

```
cd server && npm test -- imessage-consumer-logic
cd server && npx vitest run --config vitest.e2e.config.ts imessage-substrate
```

Record command output and a pass/fail line per test case above.

## Deployment Strategy

Code-only change on branch `jordangaston/imessage-increment-2`; no schema in this WI (schema is
WI-01/02, deployed ahead of it). The consumer edit is backwards-compatible with the inc-1 substrate
(the doorbell contract, the lock, the `sent_at` gate, `ThreadRepository` are unchanged). Deploy the
agent code dormant — it only runs the real reasoning path once a thread has an active objective and
model keys are set; until then `selectChef` returns `StubChef`. Rollback is an independent code
revert; the additive schema stays.

## Production Verification

### Production Verification 1: A real onboarding turn commits and sends via the facade

**Preconditions:** the deploy live with model keys set; a dedicated Photon line; a test iMessage
thread with no active objective yet.

**Steps:** text the Harvest number a first message; observe the server logs and the DB.

**Expected Outcomes:** logs show `chef.respond(threadId)` called once for the turn (no
reasoning/response symbols named by the consumer); one commit writes the outbound rows + slot
updates + cursor together; the reply bubble(s) arrive on the phone; a redelivered doorbell (forced
retry) sends nothing new.

### Production Verification 2: Nothing pending → no reply

**Preconditions:** the same thread after its last message is already processed (cursor caught up).

**Steps:** trigger a duplicate doorbell for the already-processed message.

**Expected Outcomes:** `respond` returns null; no outbound row, no send, no cursor change in the
logs.

## Production Verification Run

_To be filled after the live round-trip on the dedicated Photon line._
