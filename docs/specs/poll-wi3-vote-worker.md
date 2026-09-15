# WI-3: Vote-ingestion loop-worker

## Background

Votes arrive only on the advanced `polls.subscribeEvents()` gRPC stream, and `polls.get()`
returns empty on shared — so we bookkeep the tally ourselves from delta events (design D1/D3).
The stream is long-lived, which doesn't fit Vercel's request model, so we run a **cron-relaunched,
lock-guarded loop-worker**: it holds the stream to near `maxDuration`, then exits; the next cron
tick relaunches; `events.catchUp(sequence)` on start covers the seam. Poll events only. Depends
on WI-1 (client) and WI-2 (the `type='poll'` anchor rows + option map).

**Blocking check (Q-01):** confirm `events.catchUp(seq)` replays **poll** deltas on shared before
building the seam logic (we proved live `subscribeEvents`, not `catchUp`). If catchUp omits poll
deltas on shared, seam recovery must fall back to re-reading via subscribeEvents from a saved
cursor — resolve before implementing the catchUp branch.

## Objective

Continuously ingest poll vote deltas into a `poll_votes` table with an advancing cursor, using one
Vercel Cron + one lock-guarded function that holds the stream to ~`maxDuration`.

## Acceptance Criteria

1. Given a `voted` delta, when applied, then `poll_votes` is upserted on key
   `(poll_message_guid, voter, option_identifier)` with `selected=true`, `sequence`, `option`
   resolved to text via the WI-2 anchor row's option map.
2. Given an `unvoted` delta, when applied, then the matching row's `selected=false`.
3. Given multi-select (one voter, several options) and multi-user, then each (voter, option) is a
   distinct row — no clobbering.
4. Given the function nears `maxDuration`, when the loop checks elapsed time, then it exits cleanly,
   releases the lock, and advances `poll_stream_cursor.sequence` to the last applied event.
5. Given a second cron tick while one is running, when it tries to acquire the lock, then it exits
   without starting a second consumer.
6. Given a restart, when the worker starts, then `catchUp(cursor)` (poll-filtered) applies missed
   deltas before opening the live stream — no lost or double-applied votes (idempotent on the
   unique key + sequence).
7. The cron route is protected by `CRON_SECRET` and configured with `maxDuration` = the confirmed
   Pro cap; cron interval ≈ that duration.

## Test Cases

### Test Case 1: voted/unvoted/multi-select application (unit)
**Preconditions:** seed a `type='poll'` anchor row with a 3-option map.
**Steps:** feed delta fixtures: voter A `voted` opt1, A `voted` opt2, A `unvoted` opt1, voter B `voted` opt2.
**Expected Outcomes:** rows — A/opt1 selected=false, A/opt2 selected=true, B/opt2 selected=true; tally opt2=2, opt1=0.

### Test Case 2: cursor advance + idempotent replay (unit/integration)
**Preconditions:** apply deltas through sequence N; save cursor.
**Steps:** re-feed the same deltas (simulating catchUp overlap) then new ones N+1…
**Expected Outcomes:** no duplicate rows or double-counts; cursor ends at the max sequence.

### Test Case 3: lock prevents overlap (integration)
**Steps:** invoke the route twice concurrently.
**Expected Outcomes:** one runs the loop; the other returns `{ran:false,reason:"locked"}`.

### Test Case 4: near-timeout exit (integration, stubbed clock/stream)
**Steps:** run with a short simulated `maxDuration`; keep the stubbed stream open.
**Expected Outcomes:** loop breaks ≈ `maxDuration−buffer`, releases lock, returns `{ran:true, throughSequence}`.

### Test Case 5: Q-01 catchUp on shared (live probe)
**Steps:** create a poll, vote, wait, then run only `events.catchUp(priorSeq)` and list poll deltas.
**Expected Outcomes:** the vote deltas appear. If not, record the fallback and adjust seam logic.

## Test Run
_To be determined._

## Deployment Strategy

Add `poll_votes` + `poll_stream_cursor` tables (backwards-compatible). Register the cron in
`vercel.json`. Requires Vercel Pro (cron). Roll back by removing the cron; rows go inert.
Reuses the existing lock (`server/src/imessage/lock.ts`) with TTL ≈ `maxDuration`+buffer.

## Production Verification

### Production Verification 1: Live votes accumulate
**Preconditions:** deployed; a poll sent to a test device.
**Steps:** cast + change votes on-device; wait one cron cycle.
**Expected Outcomes:** `poll_votes` reflects current selections; cursor advances; `poll_worker_runs` metric increments.

### Production Verification 2: Seam holds
**Steps:** vote during the worker's exit/relaunch window.
**Expected Outcomes:** the vote is present after the next run (catchUp covered the seam).

## Production Verification Run
_To be determined._
