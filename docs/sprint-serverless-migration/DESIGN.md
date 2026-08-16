# Serverless migration — design

## Summary

The Harvest backend moves from a long-lived Fastify + DBOS + Postgres server to a fully serverless
Vercel stack: **Vercel Functions** (Node.js runtime) for the HTTP API, **Vercel Workflow (WDK)** for
the durable import pipeline, **Vercel Queues** for async intake, and **Turso (libSQL)** for the
database. No process stays alive between requests. A function serves a request and stops; the Workflow
engine, not a server we run, drives each import to completion and resumes it after a fault.

The Turso data layer, the Zod domain models, and the pipeline's one-step-per-network-call
decomposition carry over from the spike unchanged. The HTTP framework, the durable engine,
and the intake path are rebuilt on Vercel primitives. The migration replaces `server/` in place —
DBOS and Fastify are not deployed, so nothing runs in parallel. The bar for every story is the real
stack working under `vercel dev`, including a real video import; fast offline tests give feedback but
are not the goal.

## Context

`server/` today is a Fastify HTTP API over a Postgres database, with recipe imports driven by a DBOS
durable workflow. An import is asynchronous: the client posts a source URL, the API returns a
`queued` job, a durable workflow scrapes and extracts the recipe, and the client polls the job to
`ready`. DBOS gives the pipeline its key guarantee — a failed step resumes from a checkpoint rather
than restarting the whole import.

The backend is pre-launch. There is no production data to preserve and no deployed instance to keep
running. This frees the migration to start from a greenfield database and to replace the old stack
outright.

## Goals

- Serve the in-scope HTTP API (auth, users, imports, recipes, cookbooks) from Vercel Functions with
  the same routes, request validation, and auth semantics.
- Drive the import pipeline on Vercel Workflow, preserving resume-not-restart durability.
- Route every workflow start through a Vercel Queue, with retries and a dead-letter queue.
- Keep the database on Turso/libSQL with interactive transactions and migrations-only schema changes.
- Import a real video (TikTok, Instagram, YouTube) end to end — real ffmpeg extraction, real ASR, real
  OCR and extraction — into a persisted recipe.
- Prove each story on the real stack under `vercel dev`: a real request produces a real result. Fast
  offline unit and integration tests give feedback; the real end-to-end tier is the bar.

## Non-goals

- No production deployment, custom domain, or live cutover this sprint. The client repoints its base
  URL when the founder chooses. (`vercel dev` still needs a linked Vercel project — see Local
  development.)
- No Postgres-to-Turso data copy. The schema is greenfield.

## Target architecture

```
  client
    │  POST /v1/imports  (source url)
    ▼
┌─────────────────────────────┐
│ Vercel Function (Hono route)│  write queued job → send() to queue → 202
└─────────────┬───────────────┘
              │  Vercel Queue: "import-intake"
              ▼
┌─────────────────────────────┐
│ Queue consumer (Function)   │  handleCallback → start(importWorkflow, [msg])
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Vercel Workflow (WDK)       │  durable steps, event-log replay
│  mark-running → fetch-source│
│  → extract → persist-ready  │  each step: retryable, checkpointed
│  catch → mark-failed        │
└─────────────┬───────────────┘
              │  @libsql/client (HTTP)
              ▼
        Turso (libSQL)          ← interactive db.transaction()
```

| Layer | From | To |
|-------|------|----|
| HTTP API | Fastify (long-lived) | **Vercel Functions** — Hono routes, Node.js runtime |
| Durable pipeline | DBOS workflow + steps | **Vercel Workflow (WDK)** — `"use workflow"` + `"use step"` |
| Async intake | `DBOS.startWorkflow` | **Vercel Queue** → consumer → `start()` |
| Database | Postgres + `pg` pool | **Turso (libSQL)** + Drizzle `sqlite-core` |
| Auth | `jsonwebtoken` (Node crypto) | **`jsonwebtoken`** — unchanged; the Node runtime keeps it |

## HTTP layer — Vercel Functions

The API is a **Hono** app built by **Nitro** with the Workflow DevKit's Nitro module, which Vercel
deploys as Node.js functions. Nitro compiles the app and the `"use workflow"`/`"use step"` directives
into the Vercel function bundle; the Workflow module wires the runtime endpoints the engine needs.
Hono keeps the spike's route port and gives the same request/response shape the Fastify app has today.

`nitro.config.ts`:

```typescript
import { defineConfig } from "nitro";

export default defineConfig({
  modules: ["workflow/nitro"],
  routes: { "/**": "./src/index.ts" },
});
```

Every route ports one-to-one from `src/api/app.ts`: same paths, same Zod schemas, same status codes
(202 intake, 201 cookbook, 204 delete), and the same `{ error: { code, message } }` handler that maps
`AppError` and `ZodError`. The bearer-token guard becomes Hono middleware that stamps the caller's id
onto the context.

