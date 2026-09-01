# WI-4B — Screen effects: confetti greeting + fireworks on onboarding-complete

## Background

Two iMessage screen effects make Chef feel alive at exactly two moments — a **confetti** pop when it
greets a brand-new user, and **fireworks** when the user finishes onboarding (the moment Chef promises
their first menu). Effects must be **occasional and meaningful**, never routine noise. This work item
also establishes the one-time-flag substrate the other polish actions (WI-4C) reuse.

**Note (founder decision):** the mission says "fireworks after the first meal plan is complete," but
there is **no meal-plan-generation flow over iMessage** (meal plans are HTTP-only; the onboarding
close's "first menu" is an unfulfilled promise). So fireworks fire on **onboarding-complete** — the
real signal that the profile is done.

### Verified system context

- SDK: `effect(input: ContentInput, messageEffect): ContentBuilder` (`@spectrum-ts/imessage`); effect
  names off the Sender's `this.im.effect.message.*` — `confetti` = `com.apple.messages.effect.CKConfettiEffect`,
  `fireworks` = `…CKFireworksEffect`. Send: `space.send(effect(text(body), this.im.effect.message.confetti))`.
- Consumer (`src/imessage/consumer.ts`) commits the turn in one txn then dispatches sends; it has the
  Sender + the thread + `reply.objectiveId`, and detects onboarding completion via
  `ObjectiveRepository.isComplete` → `completeAndPop` (~`consumer.ts:79-80`). A fresh thread seeds
  onboarding on the first inbound (`chef.ts` loadTurn). The outbound send path already does
  `markSent`/`setExternalId`.
- `threads` (`src/schema.ts`) has no one-time flags. The existing `sent_at` gate is the idempotency
  pattern to mirror.

## Objective

Add `Sender.sendEffect`; fire confetti on the first greeting bubble of a brand-new thread and
fireworks once on onboarding-complete; gate both with new nullable `threads` timestamp flags set in
the consumer's commit transaction so each fires exactly once (even on doorbell redelivery).

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse Sender/space; drizzle-kit migration for the flags. No new tables.

1. **`Sender.sendEffect(chatGuid, body, effectName): Promise<string[]>`** — `space.send(effect(text(body),
   effectName))`; return `normalizeSentIds`. Add to interface + SpectrumSender (import `effect` from
   `@spectrum-ts/imessage`; pass `this.im.effect.message.confetti` / `.fireworks`) + StubSpectrumSender
   (record `{chatGuid, body, effectName}`).
2. **Migration (drizzle-kit):** add nullable `threads.greeted_at` + `threads.celebrated_at`
   (integer timestamp, like `sent_at`). Update the thread model (`.nullable()`) + `ThreadRepository`
   with `markGreeted(threadId, at)` / `markCelebrated(threadId, at)` (or one generic setter); parse at
   the boundary.
3. **Confetti greeting** (consumer): on a brand-new thread's first Chef turn, when `greeted_at` is
   null, send the **first** greeting bubble via `sendEffect(chatGuid, firstBubble, confetti)` (the rest
   of the bubbles send normally), and set `greeted_at` in the commit txn. Fires exactly once.
   `[ASSUMPTION: "first greeting" = the first outbound bubble of the turn when greeted_at is null;
   only that bubble carries the effect.]`
4. **Fireworks on onboarding-complete** (consumer): when onboarding completes **this** turn
   (`isComplete`/`completeAndPop`) AND `celebrated_at` is null, send a short celebratory message via
   `sendEffect(chatGuid, "Your first menu is on its way! 🎆", fireworks)`, then set `celebrated_at`.
   Fires exactly once. **Only** these two moments use effects — never routine messages.

## Acceptance Criteria

1. Given a brand-new thread (`greeted_at` null), when Chef's first turn sends, then the first greeting
   bubble is sent via `sendEffect(confetti)` and `greeted_at` is set.
2. Given a thread already greeted, when a later turn sends, then **no** confetti (greeted_at gate holds;
   normal sends).
3. Given onboarding completes this turn (`celebrated_at` null), when the consumer runs, then a
   fireworks message is sent once and `celebrated_at` is set; a redelivered doorbell does **not**
   re-fire.
4. Migration applies forward; full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: confetti on first greeting, once (AC1, AC2)
**Preconditions:** `file:` DB; a fresh thread (greeted_at null); StubSpectrumSender; a stub chef returning a greeting turn.
**Steps:** drive the first turn; then a second turn.
**Expected Outcomes:** first turn recorded a `sendEffect(confetti)` for the first bubble + `greeted_at` set; second turn recorded no confetti (normal send).

### Test Case 2: fireworks on onboarding-complete, once (AC3)
**Preconditions:** a thread whose onboarding objective completes this turn; `celebrated_at` null.
**Steps:** drive the completing turn; then re-deliver the same doorbell.
**Expected Outcomes:** exactly one `sendEffect(fireworks)`; `celebrated_at` set; redelivery no-ops.

### Test Case 3: suite + migration (AC4)
**Steps:** `npm run db:migrate`; `npx vitest run`; `npm run typecheck`. **Expected:** applies; green; clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — a Sender method + two consumer trigger points + a two-column migration. Restart the
dev server on the merged HEAD before the real-iMessage e2e. Reset the test thread
(`scripts/reset-real-thread.ts`) to observe a fresh greeting.

## Production Verification

### Production Verification 1: confetti + fireworks on a fresh onboarding run (REQUIRED)
**Preconditions:** WI-4B merged/deployed; dev server on merged HEAD; ngrok live; test Mac paired; the
test thread reset so it's brand-new.
**Steps:** From the test Mac, send the first message (greeting) and then run onboarding to completion.
**Expected Outcomes:** On-device, Chef's **greeting** arrives with a **confetti** screen effect, and
when onboarding completes a **fireworks** effect plays with the "first menu on its way" message. Each
fires exactly once (no repeats on later messages).

## Production Verification Run

_To be filled during execution._

---

**Dependency:** builds on Phases 1-3 (merged). **Establishes the one-time-flag substrate WI-4C reuses.**
