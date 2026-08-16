# Serverless migration — per-story specs

These stories migrate the in-scope backend to Vercel, sequenced on the import spine with the real
video import placed early. Each story lists what it builds, its acceptance in `vercel dev`, and its
fast-feedback tests. The architecture and the layer mapping live in `DESIGN.md`; the risks live in
`PRE-MORTEM.md`.

The bar for every story is the same: the real stack works under `vercel dev` — a real request produces
a real result. Fast offline tests give feedback; a green offline suite is not the goal.

## Shape

`server/` is replaced in place with a Vercel stack: a **Hono** app built by **Nitro** (with the
Workflow DevKit's Nitro module) and deployed as **Vercel Functions**; **Vercel Workflow (WDK)** for the
durable import pipeline; **Vercel Queues** for intake; **Turso (libSQL)** over Drizzle `sqlite-core` for
the database; the real media providers (Groq, Apify, ffmpeg) the current server uses. The old
DBOS/Fastify/Postgres code and its Postgres-bound tests are removed.

Each story is accepted by a `vercel dev` demo of the real thing, backed by the ported real e2e tier
(`test:e2e`, real providers). Fast offline tests — a `file:` libSQL database and the in-process WDK
test plugin — run in seconds and speed development. `vercel dev` needs a linked Vercel project (for
Queues and the Workflow engine) and a real Turso dev database; provider keys load from the
environment. See `DESIGN.md` → Local development.

Package layout, one folder per concern:

```
server/
  src/
    schema.ts            # pg → sqlite-core port (9 tables + onboarding enums)
    repositories/        # user, import-job, recipe, cookbook — boundary Zod parsing
    db.ts                # @libsql/client factory; connection from env
    models/              # Zod domain models + toPublic* projections
    services/            # user, otp, auth, import, recipe, cookbook
    fetch/               # media-extractor (ffmpeg-static), Apify + platform scrapers
    parse/               # asr (Groq Whisper), vision (Tesseract + Groq VLM), extractor (Groq LLM)
    providers/           # real providers by env key; absent key ⇒ offline stub (fast tests only)
    workflows/
      import-workflow.ts # "use workflow" + "use step" functions (durable pipeline + per-frame fan-out)
    queue.ts             # send() producer + handleCallback consumer (start the workflow)
    routes.ts            # Hono routes ported from api/app.ts + error handler
    index.ts             # the Hono app Nitro serves
  test/                  # fast vitest (file: libSQL, @workflow/vitest)
  tests/e2e/             # ported real e2e tier (real providers) — the test:e2e script
  drizzle/               # generated SQLite DDL
  nitro.config.ts, vercel.json, drizzle.config.ts, package.json, tsconfig.json, vitest configs
```

## S1 — Data layer

**Build.** Port `server/src/db/schema/*` to one `schema.ts` on `drizzle-orm/sqlite-core` using the
`DESIGN.md` type map: `uuid`→`text` + `$defaultFn(crypto.randomUUID)`, `pgEnum`→`text { enum }`,
`numeric`→`text`, `boolean`→`integer { mode: 'boolean' }`, `timestamptz`→`integer { mode: 'timestamp'
}`, and the onboarding `enum[]` columns → `text { mode: 'json' }`. Carry every index, foreign key,
`onDelete: cascade`, and the three unique indexes (`users_phone`, `cookbooks_user_name`,
`cookbook_recipes`). Port the four repositories, each parsing rows into its Zod model at the boundary
(`UserSchema.parse(row)`) and keeping `static create()`. Restore interactive `db.transaction()` in
`RecipeRepository.persist`, `updateContent`, and `CookbookRepository.setMembership`. Generate
migrations with `drizzle-kit generate` (dialect sqlite); apply them with an `apply-schema` script over
`@libsql/client`.

Two SQLite deltas, each at one choke point:

- **Duplicate cookbook name.** `CookbookRepository.create` catches the libSQL unique-constraint error
  (not the Postgres SQLSTATE `23505`) and throws `CookbookExistsError`. One place, all callers.
- **`updated_at`.** Use `new Date()` where Postgres used `sql\`now()\``; SQLite has no `now()`.

**Fast feedback.** Tests against a `file:` libSQL database migrated from the generated DDL: every
repository public method; the interactive-transaction persist commits recipe + ingredients + steps +
job link + status atomically and rolls all of it back on a mid-transaction throw; onboarding arrays
round-trip through JSON mode; a duplicate cookbook name raises `CookbookExistsError`; owner-scoped
reads hide foreign rows.

**Demo.** A script migrates a `file:` database, runs a successful persist and a deliberately rolled-back
transaction, and prints row counts that prove atomicity.

## S2 — Import pipeline

**Build.** The durable pipeline as a WDK workflow. `importWorkflow(input)` is marked `"use workflow"`
and orchestrates `"use step"` functions — `markRunning → fetchSource → extract → persistAndReady`,
with `catch → markFailed`. Each step returns only serializable data (URLs, text, plain records). Set
per-step `maxRetries`; a hard failure throws `FatalError(code)`, a transient one `RetryableError({
retryAfter })`. The workflow never throws; every outcome is a recorded job status. The carousel and
multi-recipe paths port into the extract/persist steps, yielding `recipe_ids` in slide order.

Intake and consumer: `POST /v1/imports` writes the `queued` row, then `send("import-intake", message,
{ idempotencyKey: jobId })`, and returns 202. A `handleCallback` consumer drains the topic and calls
`start(importWorkflow, [message])`; the run id is the job id, so a redelivery whose workflow exists is
a no-op. `vercel.json` registers the consumer's queue trigger and the dead-letter path.

**Accept — `vercel dev`.** A real website URL and a real photo import to a persisted recipe end to end:
`POST /v1/imports` enqueues, the consumer starts the workflow, and the job polls to `ready` with the
recipe linked. A fault-injected run proves resume-not-restart — the retried step re-runs while the
completed upstream steps replay from the event log, and exactly one recipe is linked.

**Fast feedback.** Each step as a plain function; the workflow through `@workflow/vitest` — a clean run
reaches `ready` and a faulted step routes to `failed` with the right `error_code`; the consumer is
idempotent on an already-exists start and rethrows a transient error so the queue retries. We test the
pipeline, not WDK's recovery.

## Media / video (real path, sequenced before S3)

**Build.** The real video import for TikTok, Instagram, and YouTube. `extractMedia` is one step:
`ffmpeg-static` reads the video URL and writes the audio track and scene-sampled frames to `/tmp`,
returning their references. The vision work fans out — `readFrame` is one `"use step"` per frame, run
concurrently with `Promise.all`, so wall-clock is about one frame. `transcribe` (Groq Whisper) runs in
parallel with the frames; `extract` (Groq LLM) turns the transcript plus joined frame text into the
recipe. Real scraping stays on Apify. Port `media-extractor`, `asr`, `vision`, and `extractor` from
`server/src`, keeping the source-type routing (`fromTikTok`, `fromYouTube`, `fromPinterest`, Apify) and
the carousel path.

Per-frame OCR uses local Tesseract (CPU, no token cap) as the primary reader, fully parallel across the
per-frame invocations. A frame with the weak-OCR signature (ingredients but no method) escalates to the
Groq Qwen-VL reader; the escalations pass through a concurrency limit sized to the provider's ~8 k TPM
cap so no frame is dropped to a rate limit. This preserves the server's tiered fallback under maximum
fan-out.

**Accept — `vercel dev`.** A real TikTok, Instagram, and YouTube video URL each import to a persisted
recipe with ingredients and steps drawn from the real transcript and on-screen text. The frames read
concurrently (visible in the run's timeline), and the escalation path stays within the provider cap.

**Fast feedback.** `ffmpeg` argument builders and the frame-path helper unit-test directly; the
tiered-fallback selection (Tesseract primary, escalate on the weak signature) tests with fixed reader
doubles; the media steps unit-test with a small fixture clip so ffmpeg extraction runs offline.

**Regression.** The ported `server/tests/e2e/{tiktok,youtube,instagram}-import` cases run against the
real providers under `test:e2e`.

## S3 — Auth + users + OTP

**Build.** Port `AuthService` unchanged on `jsonwebtoken` and `node:crypto`: a per-user P-256 keypair
signs ES256 access (15 m) and refresh (30 d) tokens, a `type` and `nonce` claim support revocation,
and `decodeSub` reads the subject before verification. Port `UserService` (create, sign-in by OTP or
refresh token, `getMe`, provision with onboarding columns), `OtpService`, the OTP provider seam
(absent Twilio keys ⇒ the stub that approves a fixed code), and `normalizeE164`.

**Fast feedback.** Tests: a mint-then-verify round-trip; a wrong-`type` token rejects; a bumped nonce
revokes; sign-in by OTP and by refresh token; provision maps the onboarding enums and arrays to
columns; the stub OTP approves only its fixed code.

**Demo.** A script mints a token, verifies it, and shows a nonce bump revoking it — offline.

## S4 — Recipes + cookbooks CRUD

**Build.** Port `RecipeService` (get, in-place owner-only edit that re-parses ingredient lines, delete
that cascades) and `CookbookService` (create, list with cover and count, get, set membership) over the
ported repositories. Port `parseIngredientLine`, `mapIngredientIcon`, the nutrition label-core keys,
and the `toPublic*` projections.

**Fast feedback.** Tests: a recipe read returns the public projection with ordered ingredients and
steps; an edit re-parses and replaces in one transaction; a delete cascades and a non-owner gets 404;
a duplicate cookbook name gets 409; a list computes count and cover; set-membership makes membership
exactly the caller's owned subset.

**Demo.** A script creates a cookbook, persists a recipe, files it, edits it, lists it, and deletes it
— offline.

## S5 — HTTP app assembly

**Build.** Port every route from `src/api/app.ts` to Hono (`routes.ts`): the same paths, the same Zod
request schemas, the same status codes, and the same `{ error: { code, message } }` handler mapping
`AppError` and `ZodError`. The bearer guard becomes Hono middleware that stamps the caller's id. The
health check probes libSQL with `select 1` (200 / 503). Assemble the Hono app (`index.ts`) and the
Nitro build (`nitro.config.ts`, `modules: ["workflow/nitro"]`). `vercel.json` carries the queue
consumer trigger and the dead-letter queue.

**Accept — `vercel dev`.** The full real flow: the health check, then create a user, import a website
recipe, import a real video, poll each to `ready`, read a recipe, and file it in a cookbook — all
against the real stack. The ported `server/tests/e2e/*` suite runs green under `test:e2e` against the
real providers.

**Fast feedback.** Integration tests drive the Hono app with `app.request()` over a `file:` libSQL
database: the guard returns 401 without a token; each route returns its ported shape and status; an
unsupported source returns 422; a foreign job returns 404.

## Cross-story invariants

From `server/CLAUDE.md`: migrations only; repositories parse at the boundary; classes with `static
create()`; one job per function; cross-cutting invariants at the shared choke point (`toRecipeRow`, the
duplicate-name catch); the tiered-fallback preserved under the per-frame fan-out. The bar is the real
stack under `vercel dev` and the real e2e tier; the fast offline tests use the absent-key-⇒-stub seam
to stay hermetic for quick feedback, not as the definition of done.
