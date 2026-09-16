---
tags: [imessage-chef], tdd
summary: "iMessage native polls for the chef — send via advanced kit, ingest votes via a loop-worker"
locked: false
---

# iMessage Polls — Technical Design

The chef sends a native iMessage poll and reacts to votes in near-real-time. Native
polls are the right control for a bounded, multi-way household choice ("Which of these
three for dinner?") — votes tally cleanly instead of scattering across text replies.

**Everything below is proven on our current Free/shared plan** (spike, 2026-09-15 — see
Appendix B). No plan upgrade. Two decisions are made: **send via the advanced kit**, and
**ingest votes with a cron-relaunched loop-worker** (near-instant, poll events only).

## What the spike settled

- **Send + create work on shared.** `client.polls.create(chatGuid, title, options)` returns
  the `pollMessageGuid` **and** the `optionIdentifier → text` map in one call.
- **Votes only arrive on the advanced `polls.subscribeEvents()` gRPC stream.** The Spectrum
  webhook (our current inbound) does **not** carry votes — only a read receipt + the poll as
  an opaque `custom` blob. The `webhook.photon.codes` bridge needs a durable key our shared
  plan doesn't issue, so it's out.
- **`polls.get()` (server tally) returns empty on shared** — so we **bookkeep the tally
  ourselves** from the delta stream. This is the core of the design.
- A vote delta carries everything we need: `pollMessageGuid`, `actor` (voter),
  `delta.{type: voted|unvoted, optionIdentifier}`, and a monotonic `sequence`.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |

---

# Use Case Implementations

## F-01: Chef sends a poll

~~~mermaid
sequenceDiagram
    participant M as Chef (Gemini)
    participant T as chat__send tool
    participant IM as Advanced iMessage client
    participant DB as Turso

    M->>T: send({type:"poll", text:title, options:[...]})
    T->>IM: polls.create(chatGuid, title, options)
    IM-->>T: Poll {pollMessageGuid, options:[{optionIdentifier,text}]}
    T->>DB: insert thread_messages row (type=poll, external_id=guid, body=option map)
    note over DB: this row is the vote anchor + id→text map
~~~

## F-02: Loop-worker ingests votes (near-instant)

A Vercel Cron relaunches a lock-guarded function that holds the poll stream until near its
`maxDuration`, then exits; the next tick relaunches. `catchUp` on start covers the seam.

~~~mermaid
sequenceDiagram
    participant Cron as Vercel Cron (~13 min)
    participant W as /api/polls/consume
    participant Lock as lock (Turso)
    participant IM as polls.subscribeEvents / events.catchUp
    participant DB as poll_votes

    Cron->>W: invoke (maxDuration 800s)
    W->>Lock: acquire(ttl≈820s)
    alt already held
        Lock-->>W: busy → 200, exit
    else acquired
        W->>DB: read checkpoint sequence
        W->>IM: events.catchUp(sequence)  [poll deltas only]
        loop each poll delta
            IM-->>W: {pollMessageGuid, actor, delta, sequence}
            W->>DB: upsert vote + advance checkpoint
        end
        W->>IM: polls.subscribeEvents()  (live)
        loop until elapsed ≈ maxDuration−30s
            IM-->>W: poll delta
            W->>DB: upsert vote + advance checkpoint
            note over W: debounced → trigger chef turn on the tally
        end
        W->>Lock: release
    end
~~~

**Vote application:**
- `voted` → upsert `poll_votes(poll_message_guid, voter, option_identifier)` `selected=true`
- `unvoted` → same row `selected=false`
- `created`/`optionAdded` → refresh the poll's option map (defensive; we already have it from `create`)
- After each apply, advance the checkpoint to `event.sequence`.

**Reacting** (poll events only): a vote upsert schedules a **debounced** chef turn (quiet-period
coalesce) fed the current tally — so a burst of votes is one turn, not N.

---

# Entities

~~~mermaid
classDiagram
    class Poll {
        +string pollMessageGuid
        +string chatGuid
        +string title
        +Option[] options
    }
    class Option {
        +string optionIdentifier
        +string text
    }
    class Vote {
        +string voter
        +string optionIdentifier
        +bool selected
    }
    Poll "1" --> "*" Option : options
    Poll "1" --> "*" Vote : votes
~~~

---

# Tables

## The poll itself — no new table

The poll **is** the outbound `thread_messages` row: `type='poll'`, `external_id` =
`pollMessageGuid` (from `create()`), and `body` = JSON `{title, options:[{optionIdentifier,
text}]}`. That row is the vote anchor and the `optionIdentifier → text` map. (`thread_messages.type`
widens to include `'poll'` — TS-enum only, no migration.)

## poll_votes (new)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | pk | |
| poll_message_guid | text | fk → thread_messages.external_id (the type='poll' row) | |
| voter | text | not null | `actor.address` (handle) |
| voter_user_id | text | fk → users.id, null | resolved via existing sender lookup |
| option_identifier | text | not null | |
| selected | int (bool) | not null | latest state |
| sequence | int | not null | event ordering |
| updated_at | int (ts) | not null | |

Unique: `(poll_message_guid, voter, option_identifier)` — the upsert key. Multi-select and
multi-user fall out: one row per (voter, option). Tally = `selected=true` rows grouped by option.

## poll_stream_cursor (new, single row)

| Column | Type | Notes |
|---|---|---|
| id | int | pk, always 1 |
| sequence | int | last applied event sequence |

---

# Modules

| Concern | File | Edit |
|---|---|---|
| Advanced client (mint token + `createGrpcClient`) | `server/src/imessage/advanced-client.ts` (new) | shared-mode: token from `issue-tokens`, addr `imessage.spectrum.photon.codes:443` |
| Send tool | `server/src/chef/chef-agent.ts` (`SendInput` ~64) | add `type:'poll'` + `options:string[]`; execute → `polls.create` → insert `type='poll'` thread_messages row |
| Vote worker | `server/src/imessage/poll-consumer.ts` (new) | lock → catchUp(poll-filtered) → subscribeEvents → upsert + checkpoint + debounced turn |
| Cron route | `server/app/api/polls/consume/route.ts` (new) | `export const maxDuration = 800`; calls the worker |
| Lock | `server/src/imessage/lock.ts` (existing) | reuse; TTL ≈ maxDuration+buffer |
| Tally + tools | `server/src/chef/tools/` | `poll__tally` read (from `poll_votes`) for the chef |
| Schema | `server/src/schema.ts` | `poll_votes`, `poll_stream_cursor` + widen `thread_messages.type` (add `'poll'`) |
| Dep | `server/package.json` | add `@photon-ai/advanced-imessage` (currently only transitive) |

---

# APIs

## Poll consume `GET /api/polls/consume`

Cron-invoked. Not public — protect with `CRON_SECRET` (existing pattern). Acquires the lock,
drains + holds the poll stream to near `maxDuration`, returns a summary.

### Success `200` — `{ ran: bool, applied: int, throughSequence: int }`
### Busy `200` — `{ ran: false, reason: "locked" }`

---

# Testing

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| F-01 send | Flow | x | x | manual |
| F-02 ingest | Flow | x | x | manual (spike harness) |

- **Unit — vote application:** delta fixtures (`voted`/`unvoted`/multi-select) → expected `poll_votes` upserts + tally; option map resolves `optionIdentifier → text`.
- **Unit — checkpoint/seam:** `catchUp` replays from cursor; no double-apply (idempotent on `(guid,voter,option)` + sequence).
- **Integration — worker w/ stubbed stream:** feed a scripted delta stream, assert votes + debounced single turn.
- **E2E — manual:** the spike scripts (`scripts/spike-poll-raw.ts`) already drive real create+vote on shared; keep one as the smoke test.

---

# Deployment

- **Migrations:** add `poll_votes`, `poll_stream_cursor`. `thread_messages.type` widen (add `'poll'`) is code-only. All backwards-compatible.
- **Cron:** add `/api/polls/consume` to `vercel.json` crons at the interval ≈ `maxDuration` (800s ⇒ every 13 min; or 1800s beta ⇒ every 30 min). Requires **Vercel Pro** (have it).
- **Env:** reuse `PHOTON_PROJECT_ID/SECRET`; add `CRON_SECRET` if not present.
- **Rollback:** remove the cron; poll rows go inert. No data cleanup.

---

# Monitoring

- `poll_worker_runs` (counter), `poll_worker_stream_seconds` (histogram) — confirm the worker holds the stream and relaunches cleanly.
- `poll_votes_applied` (counter) — F-02 health.
- Alert: no `poll_worker_runs` in 2× the cron interval → the loop died and isn't relaunching.

---

# Decisions

## D1. Ingest votes with a loop-worker, not a per-minute cron-drain
**Choice:** near-instant. A cron relaunches a lock-guarded function that holds
`subscribeEvents()` until ~`maxDuration`, then exits; `catchUp` covers the seam. ~$8–21/mo
(Provisioned Memory only — Active CPU pauses during I/O). Rejected the cron-drain (~$1–2/mo)
because we want snappy vote reactions. Both dwarfed by the $250/mo Business bridge.

## D2. Send via advanced `polls.create()`, not Spectrum `poll()`
**Choice:** `create()` returns `pollMessageGuid` + `optionIdentifier → text` in the send
response — both the vote anchor and the "which option" map, for free. Spectrum `poll()`
returns titles only (no identifiers), leaving votes unresolvable.

## D3. Self-bookkeep the tally; don't call `polls.get()`
**Choice:** `get()` returns empty on shared (proven). Accumulate deltas into `poll_votes`
keyed `(guid, voter, option)`. This is the tally; multi-select/multi-user are free.

## D4. Correlate votes by `pollMessageGuid`, never by title
Titles collide across re-sent polls; the guid is on every delta and is what `create()` returns.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Does `events.catchUp(seq)` replay **poll** deltas on shared? (We proved live `subscribeEvents`, not `catchUp`.) | open | 2-min check before building — drives the seam-recovery guarantee. |
| Q-02 | Confirm current Pro `maxDuration` cap in our project settings (800s GA vs 1800s beta) to set the cron interval. | open | Dashboard → Functions settings. |
| Q-03 | Debounce window for the chef turn (coalesce a vote burst) — 3s? 10s? | open | Tune during build; start ~5s quiet-period. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-09-15 | Jordan Gaston | Initial draft (send + vote loop) |
| 2026-09-15 | Jordan Gaston | Rewrite around proven spike: advanced-kit create + loop-worker, self-tally |

# Appendix B — Spike evidence (2026-09-15, Free/shared)

- `create()` on shared → `pollMessageGuid: spc-msg-2946877e…`, options `[{425163D3…,Pizza},{B86B…,Tacos},{33482A05…,Sushi}]`.
- Live `subscribeEvents` votes: `{delta:voted, optionIdentifier:425163D3…, actor:+15128267702, pollMessageGuid:…, sequence:1009128462}` (Pizza + Tacos, multi-select captured).
- `polls.get()` → `title:"", votes:[]` (empty on shared — why `app.messages` dropped votes).
- Spectrum webhook on a vote → `read` receipt + poll as `custom`; no `poll_option`.
- Bridge (`webhook.photon.codes`) → delivered nothing to `/hook`.
- Scripts: `scripts/spike-poll-raw.ts` (create+subscribe+get), `scripts/spike-poll-live.ts`, `scripts/spike-poll-webhook.ts`.
