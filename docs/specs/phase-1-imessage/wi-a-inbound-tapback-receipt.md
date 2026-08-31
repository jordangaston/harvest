# WI-A — Inbound tapback (reaction) receipt

## Background

Chef receives iMessage traffic through the native Spectrum webhook. Today the substrate only
understands **text**: `parseInbound` (`server/src/imessage/inbound.ts`) reads `content.text` and
nothing else, so a **tapback** (a reaction like 👍/❤️ on a prior message) is parsed with
`body = null`, no emoji, and no reference to the message it reacted to. Worse, the webhook still
rings the answer doorbell for it, so the consumer runs a full reasoning turn on an empty-bodied
"message" — Chef replies to a thumbs-up as if it were a request.

This work item is the **substrate half of Phase 1**: represent an inbound reaction against the
specific prior message it targets, and stop it from triggering a junk reply. It also introduces the
shared `targetGuid` field and `thread_messages.target_message_guid` column that WI-B (threaded
replies) reuses.

### Verified facts (SDK + device)

- SDK inbound content union (`@spectrum-ts/core/webhook` `slimEnvelopeSchema`; `content` is a loose
  discriminated union on `type`). The **reaction** arm is:
  `{ type: 'reaction', emoji: string, target: Message }` — `target.id` is the guid of the prior
  message reacted to. iMessage reaction kinds surface as `emoji` on the universal arm.
- Inbound path: `POST /spectrum/webhook` (`server/src/index.ts`) verifies HMAC →
  `parseInbound(rawBody)` → `InboundMessage {messageGuid, chatGuid, handle, type, body}` →
  `db.transaction` upserts user+thread and calls
  `threads.insertInboundMessage({threadId, senderUserId, type: inboundType(type), body, messageGuid})`
  → rings a doorbell keyed on `messageGuid` to `INBOUND_TOPIC`.
- Consumer (`server/src/imessage/consumer.ts`) drains pending inbound past a cursor under a
  per-thread Redlock, marks read, calls `chef.respond(threadId)`, commits outbound + slots + cursor
  in one txn, and sends text bubbles.

## Objective

Represent an inbound iMessage tapback: persist its emoji and the guid of the message it reacted to,
and ensure a reaction alone produces **no** outbound reply. Add the shared substrate
(`InboundMessage.targetGuid` + `reactionEmoji`, and the `thread_messages.target_message_guid` +
`reaction_emoji` columns) that WI-B builds on.

## Scope / implementation notes

Follow `server/CLAUDE.md`: classes with `static create()`, Zod parse at the repo boundary,
`db.transaction()` for multi-table writes, **drizzle-kit migrations only**, small methods, reuse —
no new tables, no new abstractions.

1. **`InboundMessage`** (`server/src/imessage/inbound.ts`): add optional
   `targetGuid?: string` ("the message this one refers to") and `reactionEmoji?: string`.
2. **`parseInbound`**: for the `reaction` arm, set `reactionEmoji = content.emoji`,
   `targetGuid = content.target?.id`; `body` stays `null`. Leave the `text` arm unchanged.
3. **Migration (drizzle-kit)**: add nullable `thread_messages.target_message_guid` (text) and
   `thread_messages.reaction_emoji` (text). Update `server/src/schema.ts`, then
   `npm run db:generate` → `npm run db:migrate`. Do not hand-edit SQL beyond the generated file.
4. **Persist**: thread the two new fields through `ThreadRepository.insertInboundMessage`
   (`server/src/repositories/thread-repository.ts`) so a reaction row carries
   `type=reaction`, `reaction_emoji`, `target_message_guid`.
5. **No junk reply — single chokepoint**: a bare reaction carries no request. Choose the lazier of:
   (a) the webhook persists the reaction but does **not** ring the answer doorbell for a
   reaction-type inbound; or (b) the consumer treats a pending set that is reaction-only as
   acknowledge-and-advance-cursor (no `chef.respond`). Prefer (a) if it is the smaller diff and keeps
   the "one place decides answerability" invariant. `[ASSUMPTION: (a) — skip the doorbell for
   reaction inbound — is the single-chokepoint choice; the reviewer confirms which is smaller.]`
   The reaction row still persists and marks-read on the next real turn's drain, so it remains
   available as context.

Out of scope: feeding the reaction into the reasoning briefing (Phase 4 personality decides how Chef
*uses* reactions); outbound tapbacks (Phase 4).

## Acceptance Criteria

1. Given a real reaction webhook envelope, when `parseInbound` runs, then it returns
   `type='reaction'`, `reactionEmoji` = the envelope's emoji, `targetGuid` = `content.target.id`,
   and `body = null`.
2. Given a signed reaction webhook, when it is delivered to `POST /spectrum/webhook`, then a
   `thread_messages` row persists with `type=reaction`, the emoji in `reaction_emoji`, the target
   guid in `target_message_guid`, and **no** outbound row is produced and **no** reply is sent.
3. Given a normal text message after a reaction, when the consumer drains, then it still answers the
   text turn normally (the reaction did not corrupt the cursor or the pending set).
4. Migration applies cleanly forward on a fresh DB and the existing suite stays green.

## Test Cases

### Test Case 1: parseInbound represents a reaction
**Preconditions:** A captured real reaction envelope fixture (emoji + `target.id`).
**Steps:** Call `parseInbound(fixtureBytes)`.
**Expected Outcomes:** `{ type:'reaction', reactionEmoji:'<emoji>', targetGuid:'<target guid>', body:null, messageGuid, chatGuid, handle }`.

### Test Case 2: reaction persists and yields no reply
**Preconditions:** Integration app wired to a `file:` test DB and the offline sender stub (as in existing imessage tests).
**Steps:** POST a signed reaction webhook; run the consumer path.
**Expected Outcomes:** one `thread_messages` row `type=reaction` with `reaction_emoji` + `target_message_guid` set; the stub sender recorded **zero** sends.

### Test Case 3: a text turn after a reaction still answers
**Preconditions:** As TC2, then a following signed text webhook.
**Steps:** Deliver reaction, then text; drain.
**Expected Outcomes:** the text turn produces a normal outbound reply; cursor advances past both rows.

### Test Case 4: migration + suite
**Preconditions:** Clean checkout.
**Steps:** `npm run db:migrate`; `npx vitest run`.
**Expected Outcomes:** migration applies; full suite green (no regressions).

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — additive nullable columns and a parse branch, no backfill, no flag. The migration is
forward-only and safe on the live Turso DB. Restart the dev server on the merged HEAD before the
real-iMessage verification (a stale server invalidates the check).

## Production Verification

### Production Verification 1: real tapback is represented and draws no reply (REQUIRED)
**Preconditions:** Dev server restarted on the merged HEAD; ngrok tunnel live; test Mac paired to the
Chef line. A prior Chef message exists in the thread.
**Steps:** From the test Mac, add a tapback (e.g. ❤️ or 👍) to a specific prior Chef message. Wait ~15s.
**Expected Outcomes:** In `chat.db`/the app DB, a `thread_messages` row `type=reaction` with the
emoji and `target_message_guid` equal to the reacted-to Chef message's guid. **Chef sends no reply
bubble** in response to the tapback.

## Production Verification Run

_To be filled during execution._

---

**Dependency:** none (this is the base substrate item). **WI-B branches from this item merged to main.**
