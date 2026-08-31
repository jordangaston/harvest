---
tags: harvest, imessage, onboarding, increment-1, tdd
summary: "Increment 1 — the iMessage substrate and the chef's response loop (process the first inbound message, reply)"
locked: false
---

# Onboard Users via iMessage — Increment 1: Substrate & Response

**The program.** Let a household onboard to Harvest by texting our iMessage number, talking
to a warm "private chef."

**This increment's deliverable — process the first inbound message.** A person texts the
number for the first time; we record them and their thread, run the chef, and reply. When it
ships you can text the number and get one coherent, in-character reply, delivered durably and
without duplicates. It does **not** onboard anyone yet: no objectives, no questions, no
preferences written. The point is to make the whole pipe walk — including the
response→reasoning seam — so increment 2 fills the reasoning layer with onboarding logic
without touching the plumbing. The same pipe handles later messages; the first message is
just the deliverable we prove it on.

## Scope

| In scope (increment 1) | Deferred |
|---|---|
| Spectrum: webhook receive + send + HMAC verification | Objectives, questions, the goal stack → increment 2 |
| Persist user + thread + inbound message (one transaction) | Household as a first-class entity; preferences → increment 2 |
| Doorbell → queue → consumer | Interruption / cancel-and-restart |
| The chef: response layer (outer) → `process_message` → reasoning layer (inner) | Per-member rendering, tapbacks, SMS/RCS degradation |
| Compose and **send** a reply, durably and idempotently | The DB single-flight lease / commit-CAS (see Concurrency) |
| Message-guid dedup + doorbell coalescing + idempotent send | Reminders, menus, recipe drops |

Objectives and the objective stack are **increment 2**; the design for them lives in
[`01-agent-architecture.md`](./01-agent-architecture.md) and
[`02-onboarding.md`](./02-onboarding.md).

---

# Spectrum integration

The pieces this increment stands up on the Spectrum side (all verified against the docs):

- **Webhook registration.** Register our endpoint URL with Spectrum and store the returned
  **signing secret**. Spectrum POSTs message events to that URL (webhook mode — no long-lived
  process; runs as an ordinary serverless route).
- **Signature verification.** Each delivery is HMAC-signed over the raw body bytes. Verify
  with the signing secret using a **constant-time comparison** (`crypto.timingSafeEqual` or
  Spectrum's provided verifier) to avoid a timing side-channel. Prefer Spectrum's verifier if
  it exists — it already handles the raw-bytes + timing-safe details.
- **Sending.** The consumer sends the reply via `im.space.get(chat_guid)` then `.send(...)` —
  **no webhook `space` object and no long-lived connection are required, only the configured
  line credentials + the thread's `chat_guid`** (docs: "No webhook handler or space object
  from an event is required — only the chat GUID"). Each send passes the outbound row's
  `message_guid` as the idempotency key.
- **Line credentials / token.** Use **automatic discovery** — pass `projectId` +
  `projectSecret` to the `Spectrum()` call and omit explicit client tokens. The SDK then
  obtains and renews line tokens ("renewed at 80% of their TTL"); in serverless each cold
  start re-discovers a valid token, so there's nothing to manage. (Explicit `clients: [{
  address, token, phone }]` tokens are *not* SDK-renewed — avoid unless we have a reason.)

---

# Exactly what happens when a message is received

Two functions. The **webhook endpoint** is synchronous and fast — it only records the message
and rings a doorbell. The **consumer** does all the work asynchronously. The split exists
because the webhook has a hard 30s timeout, retries on timeout, and no dead-letter queue, so
running the LLM inline would risk duplicate turns and dropped events.

```mermaid
sequenceDiagram
    autonumber
    participant IM as iMessage / Spectrum
    participant W as Webhook (server)
    participant DB as Turso
    participant Q as inbound_messages
    participant P as Consumer
    participant RESP as Response layer
    participant REAS as Reasoning layer

    note over IM,Q: Receive — synchronous, returns 2xx fast
    IM->>W: POST signed webhook (raw bytes)
    W->>W: timing-safe HMAC verify over the raw bytes (401 if invalid)
    W->>DB: ONE TX — upsert user, upsert thread (owned by user), insert typed inbound message
    note over W,DB: unique message_guid makes a redelivered webhook a no-op
    W->>Q: doorbell {thread_id}, idempotencyKey = thread_id (coalesced)
    W->>IM: 200 OK

    note over Q,REAS: Process — asynchronous, does the work
    Q->>P: doorbell {thread_id} (held under the visibility lease)
    P->>DB: load thread, participants, pending inbound messages (past the cursor)
    P->>RESP: invoke the chef
    RESP->>REAS: process_message (mandatory for a substantive user turn)
    REAS->>RESP: actions taken + facts (no prose)
    RESP->>P: reply bubbles (respond_with_text)
    P->>DB: TX — outbound rows (message_guid = our send key, sent_at NULL), advance cursor
    P->>IM: im.space.get(chat_guid).send() for each unsent row, then set sent_at
    P->>Q: ack the doorbell
