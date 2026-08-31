---
tags: harvest, imessage, onboarding, increment-1, spec
summary: "Work-item spec — iMessage substrate + chef response loop (process the first inbound message, reply)"
locked: false
---

# Onboard Users via iMessage — Increment 1: Substrate & Response

Source of truth for the design: [`../imessage-onboarding/increment-1-substrate-and-response.md`](../imessage-onboarding/increment-1-substrate-and-response.md).
This spec turns that design into an executable, testable work item.

## Background

Harvest wants households to onboard by texting an iMessage number and talking to a warm
"private chef." Before any onboarding logic can exist, the message pipe has to walk end to
end: a text arrives, we record the sender and their thread, run the chef, and send a reply —
durably and without duplicates.

This work item builds only that pipe. No objectives, no questions, no preferences are written;
the reasoning layer is a stub that returns "no actions — converse." The point is to prove the
whole path, including the response→reasoning seam, so increment 2 can fill in onboarding logic
without touching the plumbing.

Domain terms used below:

- **Spectrum** — the Photon iMessage provider. Delivers inbound messages to our webhook
  (HMAC-signed over raw bytes) and sends outbound via `im.space.get(chat_guid).send(...)`.
- **chat_guid** — Spectrum's id for an iMessage space (a 1:1 or group thread).
- **message_guid** — one `thread_messages` column, two sources: Apple's guid for inbound
  (inbound dedup) and a UUID we mint for outbound (send-idempotency key).
- **doorbell** — a near-empty queue message `{thread_id}` that wakes the consumer. Coalesced
  per thread via `idempotencyKey = thread_id`.
- **cursor** — `threads.last_processed_id`, the newest inbound message already handled.
  "Pending" = inbound rows newer than the cursor.

System context (verified against the repo):

- Server lives in `server/`: Hono app built by `buildApp(db)` in `src/index.ts`, served by
  Nitro (`NITRO_PRESET=vercel`); Drizzle ORM over libSQL/Turso (`src/schema.ts`, migrations in
  `drizzle/`, generated via `drizzle-kit`); Vercel Queue via `src/queue.ts` (client) and
  `src/queue-consumer.ts` (a Nitro plugin hooking `vercel:queue`, filtered by topic).
- A `users` table already exists (`src/schema.ts:125`) with `id` (uuid pk), `phone`, `name`,
  auth-key columns, and onboarding columns. It has **no `imessage_handle`** column yet.
- The LLM pattern to match is `src/parse/extractor.ts`: DeepSeek over an OpenAI-compatible
  `POST https://api.deepseek.com/chat/completions`, model `deepseek-v4-flash`, JSON mode,
  thinking disabled, called through `fetchWithRetry` (`src/parse/http.ts`), with a deterministic
  stub for offline tests.
