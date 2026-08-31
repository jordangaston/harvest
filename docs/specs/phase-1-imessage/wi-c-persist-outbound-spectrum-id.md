# WI-C — Persist the outbound Spectrum message id (external id)

## Background

The Phase-1 real-device e2e surfaced a substrate gap. When a user swipe-replies or tapbacks a
**Chef** message, the inbound event's `target.id` is the **Spectrum platform id** of that Chef
message (e.g. `spc-msg-8b93ff1b-…`). But Chef's outbound rows are persisted with a **random UUID**
`message_guid`, because the consumer inserts and commits the outbound row (with slot updates + cursor,
in one transaction) **before** the network send — at which point no platform id exists yet. The real
platform id **is** returned by `space.send()`, but the current sender discards it.

Consequence (observed live): `ThreadRepository.findByMessageGuid(threadId, target)` cannot find a
Chef message by the reply's `target`, so WI-B's briefing parent-snippet (`↳ replying to: "…"`)
silently omits, and neither WI-A nor WI-B can resolve a target that points at a Chef message.
Inbound rows already store the real platform id (in `message_guid`); only outbound is missing it.

This is a **substrate addendum to Phase 1** and a **prerequisite for Phase 3** (Chef sending an
outbound threaded reply requires the target message's platform id).

### Verified system context

- Consumer (`server/src/imessage/consumer.ts`): `insertOutbound({ threadId, body, messageGuid:
  randomUUID() })` inside the turn transaction → after commit, `loadUnsentOutbound` →
  `sender.send(chatGuid, bodies[])` (one ordered batch) → `markSent(row.id, now)` per row.
- Sender (`server/src/imessage/sender.ts`): `SpectrumSender.send` calls `space.get(chatGuid)` then
  the variadic `space.send(...contents)` and **discards the return**. `StubSpectrumSender` records
  calls for offline tests.
- SDK: `space.send(...contents)` returns the sent `Message`(s), each with a platform `.id`. For a
  batch it returns `Message[]`. **The implementer MUST confirm against
  `server/node_modules/@spectrum-ts/` (and the live wire at e2e) that the return is in input order,
  one element per bubble, before mapping ids back to rows** — do not assume.
- WI-B added `ThreadRepository.findByMessageGuid(threadId, messageGuid)` and the briefing
  `replyingTo` lookup (`server/src/chef/briefing.ts`, `server/src/imessage/chef.ts`).

## Objective

Persist each outbound message's Spectrum platform id in a new nullable `thread_messages.external_id`
column, and resolve reply/reaction targets against it — so a reply/tapback that points at a Chef
message resolves to that message (fixing WI-B's parent-snippet for replies-to-Chef and enabling
Phase-3 outbound replies).

## Scope / implementation notes

Follow `server/CLAUDE.md`. Keep it minimal — one nullable column, a sender return-type change, one
post-send write, one resolution tweak. No new tables. No backfill of historical rows (forward-only;
old Chef rows stay unresolved — acceptable). Do **not** change the outbound idempotency model (the
`sent_at` gate stays; `message_guid` stays the internal key).

1. **Schema/migration (drizzle-kit):** add nullable `thread_messages.external_id` (text) — the
   platform message id. Update `server/src/schema.ts` and add `.nullable()` to `ThreadMessageSchema`
   (`server/src/models/thread-message.ts`), then `npm run db:generate` + `npm run db:migrate`. Do not
   hand-edit generated SQL. `[ASSUMPTION: setting external_id on inbound rows too (= message.id) is
   optional; resolution can fall back to message_guid, so inbound-side is the implementer's lazy
   choice.]`
2. **Sender** (`server/src/imessage/sender.ts`): change the `Sender` interface + `SpectrumSender.send`
   return type from `Promise<void>` to `Promise<string[]>` — the sent platform ids in send order.
   Keep the single ordered-batch send. `StubSpectrumSender.send` returns deterministic synthetic ids
   (e.g. one per body) for offline tests.
3. **Consumer** (`server/src/imessage/consumer.ts`): after the batch send, persist each unsent row's
   `external_id` from the returned ids, mapped by batch order (extend `markSent` or add
   `ThreadRepository.setExternalId` — pick the smaller diff). **Defensive:** if the return has fewer
   ids than bubbles (or none), set `external_id` only for rows whose id is unambiguously known; leave
   the rest null. Never mis-assign.
4. **Target resolution:** the reply/reaction parent lookup must resolve a target pointing at a Chef
   outbound message — update `findByMessageGuid` to match a row whose `external_id` **OR**
   `message_guid` equals the target (rename to `findByPlatformId` if clearer). This makes WI-B's
   parent-snippet resolve for replies-to-Chef and lets WI-A/B represent targets that point at Chef
   messages.

## Acceptance Criteria

1. **AC1** — Given Chef sends a turn's bubbles, when the batch send returns platform ids, then each
   corresponding outbound `thread_messages` row has `external_id` set to its platform id, in order.
2. **AC2** — Given a Chef outbound row with a known `external_id`, when an inbound reply targets that
   `external_id`, then `findByPlatformId` resolves the parent row and the briefing includes the
   parent snippet (WI-B's `↳ replying to: "…"` now works for replies-to-Chef).
3. **AC3** — Given the send returns fewer ids than bubbles (or none), when the consumer persists,
   then it does not crash or mis-assign; rows without a known id keep `external_id = null`.
4. **AC4** — Migration applies forward cleanly; full server suite green (`npx vitest run`, 0 failed);
   `npm run typecheck` clean.

## Test Cases

### Test Case 1: outbound external_id captured in order (AC1)
**Preconditions:** Integration app on a `file:` test DB; `StubSpectrumSender` returning synthetic ids `['ext-0','ext-1']` for a two-bubble turn.
**Steps:** Drive a turn that emits two outbound bubbles; drain the consumer.
**Expected Outcomes:** the two outbound rows have `external_id` `ext-0`, `ext-1` matching bubble order; `sent_at` set.

### Test Case 2: reply-to-Chef resolves the parent + briefs (AC2)
**Preconditions:** Seed a Chef outbound row with `external_id = 'spc-msg-PARENT'`.
**Steps:** POST a signed reply webhook with `target.id = 'spc-msg-PARENT'`; build the briefing for that turn.
**Expected Outcomes:** `findByPlatformId(threadId,'spc-msg-PARENT')` returns the Chef row; the briefing text contains the parent snippet.

### Test Case 3: degraded send return (AC3)
**Preconditions:** `StubSpectrumSender` returning `[]` (or one id for a two-bubble turn).
**Steps:** Drain a two-bubble turn.
**Expected Outcomes:** no throw; rows without a known id have `external_id = null`; the known one (if any) is set correctly.

### Test Case 4: suite + migration (AC4)
**Steps:** `npm run db:migrate`; `npx vitest run`; `npm run typecheck`.
**Expected Outcomes:** migration applies; suite green; typecheck clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — one additive nullable column, a sender return-type change, one post-send write, one
resolution tweak. Forward-only, no backfill. Restart the dev server on the merged HEAD before the
real-iMessage verification.

## Production Verification

### Production Verification 1: reply-to-Chef resolves on a real device (REQUIRED)
**Preconditions:** WI-C merged + deployed; dev server restarted on the merged HEAD; ngrok live; test
Mac/founder paired. A fresh Chef message exists (sent after WI-C deploy, so it has an `external_id`).
**Steps:** From the device, swipe-reply to that specific Chef message with a short text.
**Expected Outcomes:** In the live DB, the Chef message row's `external_id` equals the reply's
`target_message_guid`; `findByPlatformId` resolves it; Chef's reply reflects awareness of which
message was replied to (parent snippet resolved). No regression: a tapback still draws no reply
(WI-A), and normal text turns answer normally.

## Production Verification Run

_To be filled during execution._

---

**Dependency:** builds on **WI-A** + **WI-B** (merged to `main`). Branch from current `main`.
