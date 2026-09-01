# WI-4A — Outbound tapbacks + emoji personality

## Background

Chef texts users during onboarding but only ever sends plain text. Real people acknowledge and
appreciate with **tapbacks** (native iMessage reactions) and colour tone with the occasional emoji.
This work item gives Chef a tasteful, generationally-aware reaction/emoji style: react when
acknowledging or appreciating, reply when content is expected, and never send the tapbacks/emoji that
read as passive-aggressive or dated.

The style rules are codified (from `/deep-research`) in
**`docs/imessage-onboarding/chef-tapback-emoji-style.md`** — the authoritative rule set for this WI.

### Verified system context

- SDK: `reaction(emoji, target): ReactionBuilder` (`@spectrum-ts/core`); resolve the target via
  `space.getMessage(platformId)`; the `Emoji` map (`love ❤️, like 👍, dislike 👎, laugh 😂, emphasize ‼️,
  question ❓`) — the six native tapback kinds. Send: `space.send(reaction(Emoji.love, target))`.
- `SpectrumSender` (`src/imessage/sender.ts`) resolves `this.im.space.get(chatGuid)` per method;
  `normalizeSentIds` helper; `getMessage` already used by `markRead`/`sendReply`.
- The `ChatEvent` union (`src/chef/types.ts`) **already has** `{ kind:'tapback'; target: string; emoji }`
  (`TAPBACK_EMOJIS = love/like/dislike/laugh/emphasize/question`). `thread_messages` already has
  `type='reaction'`, `reaction_emoji`, `target_message_guid` columns, and `external_id`.
- Gaps: the live **`MastraResponder`** (`src/chef/response-agent.ts`) emits **text only** (drops
  tapbacks), though the reasoner can set `plan.address` and `ScriptedResponder` emits a tapback when it
  is set. The **consumer** (`src/imessage/consumer.ts`) skips non-text/non-richlink events.

## Objective

Let Chef send native tapbacks (allowed kinds only) driven by the reasoner's `plan.address`, dispatched
through the consumer, and codify the react-vs-reply + emoji rules into the prompt.

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse the Sender/space pattern + the existing reaction columns. No new
tables.

1. **`Sender.sendReaction(chatGuid, targetPlatformId, emoji): Promise<void>`** — resolve
   `space.getMessage(targetPlatformId)`; if found, `space.send(reaction(emoji, target))`; if not found,
   **no-op** (a tapback with no resolvable target can't be sent). Add to the interface + SpectrumSender
   + StubSpectrumSender (record `{chatGuid, target, emoji}`).
2. **Consumer dispatch of the `tapback` event**: in the commit txn, persist a tapback event via
   `insertOutbound` with `type='reaction'`, `reaction_emoji` = the glyph (map the tapback **kind** →
   `Emoji` glyph), `target_message_guid = event.target` (a platform `external_id`). In the send/dispatch
   phase, add a reaction branch → `sender.sendReaction(chatGuid, target, glyph)`. The row's `sent_at`
   gate is its per-message idempotency (no new state).
3. **Emission — make `MastraResponder` honor `plan.address`**: when the plan addresses a message (an
   acknowledge/appreciation intent), emit `{ kind:'tapback', target: <addressed message external_id>,
   emoji: <kind> }` choosing the kind per the style (**love / laugh / emphasize**; **never like or
   dislike**). **Grounding (critical):** the target must be a **real** message's platform
   `external_id` (resolve the addressed message via `findByPlatformId` / the turn's known message ids)
   — never a hallucinated id. If the addressed message can't be resolved, fall back to a text reply.
4. **Codify the style** into the reasoner/responder prompt(s): react-vs-reply, ❤️ like / 😂 humor / ‼️
   excitement, **never 👍**, "got it" = a short warm **text**, emoji sparse + congruent, avoid
   😂/😭/🙂 in text. Reference `chef-tapback-emoji-style.md`.

## Acceptance Criteria

1. Given a `tapback` ChatEvent with a resolvable target, when the consumer dispatches, then a
   `type='reaction'` row persists (`reaction_emoji`, `target_message_guid`) and `sendReaction` is
   called with the target + glyph.
2. Given `sendReaction` with an unresolvable target, when it runs, then it no-ops without throwing.
3. Given the reasoner addresses a message with an acknowledge/appreciation intent, when
   `MastraResponder` renders, then it emits a `tapback` event of an **allowed** kind (love/laugh/
   emphasize) — **never like or dislike** — targeting a real message `external_id`.
4. Full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: consumer dispatches a tapback (AC1)
**Preconditions:** `file:` DB; a stub chef returning a reply with `{kind:'tapback', target:'spc-msg-X', emoji:'love'}`; StubSpectrumSender.
**Steps:** drive the consumer.
**Expected Outcomes:** a `type='reaction'` row (`reaction_emoji='❤️'`, `target_message_guid='spc-msg-X'`); the stub recorded `sendReaction('spc-msg-X','❤️')`.

### Test Case 2: unresolvable target no-ops (AC2)
**Steps:** `sendReaction(chatGuid, 'missing', '❤️')` with stub `getMessage`→undefined.
**Expected Outcomes:** no throw; no send recorded.

### Test Case 3: responder emits an allowed tapback (AC3)
**Preconditions:** a ReplyPlan with an acknowledge intent + `address` set to a known message external_id.
**Steps:** render via `MastraResponder` (structured output stubbed to that plan).
**Expected Outcomes:** a `tapback` event with `emoji ∈ {love,laugh,emphasize}` (never like/dislike), `target` = the real external_id.

### Test Case 4: suite (AC4)
**Steps:** `npx vitest run`; `npm run typecheck`. **Expected:** green; clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — a Sender method, a consumer dispatch branch, a responder emission, and prompt copy. No
schema change (reaction columns already exist). Restart the dev server on the merged HEAD before the
real-iMessage e2e.

## Production Verification

### Production Verification 1: Chef sends a tapback on a real device (REQUIRED)
**Preconditions:** WI-4A merged/deployed; dev server on the merged HEAD; ngrok live; test Mac paired.
**Steps:** Run an onboarding turn or two from the test Mac where Chef would naturally acknowledge/
appreciate a low-stakes answer.
**Expected Outcomes:** Chef sends at least one **tapback** on a user message — an **allowed** kind
(heart/laugh/emphasize) — observed in `chat.db` as an associated reaction (`associated_message_guid` /
`associated_message_type`) on the correct message. Chef does **not** send a 👍 thumbs-up.

## Production Verification Run

_To be filled during execution._

---

**Dependency:** builds on Phases 1-3 (merged). Independent of WI-4B/4C. **Style:** `chef-tapback-emoji-style.md`.
