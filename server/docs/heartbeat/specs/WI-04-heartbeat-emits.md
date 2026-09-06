# WI-04 — Heartbeat delivers emits: shared guid scope, silent swallow

## Background

WI-02 excluded unasked emits from the heartbeat's arm 2 because a heartbeat retry under
its own `:hb:` guid scope could not see bubbles a kick-off had already sent under the
objective-id scope — a crashed close could re-deliver content. Jordan's direction:
include emits, and on a same-id send, swallow silently so the chef keeps going and
marks the emit done. The sink already swallows (`alreadySent` guard, `consumer.ts:44`);
the fix is scoping: emit deliveries share ONE idempotency domain wherever they fire.

## Objective

An eligible `unasked` emit heartbeat-fires; its turn rides the kick-off's objective-id
guid scope so already-sent content is swallowed and the emit still gets marked done.

## Acceptance Criteria

1. Given `actionable(tasks, now)`, then unasked eligible emits are included (the WI-02
   kind filter is removed).
2. Given a heartbeat turn whose actionable set contains an emit, then its sink guid
   prefix is the objective id (the kick-off scope) and the turn's intent covers only
   the due emits — due nudges wait for the next beat (their bubbles must not ride the
   colliding scope).
3. Given a retry after a crashed emit attempt (content sent, commit lost), then the
   duplicate send is silently swallowed, the turn continues, and the emit is marked
   done — exactly one bubble ever reaches the household.
4. Given a redelivered doorbell after a delivered kick-off whose emit went unmarked,
   then the heartbeat's re-send is swallowed by the kick-off's existing guids (the
   TC-6/TC-7 "redelivery is a clean no-op" invariant holds).

Known ceiling (ponytail note in `consumer.ts`): the shared scope would swallow a future
MID-objective emit's content across turns; none exists today — per-bubble scoping if
one is added.

## Test Cases

TC-1 (AC-1): unit — `actionable` includes an unasked emit (flipped WI-02 exclusion
test, `test/heartbeat-actionable.test.ts`).
TC-2 (AC-2): consumer — emit heartbeat turn: intent names the emit, guid
`<objectiveId>#0`, emit `filled`, ladder untouched.
TC-3 (AC-3): consumer — crashed attempt (send live, no commit) then retry beat: one
send total, one journal row, emit `filled`.
TC-4 (AC-4): existing TC-6/TC-7 kick-off redelivery tests pass unchanged.

## Test Run

```
$ npx vitest run test/heartbeat-actionable.test.ts
 Tests  8 passed (8)
$ npx vitest run test/imessage-consumer-logic.test.ts
 Tests  32 passed (32)      # incl. the 2 new WI-04 tests + TC-6/TC-7 unchanged
$ npx tsc --noEmit          # clean
$ npm test
 Tests  624 passed | 1 skipped (625)
```

## Deployment Strategy

Code-only (no migration). Ships with WI-01–03; same rollback (`is_paused = 1`).

## Production Verification

### Production Verification 1: emit heartbeat on a stranded close

**Preconditions:** WI-01–04 deployed; a test thread with an active objective whose
eligible emit is `unasked` (simulate a parked turn) and a live heartbeat row.

**Steps:** Wait one beat; check the chat and `tasks`.

**Expected Outcomes:** The content arrives once; the emit is `filled`; a second beat
sends nothing.

## Production Verification Run

To be filled after deploy.
