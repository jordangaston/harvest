# WI-4C — Chat rename (guarded) + native contact card

## Background

Two final polish touches: rename the chat to **"Meal Planning"** once the household is created, and
send Chef's **contact card** after the onboarding celebration so the user can save Chef. Both are
one-time lifecycle actions, reusing WI-4B's one-time-flag substrate.

### Verified system context + constraints

- **Rename** (`@spectrum-ts/core`): `space.rename(displayName): Promise<void>`. **⚠ Works ONLY on
  remote GROUP chats — a 1:1 DM throws `UnsupportedError`.** The space carries `type: 'dm' | 'group'`.
  Onboarding is usually a 1:1 DM, so rename will typically **no-op** — this is expected (founder
  decision: build it guarded).
- **Contact card** (`@spectrum-ts/imessage`): `nativeContactCard(): ContentBuilder` — shares the
  **line's own Apple-account name + photo**; the founder has configured the line identity to read as
  **"Chef"** in the Photon portal. Send: `space.send(nativeContactCard())`. Fire-and-forget.
- `create_household` (`src/chef/tools/create-household.ts`) sets `ctx.householdId` (null→set) on the
  first household creation; the tool has **no Sender**, so the rename must fire from the **consumer**,
  which can see the thread's `householdId` go null→set this turn. The consumer also detects
  onboarding-complete (WI-4B) — the contact card sends at that same moment, after the fireworks.
- WI-4B added `threads.greeted_at`/`celebrated_at` + `markGreeted`/`markCelebrated`.

## Objective

Add `Sender.renameChat` (guarded to group chats) and `Sender.sendContactCard`; rename to "Meal
Planning" once after household creation (no-op on DMs), and send the native "Chef" contact card once
after the onboarding fireworks — each gated by a one-time `threads` flag.

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse the Sender/space pattern + WI-4B's flag substrate. drizzle-kit
migration for the new flag(s). No new tables.

1. **`Sender.renameChat(chatGuid, name): Promise<void>`** — resolve the space; if
   `space.type === 'group'`, `space.rename(name)`; else **no-op**. Wrap defensively (also catch
   `UnsupportedError`) so a DM never throws. Add to interface + impls.
2. **`Sender.sendContactCard(chatGuid): Promise<void>`** — `space.send(nativeContactCard())` (import
   from `@spectrum-ts/imessage`). Fire-and-forget. Add to interface + impls.
3. **Migration:** add nullable `threads.renamed_at` (+ `carded_at`, or reuse `celebrated_at` if the
   card always co-fires with fireworks — implementer picks; separate `carded_at` is cleaner). Model +
   repository setters, parsed at the boundary.
4. **Rename trigger** (consumer): when the thread's `householdId` went null→set **this** turn (a
   household was just created) AND `renamed_at` is null, call `renameChat(chatGuid, "Meal Planning")`
   (guarded), then set `renamed_at`. Exactly once; no-op on DMs (documented — the current test thread
   is a DM, so this typically no-ops there).
5. **Contact-card trigger** (consumer): at onboarding-complete (the same `completeAndPop` moment as
   WI-4B's fireworks), **after** the fireworks message, when `carded_at` (or the shared flag) is null,
   `sendContactCard(chatGuid)`, then set the flag. Exactly once.

## Acceptance Criteria

1. Given a group chat and a just-created household (`renamed_at` null), when the consumer runs, then
   `renameChat("Meal Planning")` fires once and `renamed_at` is set.
2. Given a 1:1 DM, when the rename would fire, then it **no-ops without throwing** (guarded on
   `space.type`), and does not crash the turn.
3. Given onboarding completes (`carded_at`/shared flag null), when the consumer runs, then
   `sendContactCard` is called once (after the fireworks) and the flag is set; redelivery does not
   re-send.
4. Migration applies forward; full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: rename on group, once (AC1)
**Preconditions:** `file:` DB; a thread whose space stub `type='group'`; householdId set this turn; renamed_at null; StubSpectrumSender.
**Steps:** drive the turn.
**Expected Outcomes:** stub recorded `renameChat('Meal Planning')`; `renamed_at` set; a later turn does not re-rename.

### Test Case 2: DM no-op (AC2)
**Preconditions:** space stub `type='dm'`.
**Steps:** trigger the rename path.
**Expected Outcomes:** no throw; the stub's renameChat either not called or recorded-as-skipped; turn completes normally.

### Test Case 3: contact card once at onboarding-complete (AC3)
**Preconditions:** a thread completing onboarding this turn; card flag null.
**Steps:** drive the completing turn; re-deliver the doorbell.
**Expected Outcomes:** exactly one `sendContactCard`; flag set; redelivery no-ops.

### Test Case 4: suite + migration (AC4)
**Steps:** `npm run db:migrate`; `npx vitest run`; `npm run typecheck`. **Expected:** applies; green; clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — two Sender methods + two consumer trigger points + a flag migration. Restart the dev
server on the merged HEAD before the e2e.

## Production Verification

### Production Verification 1: contact card + rename on a real device (REQUIRED)
**Preconditions:** WI-4C merged/deployed; dev server on merged HEAD; ngrok live; test Mac paired; a
fresh onboarding run.
**Steps:** Run onboarding to completion from the test Mac.
**Expected Outcomes:** After the fireworks, the **native "Chef" contact card** arrives on-device
(observed in Messages). **Rename:** on a **group** chat the chat title becomes "Meal Planning"; on the
1:1 DM test thread it correctly **no-ops** (no error, no rename) — verify on a group chat if one is
available, else document the DM no-op as correct.

## Production Verification Run

_To be filled during execution._

---

**Dependency:** **WI-4B** (the one-time-flag substrate) — branch from WI-4B merged. Builds on Phases 1-3.
