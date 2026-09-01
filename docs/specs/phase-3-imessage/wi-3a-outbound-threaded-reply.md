# WI-3A — Outbound threaded reply

## Background

Chef can receive a threaded reply (Phase 1) but cannot yet **send** one. Phase 2's import
confirmation ("Saved …" / failure) is sent as a plain message, floating free of the recipe link the
user dropped. This work item gives Chef the ability to reply **threaded** to a specific prior
message, and uses it to attach the import confirmation to the dropped-link message — the natural
demonstration of "Chef responds to a user's message as a threaded reply."

### Verified system context (re-confirm; do not contradict)

- SDK: a threaded reply is `space.send(reply(content, targetMessage))` or
  `targetMessage.reply(...content)`. The target `Message` is obtained via
  `space.getMessage(platformId): Promise<Message | undefined>` (the imessage provider —
  `SpectrumSender.markRead` already calls `space.getMessage`). "On platforms without thread support
  `reply()` is a no-op"; iMessage cloud supports it (verify on-device).
- `SpectrumSender` (`src/imessage/sender.ts`): `send(chatGuid, bodies[])` resolves
  `this.im.space.get(chatGuid)` and sends `text()` bubbles as one batch, returning platform ids.
  `StubSpectrumSender` records calls for offline tests.
- `ImportNotifier` (`src/imessage/import-notifier.ts`) direct-sends the import confirmation
  (`insertOutbound` → `sender.send` → `markSent` → `setExternalId`). `imessage_import.target_external_id`
  holds the dropped-link message's platform id (WI-2A).

## Objective

Add `Sender.sendReply(chatGuid, targetPlatformId, bodies)` (threaded reply, with graceful fallback to
a normal send if the target can't be resolved), and use it so the import confirmation is a threaded
reply to the dropped-link message.

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse the Sender/space pattern. No new tables. Do **not** change the
reasoner or the consumer ChatEvent path (the confirmation is a direct-send).

1. **`Sender.sendReply(chatGuid: string, targetPlatformId: string, bodies: string[]): Promise<string[]>`**
   on the interface + `SpectrumSender`: resolve `const target = await space.getMessage(targetPlatformId)`.
   - If `target` is found: send each body as a threaded reply in order (`target.reply(text(body))` or
     `space.send(reply(text(body), target))`), collecting the returned platform ids.
   - If `target` is **undefined** (e.g. the parent isn't retrievable): **fall back** to a normal
     `space.send(text(body))` so the message still delivers un-threaded. Return the platform ids in
     order. `[ASSUMPTION: reply per-body preserves order like the batch send; if the SDK offers a
     variadic reply, use it.]`
   - `StubSpectrumSender.sendReply` records `{ chatGuid, target, body }` per call (so tests assert the
     target) and returns deterministic ids.
2. **ImportNotifier demonstration**: its private `send(threadId, body)` gains an optional
   `threadParentId`; when `imessage_import.target_external_id` is present, call
   `sender.sendReply(chatGuid, targetExternalId, [body])`, else the current `sender.send`. Keep
   `insertOutbound` → `markSent` → `setExternalId`; record the parent on the outbound row's
   `target_message_guid` (symmetry with inbound). Pass `link.targetExternalId` through from
   `notify()`.

## Acceptance Criteria

1. Given a target message that resolves, when `sendReply` runs, then each body is sent as a threaded
   reply to that target and the sent platform ids are returned in order.
2. Given a target that does NOT resolve (`getMessage` → undefined), when `sendReply` runs, then it
   falls back to a normal send (message still delivered) and returns the ids — no throw.
3. Given a completed import with an `imessage_import.target_external_id`, when the confirmation is
   sent, then it goes out via `sendReply` to that target (threaded), and the outbound row records the
   parent in `target_message_guid`.
4. Full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: sendReply threads to a resolved target (AC1)
**Preconditions:** `StubSpectrumSender` with a stubbed `getMessage` returning a target.
**Steps:** `sendReply(chatGuid, 'spc-msg-PARENT', ['hi'])`.
**Expected Outcomes:** the stub records the send with target `spc-msg-PARENT`; returns one id.

### Test Case 2: sendReply falls back when target missing (AC2)
**Preconditions:** stub `getMessage` → undefined.
**Steps:** `sendReply(chatGuid, 'missing', ['hi'])`.
**Expected Outcomes:** a normal send occurred (no target), one id returned, no throw.

### Test Case 3: ImportNotifier threads the confirmation (AC3)
**Preconditions:** `file:` DB; a job with an `imessage_import` link whose `target_external_id = 'spc-msg-PARENT'`; a persisted recipe; `StubSpectrumSender`.
**Steps:** run `notify(jobId, 'ready')`.
**Expected Outcomes:** the stub recorded a `sendReply` to `spc-msg-PARENT`; the outbound row's `target_message_guid = 'spc-msg-PARENT'`; `notified_at` set.

### Test Case 4: suite (AC4)
**Steps:** `npx vitest run`; `npm run typecheck`.
**Expected Outcomes:** green; clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — a new Sender method + an ImportNotifier tweak; no schema change. Restart the dev
server on the merged HEAD before the real-iMessage verification.

## Production Verification

### Production Verification 1: import confirmation threads to the dropped-link message (REQUIRED)
**Preconditions:** WI-3A merged/deployed; dev server on the merged HEAD; ngrok live; test Mac paired.
**Steps:** From the test Mac, drop a recipe link and let the import complete.
**Expected Outcomes:** The "Saved …" (or failure) confirmation appears on-device as a **threaded
reply attached to the original dropped-link message** (not a free-floating bubble). In the DB, the
confirmation's outbound row records the dropped-link message's platform id as its parent.

## Production Verification Run

_To be filled during execution._

---

**Dependency:** builds on Phases 1+2 + WI-C (merged). **WI-3B branches from this item merged.**