- Credentials are in `server/.env`: `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`,
  `DEEPSEEK_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

**Human-gated prerequisite (blocker for the manual e2e test only).** A textable iMessage
line/number must exist on the Photon project. None is present in `server/.env`. During the
build, run Spectrum automatic discovery (`projectId` + `projectSecret`) and log the discovered
line address. If discovery returns no usable line, Jordan must provision a dedicated (Business)
line in his Photon account before the manual round-trip. Every step *except* that round-trip is
buildable and unit/integration-testable without it. `[ASSUMPTION: discovery yields a usable
line; if not, the manual acceptance test is blocked on Jordan provisioning one.]`

## Verified Spectrum SDK surface (`@spectrum-ts` 12.8.0)

Confirmed against the published type declarations — build against these, not the design doc's
earlier assumptions:

- **Dependencies to add:** `@spectrum-ts/core` + `@spectrum-ts/imessage` (both `12.8.0`). Import
  the persona/send surface from `spectrum-ts`/`@spectrum-ts/core` and the imessage provider from
  `@spectrum-ts/imessage`; import the verifier from the portable `@spectrum-ts/core/webhook`
  entry.
- **App / discovery:** `const app = await Spectrum({ projectId, projectSecret, providers:
  [imessage.config()], webhookSecret })`. The `projectId`/`projectSecret` overload returns the
  instance plus a resolved `config: ProjectData` — automatic discovery is real; no explicit line
  token is managed.
- **HMAC verification (use the SDK, do not hand-roll):** `verifySpectrumSignature({ headers,
  rawBody, secret, now? })` → `{ ok: true } | { ok: false, reason: "missing-headers" | "expired"
  | "signature-mismatch" }`. Web-Crypto, constant-time, runs on Node. Header `X-Spectrum-
  Signature: v0=<hex>` = `HMAC-SHA256(secret, "v0:" + X-Spectrum-Timestamp + ":" + rawBody)`.
  Note it also rejects a stale `timestamp` (`expired`) — a fixture with an old timestamp needs an
  injected `now`.
- **Inbound payload:** the native webhook body is slim JSON validated by `slimEnvelopeSchema`
  (loose — extra fields preserved). Map: `message.id` → inbound `message_guid` (Apple's id);
  `message.space.id` → `chat_guid`; `message.sender.id` → `imessage_handle`;
  `message.content.type` → `thread_messages.type`. The text body rides in `content` under a
  loose field — confirm the exact key against a real delivery (or the deserialize types) during
  implementation.
- **Send outside a request scope:** `const im = imessage(app); const space = await
  im.space.get(chat_guid); await space.send(text(body));` (equivalently `app.send(space,
  text(body))`). `text(source: string)` is the content builder.
- **Do NOT use `app.webhook(request, handler)` for the real work.** It verifies the HMAC
  internally but dispatches `handler` **fire-and-forget after the HTTP response**, and the docs
  warn the function may be frozen on serverless ("enqueue the work and process it in a separate
  worker"). So the route verifies explicitly with `verifySpectrumSignature`, persists, and
  enqueues the doorbell **synchronously** before returning `2xx` — matching this spec's split.
- **Correction to design mechanism 3 — no send-idempotency key.** `send()`/`text()` accept no
  idempotency or client-guid argument, so the outbound `message_guid` cannot be handed to
  Spectrum as a dedup key. Outbound idempotency therefore rests solely on the `sent_at` gate
  (only rows with `sent_at IS NULL` are sent; `sent_at` is written immediately after the send
  resolves). Residual ceiling: a crash in the narrow window between Spectrum accepting a send and
  the `sent_at` write can double-send on redelivery. Acceptable and documented for increment 1;
  a stronger guarantee is deferred with the DB lease (D5).

## Objective

Ship the iMessage substrate and the chef's response loop: a signed Spectrum webhook that
records the user, thread, and inbound message in one transaction and rings a per-thread
doorbell; a queue consumer that loads the thread's pending messages, runs the two-layer chef
(response layer → `process_message` → stub reasoning layer), writes durable outbound rows, and
sends each via Spectrum idempotently. Deliverable: text the number once and get one coherent,
in-character reply, with no duplicate replies on webhook or doorbell redelivery.

## Acceptance Criteria

**AC-1 — Signed webhook is accepted and persists one transaction.**
Given a Spectrum-signed `text` delivery from a new sender, when it hits
`POST /spectrum/webhook`, then the HMAC over the raw body verifies, and one DB transaction
upserts the user (by `imessage_handle`), upserts the thread (by `chat_guid`, `owner_user_id` =
that user), and inserts one inbound `thread_messages` row (`direction=inbound`, `type=text`,
`message_guid` = Apple's guid); the route returns `2xx`.

**AC-2 — Invalid signature is rejected with no side effects.**
Given a delivery whose HMAC does not verify (tampered body, wrong secret, or missing signature
header), when it hits the webhook, then the route returns `401` and nothing is persisted and no
doorbell is enqueued.

**AC-3 — Webhook rings one doorbell, keyed by `message_guid`.**
Given a verified delivery, when the transaction commits, then a doorbell `{thread_id}` is
enqueued on the inbound topic with `idempotencyKey = message_guid`, after the commit (never
before). (Keyed by message, NOT thread — see the Concurrency section; a `thread_id` key would
swallow later messages on the thread for the queue's 24h dedup window.)

**AC-4 — Redelivered webhook is a no-op (inbound dedup).**
Given a delivery already recorded, when the identical body (same `message_guid`) is POSTed
again, then the unique index on `message_guid` makes the insert a no-op (still one row) and the
`message_guid` doorbell key produces no second doorbell for that same message.

**AC-5 — Consumer processes pending and advances the cursor.**
Given a doorbell `{thread_id}` and one pending inbound `text` message, when the consumer runs,
then it loads the thread + participants + pending messages, invokes the chef, writes the reply
as outbound `thread_messages` row(s) (`direction=outbound`, `type=text`, `sent_at=NULL`,
`message_guid` = a UUID we mint), advances `last_processed_id` to the newest processed inbound
message — all in one transaction — sends each unsent row via Spectrum, sets `sent_at`, and acks.

**AC-6 — No pending substantive message → ack and stop.**
Given a doorbell whose thread has no pending `text` messages past the cursor (a duplicate or
already-handled doorbell), when the consumer runs, then it acks without invoking the chef and
without sending anything.

**AC-7 — Redelivered doorbell replies once (`sent_at` gate).**
Given a turn that already wrote and sent its outbound rows, when the same doorbell is
redelivered and the consumer runs again, then no new outbound row is written (cursor already
advanced) and no row is re-sent (every row's `sent_at` is set, so the gate skips it) — the user
sees exactly one reply. (A crash in the narrow window between Spectrum accepting a send and the
`sent_at` write can re-send that one row; the SDK has no send-idempotency key to close it — a
documented increment-1 ceiling, see the Verified SDK section.)

**AC-8 — The chef enforces the response→reasoning seam.**
Given a substantive user `text`, when the response layer runs, then it calls `process_message`
(reasoning layer) before emitting any reply, and the reasoning layer returns a structured
actions+facts summary (in increment 1: "no actions — converse"), from which the response layer
composes an in-character reply via `respond_with_text`.

**AC-9 (manual) — Live round-trip.**
Given the server running locally behind an ngrok tunnel with the webhook registered and a
provisioned line, when Jordan texts the number, then the log shows a verified inbound and an
inserted row, and a chef-voiced reply arrives on Jordan's phone.

## Test Cases

Testing follows `server/CLAUDE.md`: Vitest; unit for pure service logic, integration for route
+ consumer against a `file:` db and in-memory queue; as few tests as cover the paths; never
assert a third-party guarantee, a stub, or an obvious Zod parse. DeepSeek and Spectrum are
stubbed in automated tests and real only in the manual round-trip.

### Test Case 1: HMAC verification (unit) — covers AC-1 (verify branch), AC-2

**Preconditions:** A known signing secret and a raw body fixture with a correct signature.

**Steps:**
1. Call the verifier with the correct signature over the exact raw bytes → expect pass.
2. Flip one byte of the body, keep the signature → expect fail.
3. Use the wrong secret → expect fail.
4. Omit the signature header → expect fail.

**Expected Outcomes:** Case 1 passes; cases 2–4 fail (route maps a fail to `401`). Timing is
not asserted — timing-safety is a property of the primitive (`crypto.timingSafeEqual` or
Spectrum's verifier).

### Test Case 2: Consumer idempotency logic (unit) — covers AC-5 (pending), AC-6, AC-7 (gates)

**Preconditions:** Fixture rows for a thread: some inbound messages, a cursor value, and
outbound rows with mixed `sent_at`. Pure functions over rows — no DB, no network.

**Steps:**
1. Compute pending for a null cursor → all inbound; for a set cursor → only rows past it.
2. Compute pending when the cursor already covers every inbound row → empty.
3. Select unsent outbound rows from a set with some `sent_at` populated.

**Expected Outcomes:** (1) pending is exactly the rows past the cursor; (2) empty → the
consumer's "ack and stop" branch; (3) only `sent_at=NULL` rows are selected for send.

### Test Case 3: Happy path (integration) — covers AC-1, AC-3, AC-5, AC-8

**Preconditions:** Real webhook route + real consumer wired to a `file:` Turso db (migrations
applied), an in-memory queue, a stub Spectrum sender (records sends), and a stub chef (fixed
reply). Runs under `vitest --config vitest.e2e.config.ts`.

**Steps:**
1. POST a correctly signed `text` webhook from a new sender.
2. Assert the response is `2xx`; assert one user, one thread (`owner_user_id` set), and one
   inbound row exist; assert one doorbell was enqueued.
3. Run the consumer on that doorbell.

**Expected Outcomes:** One outbound row is written (`sent_at` set after send); the stub sender
is called exactly once with the row's `message_guid`; the cursor equals the inbound message id;
the stub chef was reached via `process_message` (assert the reasoning stub was invoked).

### Test Case 4: Duplicate inbound (integration) — covers AC-4

**Preconditions:** As Test Case 3, after one delivery is already recorded.

**Steps:** Re-POST the identical signed body (same `message_guid`).

**Expected Outcomes:** Still one inbound row; the same `message_guid` doorbell key yields no
second doorbell for that message; response is `2xx`.

### Test Case 5: Redelivered doorbell (integration) — covers AC-7

**Preconditions:** As Test Case 3, after the consumer has run once and sent its reply.

**Steps:** Deliver the same doorbell again and run the consumer.

**Expected Outcomes:** No new outbound row; the stub sender is **not** called again (cursor
advanced, `sent_at` set). Total sends across both runs = 1.

### Test Case 6: Bad signature (integration) — covers AC-2

**Preconditions:** As Test Case 3.

**Steps:** POST a body whose signature does not verify.

**Expected Outcomes:** `401`; no user/thread/message rows; no doorbell.

### Test Case 7: Live round-trip (manual) — covers AC-9

**Preconditions:** `server/.env` populated; a provisioned Photon line (see Background blocker);
ngrok installed.

**Steps:**
1. `npm run dev` in `server/`; `ngrok http $PORT`.
2. Register the tunnel URL as the Spectrum webhook; store the returned signing secret in env.
3. Jordan texts the Harvest number.
4. Confirm the server log shows a verified inbound and the inserted `thread_messages` row plus
   the doorbell.
5. Jordan confirms a chef-voiced reply arrives on his phone.

**Expected Outcomes:** One inbound recorded, one reply delivered — increment 1's definition of
done.

## Test Run

_To be filled in during execution: commands run, output, pass/fail per test case._

## Deployment Strategy

- **Schema migration.** One Drizzle migration adds `users.imessage_handle` (nullable, unique)
  and creates `threads` and `thread_messages` (with the `message_guid` unique index and the
  `thread_messages.thread_id` index). Backwards-compatible: all additions; existing columns and
  rows untouched; nullable `imessage_handle` needs no backfill. Generate with `drizzle-kit`, not
  by hand-editing SQL.
- **Queue topic.** Declare the inbound doorbell topic in `nitro.config.ts`
  (`vercel.queues.triggers`) alongside the existing `import-intake` trigger; the consumer plugin
  filters by topic name.
- **New route.** `POST /spectrum/webhook` is additive inside `buildApp`; it reads raw bytes
  (`c.req.arrayBuffer()`), so it must not sit behind body-parsing middleware or the auth guard.
- **Config.** No new secrets beyond the Spectrum signing secret returned at webhook
  registration (store in env). Photon creds and `DEEPSEEK_API_KEY` already exist.
- **Rollout.** The feature is dormant until a webhook URL is registered with Spectrum and a line
  is provisioned, so it can deploy dark. No flag needed — an unregistered webhook receives no
  traffic.
- **Rollback.** Deregister the webhook to stop inbound immediately. The migration is additive
  and safe to leave in place; if it must be reverted, drop `threads` and `thread_messages` and
  the `users.imessage_handle` column (no other code reads them in increment 1).

## Production Verification

### Production Verification 1: Signed inbound is recorded

**Preconditions:** Webhook registered against the deployed URL; a provisioned line.

**Steps:** Send one text to the number; query `thread_messages` for the new inbound row and
check logs for a passing HMAC verification.

**Expected Outcomes:** Exactly one inbound row; log shows verified signature and one enqueued
doorbell.

### Production Verification 2: Exactly one reply, no duplicates

**Preconditions:** As above.

**Steps:** After the inbound, observe the phone and query outbound rows.

**Expected Outcomes:** One outbound row with `sent_at` set; exactly one reply received; no
duplicate on any Spectrum redelivery.

## Production Verification Run

_To be filled in during execution: evidence for each verification case._

## Decisions

Carried from the design doc (see it for full rationale):

- **D1** — Response layer is the outer loop; reasoning is a tool (`process_message`), mandatory
  for substantive turns (Poke topology).
- **D2** — One `message_guid` column: inbound stores Apple's guid (dedup index); outbound stores
  a self-minted UUID (row identity / audit). No separate `client_guid`. Note: the outbound guid
  is *not* a Spectrum send key — the SDK has none (see Verified SDK section); the `sent_at` gate
  provides send idempotency.
- **D3** — Durable outbound (rows + `sent_at`, sent from the consumer) ships in increment 1, so
  at-least-once delivery can't double-reply on the common redelivery path.
- **D4** — Objective machinery deferred to increment 2; reasoning layer is a stub now.
- **D5** — Serialization via a **per-thread Redis lock** (a well-implemented lib — `redlock`'s
  auto-extending `using()`), held across the whole turn; the `sent_at` gate guards outbound.
  Coalescing-by-`thread_id` was struck (it's 24h produce-dedup, not a lock, and swallowed later
  messages — Q-3). A turn mutates the DB mid-flight (inc-2) and can double-reply (inc-1), and no
  held DB/advisory lock fits across the LLM call on serverless, so the lock lives in Redis. The
  doorbell is keyed by `message_guid` (dedup redeliveries only). **Fencing deliberately omitted:**
  `redlock` isn't fenced, so a pause past the TTL can let two turns write concurrently — a rare
  race explicitly accepted for now (Jordan, 2026-08-30), not scheduled; the fix would be a
  DB-enforced monotonic fence token. Interruption deferred to inc-2.
- **D6 — Chef built as plain TypeScript layers now; Mastra deferred to increment 2.** The design
  names both chef layers as Mastra `Agent`s, but Mastra is not installed and increment 1's
  reasoning layer is a stub with no tools. Building it as a plain `ResponseLayer` (one DeepSeek
  call for the persona reply, following the `src/parse/extractor.ts` pattern) that calls a
  `ReasoningLayer.processMessage()` seam — `process_message` mandatory before any reply — keeps
  the seam's shape identical to what increment 2 needs while honouring server/CLAUDE.md's
  no-dep-for-a-few-lines rule. Increment 2 swaps the reasoning layer's internals for a Mastra
  agent (dynamic tools + ToolSearchProcessor) without touching the seam, exactly as D4 promises.

## Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-1 | Send outbound outside a webhook request scope | resolved | `im.space.get(chat_guid).send(...)` — only line creds + `chat_guid` |
| Q-2 | Line token renewal without a persistent process | resolved | Automatic discovery (`projectId`+`projectSecret`); SDK renews, cold start re-discovers |
| Q-3 | Doorbell dedup window releases at ack (not TTL) | **resolved — NO** | Wrong assumption. Vercel Queue `idempotencyKey` dedup is a fixed ~24h retention window, not ack-scoped (confirmed live). Doorbell keyed by `message_guid`; serialization moved to the Redis lock (D5). |
| Q-4 | Visibility timeout vs. turn length | resolved | The Redis lock's TTL + auto-renewal spans the turn; the queue visibility timeout is only retry backing now, not load-bearing for serialization |
| Q-6 | Redis provider + `redlock` client compatibility (TCP vs Upstash HTTP) | open | Pin at provisioning via the Vercel marketplace |
| Q-5 | Does Photon discovery return a usable textable line for this project? | open | Check during build; if empty, Jordan provisions a dedicated/Business line |

## Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-29 | Claude (w/ Jordan) | Work-item spec derived from `increment-1-substrate-and-response.md` + verified repo facts; AC→test-case mapping; deployment + verification; human-gated line prerequisite (Q-5) called out |
| 2026-08-29 | Claude | Verified the SDK against `@spectrum-ts` 12.8.0 type declarations; added the Verified SDK section; corrected: use `verifySpectrumSignature` (not hand-rolled HMAC); no send-idempotency key → `sent_at` gate + documented ceiling (AC-7, D2, D5); don't use the fire-and-forget `app.webhook` handler on serverless; added D6 (chef as plain layers, Mastra deferred to inc-2) |
| 2026-08-30 | Claude (w/ Jordan) | Concurrency correction (live-verified): Q-3 was wrong — Vercel Queue `idempotencyKey` is ~24h produce-dedup, so `thread_id` coalescing swallowed later messages. Doorbell now keyed by `message_guid` (AC-3/AC-4 + Test Case 4); serialization is a per-thread **Redis lock via `redlock`** held across the turn (D5) since processing mutates the DB mid-turn; Q-4 resolved (lock TTL spans the turn), Q-6 added (Redis provider) |