**Runtime limits (Node.js on Fluid Compute).** These bound the media decision below.

| Limit | Value |
|-------|-------|
| Max duration | 300 s default (all plans); up to 800 s on Pro/Enterprise |
| Memory | 2 GB (Standard) / 4 GB (Performance) |
| Bundle size | ~250 MB unzipped per function (Node.js) |
| Ephemeral disk | `/tmp`, cleared between invocations |
| Runtime | full Node.js, all npm packages, `node:crypto`/`fs`/`child_process` |

The full Node runtime is why `jsonwebtoken`, `libphonenumber-js`, `node:crypto`, and a bundled
`ffmpeg` binary all run without change.

## Durable pipeline — Vercel Workflow (WDK)

WDK replaces DBOS. A workflow is an async function marked `"use workflow"`; each unit of real work is
a function marked `"use step"`. The workflow function orchestrates and runs in a sandboxed VM with no
direct I/O; the step functions have full Node.js access, retry on failure, and have their results
persisted to an event log. When a workflow resumes after a fault, the engine replays the function and
returns each completed step's logged result instead of re-executing it. This is the resume-not-restart
guarantee DBOS gave us, now with no process kept alive.

### DBOS → WDK mapping

The pipeline's shape is unchanged: the workflow does status and exceptions; the work is one step per
network call.

| DBOS (`server/src/pipeline`) | WDK |
|------------------------------|-----|
| `@DBOS.workflow() static run()` | `export async function importWorkflow(input) { "use workflow"; … }` |
| `@DBOS.step() static fetchSource()` | `async function fetchSource(input) { "use step"; … }` |
| `@DBOS.step()` extract / transcribe / describe / persist | one `"use step"` function each |
| per-step `{ retries: { limit, delay, backoff } }` | `stepFn.maxRetries = N` (default 3) + `RetryableError({ retryAfter })` |
| a hard, non-retryable failure | `throw new FatalError(code)` |
| `DBOS.startWorkflow(…).run()` | `start(importWorkflow, [input])` from the queue consumer |
| status write in `@appDataSource.transaction` | a `"use step"` status write, checkpointed once on success |

The pipeline steps are `mark-running → fetch-source → extract → persist-and-ready`, with a
`catch → mark-failed`. The workflow never throws; every outcome is a recorded job status.

### Retries and error codes

A step retries up to `maxRetries` times (default 3) on any thrown error, then propagates. `FatalError`
skips retries for a permanent failure; `RetryableError({ retryAfter })` sets the backoff, and
`getStepMetadata().attempt` drives exponential delay. The import's machine error codes (`NO_RECIPE`,
`FETCH_FAILED`, `EXTRACTION_FAILED`, `MEDIA_UNAVAILABLE`, `UNSUPPORTED`) survive by throwing a
`FatalError` carrying the code; the workflow's catch maps the thrown error to the job's `error_code`.
A class instance such as today's `ImportError` cannot cross a step boundary — only serializable data
does — so the code travels as a string, not an object.

### Idempotency

The workflow's run id is the job id. A queue redelivery whose workflow already exists is a successful
no-op, not a duplicate import. Recipe ids are generated in application code (`crypto.randomUUID`), so a
replayed persist step writes the same rows rather than new ones.

## Async intake — Vercel Queues

Every import start goes through a queue. The intake route writes the `queued` job row, then `send()`s
the workflow input to the `import-intake` topic and returns 202. A push-mode consumer — a function
registered with `handleCallback` and a queue trigger — drains the topic and calls `start(importWorkflow,
[msg])`. The consumer acknowledges a successful (or already-exists) start and throws on a transient
failure so the queue redelivers, up to the retry limit, then to the dead-letter queue.

```typescript
// intake
import { send } from "@vercel/queue";
await send("import-intake", message, { idempotencyKey: jobId });

// consumer  (vercel.json: experimentalTriggers → topic "import-intake")
import { handleCallback } from "@vercel/queue";
export const POST = handleCallback(async (message) => {
  await startImport(message);   // start(importWorkflow, [message]); already-exists ⇒ no-op
});
```

Queues delivers at-least-once, so the consumer and the workflow are both idempotent on the job id. The
`idempotencyKey` on `send()` deduplicates a double intake within the retention window.

Vercel Queues also underlies WDK internally, so `start()` itself is queue-backed. The explicit intake
topic is deliberate: it decouples the fast HTTP hand-off from the durable run, absorbs spikes, and
gives the founder's required single choke point — every workflow start passes through one queue with a
dead-letter path.

## Data — Turso (libSQL)

