# Serverless migration — pre-mortem

Imagine the sprint shipped and broke. Here is why, and the guard that prevents each failure, ordered
by likelihood times cost. These are the traps a DBOS + Postgres → Vercel Workflow + Turso migration
walks into.

## 1. WDK directives don't compile or the workflow sandbox rejects the code (HIGH likelihood, HIGH cost)

A workflow function runs in a sandboxed VM: no `fetch`, no `node:` modules, no `setTimeout`. Put I/O
or a Node API directly in the `"use workflow"` function and it fails at build or run. The Nitro +
`workflow/nitro` build is also new to this repo, so a misconfigured `nitro.config.ts` or a missing
`tsconfig` plugin breaks the compile. **Guard:** keep the workflow function pure orchestration; every
network call, database write, and `node:crypto` use lives in a `"use step"` function with full Node
access. Stand up the Nitro build and a trivial `start()` workflow before porting the real pipeline, so
the toolchain is proven first. Read the versioned Workflow DevKit docs for the exact build config; do
not guess.

## 2. A step returns or throws a non-serializable value and replay breaks (HIGH likelihood, HIGH cost)

WDK persists each step result to an event log and passes only serializable data across the
workflow/step boundary — functions, class instances, and symbols do not survive. The pipeline's
`ImportError` is a class, and a naive port that returns a `Date`, a `Buffer`, or a class instance from
a step corrupts replay. **Guard:** steps return plain records, strings, and URLs; the import error
travels as a string code inside `FatalError`, and the workflow's catch maps it to `error_code`. The
fault-injection demo re-enters the workflow and proves completed steps replay from the log.

## 3. No linked Vercel project, so the queue-to-workflow path can't run in `vercel dev` (HIGH likelihood, HIGH cost)

Vercel Queues and the Workflow engine authenticate through a linked Vercel project: `vercel link` then
`vercel env pull` writes the OIDC credentials the SDK needs to reach the queue service locally. Without
them, the import path — now the definition of done — cannot run under `vercel dev`, and no amount of
local code substitutes. **Guard:** the linked project is a provisioned prerequisite, escalated to the
founder early (as Turso was), so it is in place before the import stories need it. Meanwhile the fast
tests never call `send()`: the intake test asserts the route invokes a `send` seam, and the consumer
test calls the handler as a plain function, so development proceeds while the project is provisioned.

## 4. At-least-once delivery imports a recipe twice (MED likelihood, HIGH cost)

Queues delivers at least once, so the consumer can fire twice for one job. Without idempotency, the
import runs twice and links two recipes. **Guard:** the workflow run id is the job id, so a redelivery
whose workflow exists is a no-op; the `idempotencyKey` on `send()` deduplicates a double intake within
the retention window; and recipe ids are application-generated, so a replayed persist writes the same
rows. The demo asserts exactly one recipe is linked after a faulted, retried run.

## 5. The SQLite unique-violation is not caught, returning 500 instead of 409 (MED likelihood, MED cost)

The Postgres path matched SQLSTATE `23505`; libSQL raises a different error shape. A duplicate cookbook
name would fall through to a 500. **Guard:** update the single choke point,
`CookbookRepository.create`, to match the libSQL constraint error, and test that a duplicate name
raises `CookbookExistsError` and a 409.

## 6. `numeric → text` arithmetic or a JSON-array round-trip corrupts data (MED likelihood, HIGH cost)

`confidence` and the nutrition macros become `text`; the onboarding `enum[]` columns become JSON text.
Arithmetic on a text column, or an array stored with the wrong mode, corrupts data silently. **Guard:**
these columns are only stored and echoed today, with no server-side arithmetic — keep it that way. Test
that the onboarding arrays round-trip through JSON mode and that the nutrition strings survive a
persist-then-read unchanged.

## 7. A step exceeds the function duration or memory (MED likelihood, MED cost)

Each step is a function invocation bounded by 300 s and 2 GB. A slow provider or a large payload can
exceed the limit, failing the step. **Guard:** the ported steps are single network calls that finish
in seconds; keep them small and set a sane `maxRetries` with `RetryableError` backoff for transient
provider errors. `ffmpeg` extraction is the one heavy step; a short social clip decodes well within the
envelope, and `frames`/`audio` are capped (12 frames, mono 16 kHz) so the payload stays small.

## 8. The per-frame fan-out drops frames to the provider rate limit (MED likelihood, HIGH cost)

The founder wants maximum concurrency, but the external VLM (Groq Qwen-VL) has a ~8 k TPM cap — the
current server hit it running a carousel's slides in parallel and dropped recipes. A naive
`Promise.all` that escalates every frame to the VLM at once repeats that failure. **Guard:** local
Tesseract OCR is the primary reader and parallelizes freely across per-frame invocations (CPU, no
cap); only a frame with the weak-OCR signature escalates to the VLM, and the escalations pass through a
concurrency limit sized to the TPM cap. Maximum fan-out for the common case, a bounded queue for the
rare escalation — no frame is dropped. The demo watches the run timeline to confirm frames read
concurrently and no escalation errors on rate limit.

## 8b. ffmpeg or Tesseract does not run in a Vercel function (MED likelihood, HIGH cost)

The media path assumes a bundled `ffmpeg-static` binary runs from `/tmp` and Tesseract OCR runs in the
Node runtime. If `ffmpeg-static` is not bundled (Vercel's file tracing must include the binary), or the
native `tesseract` binary is absent, the media step fails at runtime, not in a fast test. **Guard:**
bundle `ffmpeg-static` and reference its resolved path, not a bare `ffmpeg` on PATH; use the
`tesseract.js` WASM reader (no native binary) so OCR runs anywhere the Node runtime does; and prove
both in the `vercel dev` video demo, not only in a local test where the host happens to have the
binaries. `/tmp` is ephemeral and cleared between invocations, so the extract step both writes and
reads frames within one invocation before handing URLs onward.

## 9. Replacing `server/` loses working logic the port needs (MED likelihood, MED cost)

The replace-in-place cutover deletes the DBOS/Fastify/Postgres code. Removing a shared helper or a
domain rule the new stack still needs — ingredient parsing, source classification, the `toRecipeRow`
filter, the nutrition label core — reintroduces a solved bug. **Guard:** port the runtime-neutral logic
first (it moves unchanged), then remove the Postgres/DBOS/Fastify layers around it. The rewritten test
suite covers the same behaviour the old suite did, so a dropped rule shows up as a red test.

## 10. Coding a new API from stale memory (MED likelihood, MED cost)

Vercel Functions, Workflow DevKit, and Vercel Queues are new or fast-moving; coding from training data
ships wrong signatures. **Guard:** read the versioned docs for each before the story that touches it —
WDK directives and retry config, the `@vercel/queue` `send`/`handleCallback` API and its `vercel.json`
trigger, the Nitro build, and `drizzle-orm/libsql` transactions. Pin the versions the design lists.

## Decide-and-log rule

The sprint does not stop for these. Take the guard, log the decision in `POSTMORTEM.md`, and escalate
only a genuine external blocker or a founder-level decision. The one live escalation is the linked
Vercel project (risk 3), needed for the `vercel dev` bar; the build proceeds on everything else while
it is provisioned.
