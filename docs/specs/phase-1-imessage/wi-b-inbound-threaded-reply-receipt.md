# WI-B — Inbound threaded-reply receipt

## Background

iMessage lets a user **swipe-reply** to a specific prior message, creating a threaded reply that
visually points at its parent. Chef should receive that reply's text **and** know which prior
message it answers.

Today the substrate loses both. `parseInbound` (`server/src/imessage/inbound.ts`) only reads
`content.text`, but a reply's own text is nested at `content.content.text`, and the parent it points
at is at `content.target.id`. So a threaded reply currently arrives with `body = null` (text lost)
and no parent reference — the consumer runs a reasoning turn on an empty body.

This is the **second substrate item of Phase 1**. It reuses the `targetGuid` field and the
`thread_messages.target_message_guid` column introduced by **WI-A**.

### Verified facts (SDK)

- SDK inbound **reply** arm (`@spectrum-ts/core/webhook` `slimEnvelopeSchema`):
  `{ type: 'reply', content: <a nested non-control content arm, e.g. text>, target: Message }`.
  The reply's own text is `content.content.text`; the **parent** message guid is `content.target.id`.
- WI-A already added `InboundMessage.targetGuid`, `thread_messages.target_message_guid`, and threaded
  those through `ThreadRepository.insertInboundMessage`.
- Reasoning briefing is built in `server/src/chef/briefing.ts` (objective + slots + members +
  recent transcript + trigger) and drives `chef.respond(threadId)` via the consumer.

## Objective

Capture a threaded reply's text and its parent message guid, so the reply flows to reasoning like a
normal turn **and** Chef can see which prior message it responds to.

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse WI-A's field and column — **no** new columns or tables.

1. **`parseInbound`** (`server/src/imessage/inbound.ts`): for the `reply` arm, set
   `body = content.content?.text` (the reply's own text) and `targetGuid = content.target?.id` (the
   PARENT guid). This fixes the lost-reply-text bug. `[ASSUMPTION: the nested arm is text; if a reply
   wraps a non-text arm, body falls back to null and the turn still runs — acceptable for Phase 1.]`
2. **Persist**: the reply row stores its text in `body` and the parent guid in
   `target_message_guid` (already wired by WI-A) — a reply is a normal answerable inbound, so it
   **does** ring the doorbell and reach the consumer.
3. **Briefing context (minimal)**: in `server/src/chef/briefing.ts`, when the triggering inbound has
   a `target_message_guid`, include a one-line reference to the parent message it replies to (look up
   the parent row's body via `ThreadRepository`), e.g. `↳ replying to: "<parent snippet>"`, so the
   reasoning model knows the referent. Keep it to the smallest readable addition; do not restructure
   the briefing.

Out of scope: outbound threaded replies from Chef (Phase 3).

## Acceptance Criteria

1. Given a real reply webhook envelope, when `parseInbound` runs, then `body` = the reply's own text
   (`content.content.text`), `targetGuid` = `content.target.id`, `type='reply'`.
2. Given a signed reply webhook, when delivered, then a `thread_messages` row persists with the reply
   text in `body` and the parent guid in `target_message_guid`, and it triggers a normal reasoning
   turn (an outbound reply is produced).
3. Given a reply whose parent message exists in the thread, when the reasoning briefing is built,
   then it includes a reference to the parent message's content.
4. The existing suite stays green (WI-A migration already in place; no new migration).

## Test Cases

### Test Case 1: parseInbound captures nested text + parent guid
**Preconditions:** A captured real reply envelope fixture (nested text arm + `target.id`).
**Steps:** Call `parseInbound(fixtureBytes)`.
**Expected Outcomes:** `{ type:'reply', body:'<reply text>', targetGuid:'<parent guid>', messageGuid, chatGuid, handle }`.

### Test Case 2: reply persists with parent and answers
**Preconditions:** Integration app on a `file:` test DB + offline sender stub + a stub chef (as in existing imessage tests).
**Steps:** Seed a prior outbound (the parent) with a known guid; POST a signed reply webhook targeting it; drain the consumer.
**Expected Outcomes:** one `thread_messages` row `type=reply` with the reply text in `body` and `target_message_guid` = the parent guid; the chef is invoked and an outbound reply is produced.

### Test Case 3: briefing references the parent
**Preconditions:** A thread with a parent message and a reply row pointing at it.
**Steps:** Build the briefing for the reply turn.
**Expected Outcomes:** the briefing text contains a reference to the parent message's content (snippet).

### Test Case 4: suite
**Steps:** `npx vitest run`.
**Expected Outcomes:** full suite green.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — a parse branch and a small briefing addition, no schema change (WI-A's columns
already deployed). Restart the dev server on the merged HEAD before the real-iMessage verification.

## Production Verification

### Production Verification 1: real threaded reply reaches Chef with parent context (REQUIRED)
**Preconditions:** WI-A merged and deployed; dev server restarted on the merged HEAD; ngrok live;
test Mac paired. A specific prior Chef message exists to reply to.
**Steps:** From the test Mac, swipe-reply to that specific Chef message with a text question (e.g.
reply "make it vegetarian" to a menu message). Wait for Chef's reply.
**Expected Outcomes:** In the app DB, a `thread_messages` row `type=reply` with the reply text in
`body` and `target_message_guid` = the replied-to message's guid. Chef sends a **coherent** reply
that reflects the reply text (proving the text was not lost).

## Production Verification Run

_To be filled during execution._

---

**Dependency:** **WI-A** (inbound tapback receipt) — branch this item from WI-A merged to `main`; it
relies on `InboundMessage.targetGuid` and the `thread_messages.target_message_guid` column.