```

## A. Webhook endpoint — `POST /spectrum/webhook`

Serverless route. In order:

1. **Read the raw request body bytes.** Do not parse first — the HMAC is computed over the
   exact bytes on the wire, and re-serializing breaks verification.
2. **Verify the HMAC** over those raw bytes with the signing secret, using a **timing-safe
   comparison**. Invalid → `401`, stop.
3. **Parse the event and read its type** (text, reaction, reply, attachment, …). Increment 1
   *processes* only `text`; other types are still recorded (step 4) but the consumer treats
   them as non-substantive for now.
4. **One transaction** (so state is never half-created):
   - upsert the **user** by `imessage_handle` (the sender's address),
   - upsert the **thread** by `chat_guid` (the Spectrum space id), owned by that user
     (`owner_user_id`) since no household exists yet,
   - insert the **inbound message** into `thread_messages` (`type`, `message_guid`, `body`,
     `sender_user_id`).
   The **unique index on `message_guid`** makes a redelivered webhook a no-op insert — this is
   *inbound* dedup (Spectrum delivers at-least-once). Commit.
5. **Enqueue the doorbell** `{thread_id}` on `inbound_messages` with `idempotencyKey =
   thread_id`. A doorbell already in flight for this thread is dropped — *doorbell coalescing*,
   distinct from step 4's row dedup.
6. **Return `2xx`.** No LLM work happened here, so this is well within the 30s timeout.

The transaction (4) commits **before** the doorbell (5), so the consumer never wakes to a
missing row.

## B. Consumer — queue trigger on `inbound_messages`

7. **Receive `{thread_id}`.** The message is in-flight under the visibility-timeout lease, so
   no other consumer processes this thread concurrently (see Concurrency).
8. **Load working context:** the thread; its **participants** (the users who belong to /
   have messaged on the thread — one for a 1:1, more for a group; for the first message, just
   the sender); and the **pending** inbound messages — those newer than the thread's cursor
   `last_processed_id`. If there are no pending *substantive* (text) messages → **ack and
   stop** (a duplicate or already-handled doorbell). For the first message, the cursor is null
   and pending is that one message.
9. **Invoke the chef** with that context (section C).
10. **Commit the turn in one transaction:** write the chef's reply as outbound
    `thread_messages` rows (`type=text`, `sent_at=NULL`, `message_guid` = a UUID we generate
    now), and advance the cursor to the newest processed inbound message.
11. **Deliver:** for each `sent_at=NULL` outbound row, `im.space.get(chat_guid).send(...)`,
    passing its `message_guid` as the send-idempotency key; on accept, set `sent_at`.
12. **Ack the doorbell.** If the consumer crashed before the ack, the doorbell redelivers; the
    next run delivers any `sent_at=NULL` rows first, then re-checks pending — so a crash yields
    neither a duplicate reply nor lost work.

## C. The chef

13. **Response layer** (outer — a Mastra `Agent`). Owns the persona and the user-facing
    conversation. Tools: `process_message` (delegate to reasoning) and `respond_with_text`
    (emit a reply bubble). **Rule: for any substantive user message it must call
    `process_message` before responding** — so the personality layer can never silently
    handle something that belongs to reasoning (e.g. ack a fact without persisting it). This
    is the Poke topology: the personality agent orchestrates and calls the "doing" as a
    capability.
14. **`process_message` tool → reasoning layer** (inner — a Mastra `Agent`). Pulls the
    current objective, the conversation history, and the participants (and household, once one
    exists); invokes its tools; and returns a structured summary of *what it did* (actions +
    facts), **not prose**. In increment 1 the objective is a single default "be a helpful
    chef" objective and there are **no domain tools yet**, so it returns "no actions —
    converse." Increment 2 replaces this with the objective stack and real commands; the seam
    is unchanged.
15. **Response layer composes the reply** from what reasoning returned, the persona, and the
    transcript, and emits it via `respond_with_text`. Those bubbles become the outbound rows
    committed in step 10.

---

# Tables (increment 1)

**`users`** — reuse the existing table; add one identity key:

| Column | Type | Notes |
|---|---|---|
| id | text (UUID) | pk |
| imessage_handle | text | nullable, **unique** — the Spectrum `sender.address` |
| name | text | nullable |

**`threads`** — one per iMessage space:

| Column | Type | Notes |
|---|---|---|
| id | text (UUID) | pk |
| chat_guid | text | not null, **unique** — the Spectrum space id |
| owner_user_id | text | not null, fk users.id — the thread's owner while no household exists |
| household_id | text | nullable — set in increment 2; takes precedence over owner when present |
| last_processed_id | text | cursor — the newest inbound message already handled |
| created_at / updated_at | timestamp | not null |

**`thread_messages`** — the transcript and the outbox:

| Column | Type | Notes |
|---|---|---|
| id | text (UUID) | pk |
| thread_id | text | not null, fk threads.id, index |
| direction | text enum | `inbound` \| `outbound` |
| type | text enum | `text` \| `reaction` \| `reply` \| `attachment` \| … (increment 1 processes `text`) |
| sender_user_id | text | fk users.id — the sender (inbound) |
| body | text | message text / payload |
| message_guid | text | **unique index** — inbound: Apple's id (dedup); outbound: our UUID (send-idempotency key) |
| sent_at | timestamp | outbound only — NULL until delivered |
| created_at | timestamp | not null |

---

# Idempotency & concurrency

Three mechanisms, each doing one job — precisely because both the webhook and the queue are
**at-least-once**:

1. **Inbound dedup** — the unique index on `message_guid`. A redelivered webhook re-inserts
   the same Apple guid, which is a no-op, so one inbound message = one row.
2. **Doorbell coalescing** — `idempotencyKey = thread_id`. While a thread's doorbell is in
   flight, further doorbells for it are dropped, so a thread is processed by one consumer at a
   time (the queue holds it invisible under the visibility-timeout lease; the dedup window
   releases at ack — verified). Different threads run concurrently.
3. **Idempotent send** — the outbound row's `message_guid` is a UUID we generate at commit
   time (step 10), *before* the first send, and pass as Spectrum's send-idempotency key. A row
   is only sent while `sent_at` is NULL; a redelivered turn re-sends the same guid, which
   Spectrum drops. So a redelivered turn never double-replies. (This is why the guid must be
   ours and pre-generated — Apple's outbound guid isn't known until after the send, so it
   couldn't serve as the retry key. One column, two sources: Apple's for inbound, ours for
   outbound.)

**Serialization edge, deferred.** Coalescing gives single-flight *while the consumer holds the
visibility lease*. A turn running past the lease can be redelivered and processed
concurrently; in increment 1 that's bounded by a generous visibility timeout / `ExtendLease`
(tune as we go) plus mechanism 3, which makes the duplicate turn's reply a no-op. The stronger
guarantee — a per-thread DB lease with a commit-time compare-and-set — is deferred; it isn't
needed to ship a correct first-message reply.

---

# Decisions

**D1 — Response layer is the outer loop; reasoning is a tool.** The personality layer owns the
conversation and calls reasoning via `process_message` (Poke topology), rather than a
reasoning→response pipeline. Guard: `process_message` is **mandatory** for a substantive user
turn, so the personality layer can never silently skip persistence.

**D2 — One `message_guid` column, generated by us for outbound.** No separate `client_guid`:
outbound rows store a UUID we mint at commit time, doubling as Spectrum's send-idempotency key;
inbound rows store Apple's guid. Both share the unique index. Simpler, and correct because the
send key must be ours and pre-send.

**D3 — Durable outbound is in increment 1.** Outbound rows carry `message_guid` + `sent_at`
and are sent from the consumer, not inline in the webhook. Rationale: at-least-once delivery
would otherwise make the very first increment visibly double-reply on redelivery.

**D4 — Objective machinery is deferred to increment 2.** The response→reasoning seam is built
now; the reasoning layer has a single default objective and no domain tools. The seam does not
change when increment 2 adds objectives/commands.

**D5 — Serialization via coalescing + idempotent send; DB lease and interruption deferred.**
Sufficient and correct for "process the first inbound message."

---

# Testing

Three layers, following `server/CLAUDE.md` (Vitest; unit for service methods, integration for
routes; **as few tests as cover the paths**; never test a third-party guarantee, a stub, or an
obvious Zod parse). DeepSeek and Spectrum are stubbed in automated tests and real only in the
manual round-trip.

## Unit

- **HMAC verification** — a valid signature passes; a tampered body, wrong secret, or missing
  header → `401`. The one security-critical branch, and it's pure. (The timing-safe compare is
  a property of the primitive; we don't assert timing.)
- **Consumer idempotency logic** — pending = inbound rows past the cursor; a redelivered
  doorbell whose cursor already advanced → no-op (ack, no send); an outbound row with `sent_at`
  set is never re-sent. Pure functions over fixture rows — no DB, no network.

Mock the chef (DeepSeek) and Spectrum; don't unit-test the model's output or Spectrum's
delivery.

## Integration

Wire the real webhook route and the real consumer to a `file:` test db, an in-memory queue, a
stub Spectrum sender, and a stub chef (fixed reply). Assert the paths, few enough to cover
them (runs under `vitest --config vitest.e2e.config.ts`):

1. **Happy path** — a signed webhook inserts user + thread + message in one transaction and
   enqueues one doorbell; the consumer writes one outbound row, calls the stub sender once, and
   advances the cursor.
2. **Duplicate inbound** — the same `message_guid` re-POSTed is a no-op insert (still one row),
   and coalescing produces no second doorbell.
3. **Redelivered doorbell** — running the consumer twice sends **once** (the `sent_at` gate +
   idempotent `message_guid`), not twice.
4. **Bad signature** — `401`, nothing persisted, no doorbell.

## Manual end-to-end — the acceptance test for increment 1

The real round-trip over live iMessage, with real Photon (project-id/secret **automatic
discovery**) and real DeepSeek:

1. Run the server locally (`npm run dev`) and expose it with a public tunnel
   (`ngrok http $PORT`).
2. Register the tunnel URL as the Spectrum webhook; store the returned signing secret in env.
3. **Jordan texts the Harvest number.**
4. **Confirm inbound received** — the server log shows the delivery, a passing HMAC check, and
   the inserted inbound `thread_messages` row (plus the doorbell). This is the "I received your
   message" confirmation.
5. **Jordan confirms the reply** — a chef-voiced text arrives back on his phone.

This human-in-the-loop test is increment 1's **definition of done**: a real text in, a real
reply out. The automated tests cover the branches; the manual test proves the live
Spectrum + DeepSeek integration that stubs can't.

---

# Integration facts (verified) & the one deferred knob

| ID | Question | Status |
|---|---|---|
| Q-1 | Send outbound outside a webhook request scope | **Resolved** — `im.space.get(chat_guid).send(...)`; no webhook space or persistent connection, only the line creds + `chat_guid` |
| Q-2 | Line token renewal without a persistent process | **Resolved** — use automatic discovery (`projectId` + `projectSecret`); the SDK renews, and each serverless cold start re-discovers |
| Q-3 | Doorbell dedup window releases at ack (not TTL) | **Resolved** — yes; the window is the message's lifetime, which ends at ack |
| Q-4 | Visibility timeout vs. turn length | **Deferred** — tune as we go (generous timeout / `ExtendLease`); mechanism 3 covers the duplicate in the meantime |

---

# What increment 2 adds

The reasoning layer gains the objective stack, the questions scoreboard, and the onboarding
`ObjectiveDefinition` with real commands; the household becomes first-class (a thread's
`household_id` supersedes its `owner_user_id`); the response layer gains per-member rendering
and tapbacks; and the DB lease + interruption harden concurrency. The substrate and the
response→reasoning seam built here do not change.

# Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-29 | Claude (w/ Jordan) | Written from Jordan's skeleton as the precise increment-1 build spec — response-outer-loop topology; the outbound send and the Spectrum-integration section |
| 2026-08-29 | Claude (w/ Jordan) | Review fixes: single transaction for user+thread+message; timing-safe HMAC; scope = process the first inbound message; thread owned by a user pre-household (`owner_user_id`); `thread_messages.type`; dropped `client_guid` (outbound uses a self-minted `message_guid`); clarified "participants" and the cursor/pending definition |
| 2026-08-29 | Claude (w/ Jordan) | Re-applied after an accidental editor overwrite; resolved Q-1 (`im.space.get` send outside the webhook), Q-2 (automatic-discovery tokens), Q-3 (dedup releases at ack) against the Spectrum/Vercel docs; Q-4 parked as a tuning knob |