The data layer carries over from the spike unchanged. Turso is SQLite over libSQL, reached over HTTP,
so a function opens a client per invocation with no long-lived pool. Drizzle uses `sqlite-core`; the
client is `@libsql/client`. Local tests point the client at a `file:` database; a deployed function
points it at a Turso cloud URL with an auth token from the environment.

**Schema port (Postgres → SQLite).** Nine tables — `users, recipes, ingredients, recipe_steps,
import_jobs, import_job_recipes, cookbooks, cookbook_recipes` — move to `sqlite-core` with a fixed
type map:

| Postgres | libSQL / SQLite |
|----------|-----------------|
| `uuid default gen_random_uuid()` | `text` + `$defaultFn(crypto.randomUUID)` |
| `pgEnum` | `text { enum: [...] }` |
| `numeric` | `text` (preserves precision; matches today's numeric→string models) |
| `boolean` | `integer { mode: 'boolean' }` |
| `timestamptz` | `integer { mode: 'timestamp' }` |
| `enum[]` (onboarding arrays) | `text { mode: 'json' }` |

**Transactions.** libSQL supports interactive `db.transaction()`, so the multi-row writes
(`RecipeRepository.persist`, `updateContent`, `CookbookRepository.setMembership`) keep their exact
transactional shape. Ids are application-generated to keep workflow steps replay-safe.

Two SQLite deltas carry the Postgres behaviour, each at one choke point: the cookbook duplicate-name
error matches the libSQL constraint shape (not the Postgres SQLSTATE) so it still surfaces as a 409;
and `updated_at` writes use `new Date()` because SQLite has no `now()`.

## Auth

The Node runtime keeps `jsonwebtoken` and `node:crypto`. `AuthService` ports unchanged: a per-user
P-256 keypair signs ES256 access and refresh tokens, a nonce in each token supports revocation, and an
unverified `decodeSub` loads the user whose key then verifies the token.

## Media — real video import (first-class)

Video import from TikTok, Instagram, and YouTube is a core feature and a first-class story. The Node
runtime runs the whole real path in-function: a bundled `ffmpeg-static` binary writing to `/tmp`
extracts the audio track and sampled frames from a video URL, then the real providers the current
server uses — Groq Whisper for ASR, Tesseract and Groq Qwen-VL for on-screen text, Groq for the LLM
extraction, and Apify for scraping — turn that material into a persisted recipe. Every provider is
`fetch`-based, so it runs unchanged on the Node runtime. A real video URL produces a real recipe.

The function limits leave room: `ffmpeg-static` (~80 MB) fits the media step's bundle, and a short
social clip decodes and transcribes well within the 300 s / 2 GB envelope.

### Per-frame fan-out at maximum concurrency

The founder's requirement is lowest latency: the per-frame vision work fans out so the wall-clock is
about one frame, not N frames. `ffmpeg` extracts the frames and audio in one step; then **each frame's
read runs in its own function invocation**, all concurrent, and the workflow gathers the results.

WDK expresses this directly: a `"use step"` function is one function invocation, and `Promise.all`
over per-frame steps runs them concurrently as separate invocations.

```typescript
// inside importWorkflow ("use workflow")
const { audioUrl, frameUrls } = await extractMedia(videoUrl);       // one step: ffmpeg → /tmp
const [transcript, frameTexts] = await Promise.all([
  transcribe(audioUrl),                                             // one step: Groq Whisper
  Promise.all(frameUrls.map((url) => readFrame(url))),             // N steps, one invocation each
]);
const recipe = await extract({ transcript, frameText: frameTexts.join("\n") });
```

`readFrame` runs a single frame's OCR in its own invocation. Local OCR (Tesseract) is CPU-bound with
no token cap, so per-frame invocations parallelize freely — this is the default path and it hits the
founder's max-concurrency intent cleanly.

**Tension, decided and logged: concurrency vs. provider rate limits.** The external VLM (Groq Qwen-VL)
has a token-per-minute cap; the current server hit the ~8 k TPM ceiling running a carousel's slides
through it in parallel and dropped recipes. The design keeps the server's tiered fallback so max
concurrency never drops a frame:

- **Primary, fully parallel:** every frame reads with local OCR in its own invocation. No external
  call, no rate limit — fan out as wide as the frames go.
- **Escalation, rate-limited:** only a frame whose OCR is weak (ingredients but no method, the known
  failure signature) escalates to the Groq VLM. The escalations pass through a small concurrency limit
  sized to the provider's TPM, so the rare escalation stays within the cap while the common case stays
  fully parallel.

The result honours "max concurrency, lowest latency" for the frames that dominate the work, and bounds
only the rare external-VLM escalation — no frame is dropped to a rate limit.

## What carries over vs. what is rebuilt

| Carries over from the spike | Rebuilt on Vercel |
|-----------------------------|-------------------|
| Drizzle `sqlite-core` schema + repositories | HTTP framework (Hono on Vercel Functions via Nitro) |
| `@libsql/client`, interactive `db.transaction()` | Durable engine (WDK `"use workflow"`/`"use step"`) |
| Zod domain models + `toPublic*` projections | Intake path (Vercel Queue producer + consumer) |
| Source classification, ingredient parsing, the `toRecipeRow` choke point | Test suite (fast offline tiers + real e2e) |
| One-step-per-network-call pipeline decomposition | The real media path (ffmpeg + providers on Node) |

## Local development

`vercel dev` runs the whole stack — Functions, the Queue consumer, and the Workflow engine — on the
developer's machine. Two external dependencies must be reachable, so both are provisioned once:

- **Turso.** A real Turso dev database, provisioned with the founder's Platform token. `vercel dev`
  and the e2e tier point `TURSO_DATABASE_URL` at it; the fast offline tests use a local `file:`
  database instead.
- **Vercel project.** Vercel Queues and the Workflow engine authenticate through a linked Vercel
  project: `vercel link` then `vercel env pull` writes the OIDC credentials the SDK needs to reach the
  queue service locally. Without a linked project, the queue-to-workflow path cannot run under
  `vercel dev`.

Provider keys (`GROQ_API_KEY`, `APIFY_TOKEN`) load from the environment; absent, a provider falls back
to its offline stub, which is how the fast tests stay hermetic.

## Testing and acceptance

The bar for every story and for the sprint is the same: **the real stack works under `vercel dev`** —
a real request produces a real result, including a real video import. Fast offline tests give quick
feedback along the way, but a green offline suite is not the goal.

- **Acceptance — `vercel dev`.** Each story ships a demo that drives the real stack (Vercel Functions +
  Queue + Workflow + Turso + real providers) end to end. The import stories import a real URL — a
  website, a photo, and a real TikTok/Instagram/YouTube video — to a persisted recipe, and prove
  resume-not-restart with a real faulted run.
- **Real e2e tier.** The existing `server/tests/e2e/*` suite (TikTok, YouTube, Instagram, website,
  Pinterest) ports to the new stack and runs against the real providers, kept as the `test:e2e`
  script. This is the regression net for real imports.
- **Fast feedback — offline.** Unit tests cover the pure logic (mapping, classification, ingredient
  parsing) and each step as a plain function; the data-layer tests run against a `file:` libSQL
  database with real interactive transactions; the workflow logic runs in process through
  `@workflow/vitest`. These need no network or account and run in seconds. They speed development; they
  do not replace the `vercel dev` bar.

## Migration and cutover

Replace in place. `server/` becomes the Vercel stack; the DBOS/Fastify/Postgres code is removed and its
Postgres-bound tests are rewritten to the tiers above. Because nothing is deployed, there is no
parallel app and no traffic to drain. The mobile client repoints its base URL to the Vercel deployment
when the founder decides to launch — a client-side change outside this sprint.

## Story sequence

Media is sequenced early — right after the import pipeline — so a real video import is demoable as soon
as the durable path exists. Each story ships a `vercel dev` demo of the real thing. Specs live in
`SPECS.md`; risks in `PRE-MORTEM.md`.

1. **S1 — Data layer.** Port the schema to `sqlite-core`, generate migrations, port the four
   repositories with interactive transactions and boundary parsing. The spine every other story sits
   on.
2. **S2 — Import pipeline.** The WDK workflow and its steps, the Queue producer and consumer, driven to
   `ready` for a website and photo import; a fault-injection demo proves resume-not-restart.
3. **Media / video** (sequenced here, before S3). The real ffmpeg extraction, the per-frame fan-out,
   and the real ASR/OCR/LLM providers, so a real TikTok/Instagram/YouTube URL imports to a persisted
   recipe under `vercel dev`.
4. **S3 — Auth + users + OTP.** `AuthService`, `UserService`, `OtpService`, and the OTP provider seam.
5. **S4 — Recipes + cookbooks CRUD.** The recipe and cookbook services and routes over the ported
   repositories.
6. **S5 — HTTP app assembly.** The Hono app, the health check, the error handler, and the Nitro build;
   an end-to-end `vercel dev` demo of the full flow, and the ported real e2e tier.

## Versions targeted

Node.js 24 · Hono · Nitro + `workflow` (Workflow DevKit) · `@vercel/queue` (public beta) · Drizzle ORM
`sqlite-core` + `@libsql/client` · Turso (libSQL) · `ffmpeg-static` · `tesseract.js` · Groq (Whisper +
Qwen-VL) and Apify over `fetch` · Vitest + `@workflow/vitest` · `jsonwebtoken` · `zod`. Exact versions
pin at implementation, read from the versioned Vercel, Workflow DevKit, and Turso docs — not from
memory.
