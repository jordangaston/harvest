# Serverless re-architecture (Cloudflare) — recommendation

**Verdict: Yes. A full Cloudflare-serverless backend is viable, and it is the recommended shape.**
Cloudflare Workflows preserves the exact durability guarantee DBOS gave us — a failed step resumes,
it does not restart — with **no long-lived process**. The HTTP layer, the durable pipeline, the
async model, and the data layer all have first-party Cloudflare homes. One piece does not fit the
Workers runtime — **video decoding (ffmpeg)** — and it has a bounded serverless answer. Everything
else ports.

This is a spike, not a migration. Production `src/` is untouched and its suite stays green (91/91).
The prototype lives in `server/spike-cf/` and runs entirely in `wrangler dev` local emulation.

## Recommended target

| Layer | Today | Cloudflare target |
|-------|-------|-------------------|
| HTTP API | Fastify (long-lived) | **Worker + Hono** — same routes, same Zod validation |
| Durable pipeline | DBOS workflow + steps | **Cloudflare Workflow** — `WorkflowEntrypoint` + `step.do()` |
| Async intake | `DBOS.startWorkflow` | Worker triggers the Workflow directly (Queues only if we need buffering) |
| Database | Postgres + `pg` pool | **D1** (SQLite) + Drizzle `sqlite-core` |
| Scheduled work | — (none) | Cron Triggers (not needed today) |

No process stays alive between requests. An isolate serves a request and stops; the Workflow engine,
not a worker we run, drives the import to completion and recovers it after a fault.

## What the proof shows

`server/spike-cf/` — a Worker (Hono) drives a Cloudflare Workflow that imports a recipe into D1,
offline. Run it with `npm run proof`. It asserts:

| Check | Result |
|-------|--------|
| Clean import through durable steps | job **`ready`**, recipe persisted to D1 |
| Faulted import (`extract` throws once) | job **`ready`** — the Workflow **resumed** |
| Step execution counts for the faulted run | `fetch-source` **1**, `extract` **2**, `persist-and-ready` **1** |
| Recipes linked to the faulted job | **exactly 1** (no restart, no duplicate) |

The middle two rows are the durability claim. When `extract` threw, the engine re-entered `run()`,
returned the checkpointed results of `mark-running` and `fetch-source` **without re-executing them**,
retried only `extract`, and ran `persist-and-ready` once. That is resume-not-restart — the guarantee
DBOS gave us — delivered with nothing kept alive. A local `wrangler dev` cannot literally evict an
isolate on command, but a thrown step exercises the identical replay path an eviction triggers:
`run()` re-executes and completed steps are read back from durable storage.

## DBOS step → Workflow step

The pipeline's shape is unchanged. Each `@DBOS.step` becomes a `step.do(name, cb)`; the workflow still
does only status + exceptions.

| DBOS (`server/src/pipeline`) | Workflow step (`spike-cf/src/import-workflow.ts`) |
|------------------------------|---------------------------------------------------|
| `ImportWorkflow.markRunning` | `step.do('mark-running')` |
| `ImportPipeline.fetchSource` (scrape) | `step.do('fetch-source')` |
| `ImportPipeline.transcribe` / `describeVideo` / `readSlideRecipe` (ASR/OCR/VLM) | `step.do('extract')` in the slice; one step per provider call at full scale |
| `ImportPipeline.extract` (LLM) | folded into `extract` in the slice; its own step at full scale |
| `ImportWorkflow.markReady` (persist + link + status) | `step.do('persist-and-ready')` — one D1 batch |
| `ImportWorkflow.markFailed` | `catch → step.do('mark-failed')` |

Two DBOS conventions survive intact: steps pass only serializable data (URLs/text, never Buffers), and
the workflow never throws — every outcome is a recorded status. Retries move from DBOS defaults to
per-step `{ retries: { limit, delay, backoff } }`.

## Database: Postgres → D1 (the biggest change)

D1 is SQLite. Drizzle moves from `pg-core` to `sqlite-core`; the queries and the repository structure
survive, the column types and one write pattern do not.

**Type map** (all applied in `spike-cf/src/schema.ts`):

| Postgres | D1 / SQLite | Note |
|----------|-------------|------|
| `uuid` `default gen_random_uuid()` | `text` + `$defaultFn(crypto.randomUUID)` | SQLite has no server-side UUID; generate in app code |
| `pgEnum` | `text` + `{ enum: [...] }` union | type-safe in Drizzle; add a `CHECK` if DB-level enforcement is wanted |
| `numeric` | `text` | preserves precision, matches today's pg-`numeric`→string models |
| `boolean` | `integer { mode: 'boolean' }` | |
| `timestamptz` | `integer { mode: 'timestamp' }` (epoch) | ISO `text` is the alternative |
| `enum[]` (e.g. `users.goals`) | `text { mode: 'json' }` | arrays become JSON text |

**The one write-pattern change — transactions.** D1 has **no interactive `db.transaction()`**. Its
atomic primitive is **`db.batch([...])`**, which runs the statements as one SQL transaction and rolls
back on failure. `RecipeRepository.persist` (recipe + ingredients + steps in one `db.transaction`)
becomes one `db.batch`, and because SQLite has no `RETURNING`-into-a-transaction flow, the recipe id
is generated in app code up front so later statements in the batch can reference it. See
`spike-cf/src/db.ts` — the whole persist-and-mark-ready is a single atomic batch.

**Postgres-specific behaviour, mapped:** cross-table transaction → `batch()` (above); `ON CONFLICT`
upserts → SQLite supports the same clause (Drizzle `onConflictDoUpdate`); partial indexes → SQLite
supports them; `LISTEN/NOTIFY` → gone with DBOS, replaced by the Workflow engine. Migrations
regenerate from `sqlite-core` via `drizzle-kit generate` (dialect `sqlite`) and apply with
`wrangler d1 execute --local` (dev) / `wrangler d1 migrations apply` (deploy); the existing
`server/drizzle/*.sql` Postgres migrations do not carry over.

## The key risk — Node-only APIs that Workers lacks

Most of the backend is already runtime-neutral (Zod, Drizzle queries, the orchestrator, `fetch`-based
providers). The Workers runtime has no `child_process` and no filesystem, which the media path relies
on. Enumerated from `server/src`:

| Node API / dep | Where | Works on Workers? | Serverless answer |
|----------------|-------|-------------------|-------------------|
| `spawn('ffmpeg')` | `fetch/media-extractor.ts` (audio + frame sampling, image scale) | **No** — no `child_process` | Move video decode to a **Cloudflare Container** (instance-scoped, not long-lived) or an external media service; the step calls it as a subrequest |
| `tesseract.js` (WASM + web workers) and `spawn('tesseract')` | `parse/vision.ts` (local OCR) | Native binary **no**; WASM heavy/risky | **Workers AI** image-to-text binding replaces OCR outright |
| Whisper/Groq ASR | `parse/asr.ts` (`fetch`) | Yes (HTTP) | Keep, or move to **Workers AI** Whisper to drop a vendor |
| `node:fs/os/path` (`mkdtemp`, `tmpdir`) | `import-pipeline.ts`, `media-extractor.ts` | **No** — no filesystem | Unneeded once decode is a container/service returning text; steps already pass URLs/text |
| `jsonwebtoken` (`node:crypto`) | `services/auth-service.ts` | Partial (needs `nodejs_compat`) | Swap to **`jose`** (Web Crypto, Workers-native) — small change |
| `pg` | `db/index.ts` | Moot | Replaced by D1 |
| `apify-client`, `twilio` | fetchers, OTP | Likely (HTTP SDKs); verify | Keep behind their seams, or call the REST APIs directly |

**The single genuine blocker is video decoding.** The clean framing: move **ASR and vision to Workers
AI** (removes tesseract and, optionally, Groq), and keep **one instance-scoped ffmpeg container** for
the narrow job of pulling audio and sampled frames from a video URL. That container is invoked
per-step and torn down — not a long-lived process. Images and carousels (no video decode) need no
container at all once OCR is Workers AI. The stubs in `spike-cf/src/providers.ts` mark exactly these
seams.

## Migration outline

1. **Data layer.** Port `db/schema/*` to `sqlite-core` (type map above); regenerate D1 migrations;
   rewrite the multi-row writes (`persist`, edits) from `db.transaction` to `db.batch`.
2. **Workflow.** Port `ImportPipeline`/`ImportWorkflow` to a `WorkflowEntrypoint`, one `step.do` per
   provider call; set per-step retries.
3. **Media.** Move OCR/ASR to Workers AI bindings; put ffmpeg audio/frame extraction behind a
   container (or external service) the video step calls.
4. **HTTP.** Port Fastify routes to Hono on a Worker; swap `jsonwebtoken` → `jose`; keep Zod as-is.
5. **Intake.** Trigger the Workflow from the intake route (add a Queue only if buffering is needed).
6. **Cut over** behind the mobile client's existing base-URL config; run both until parity holds.

## Residual risks

- **Video decode needs a container.** Bounded and understood (above), but it is real infra to stand
  up — the only piece that is not a plain Worker.
- **D1 limits.** ~10 GB per database and no interactive transactions. Fine for this workload; revisit
  if a write needs read-modify-write across many rows in one logical transaction (`batch` is
  all-or-nothing but not interactive).
- **Numeric-as-text.** Any server-side arithmetic on `numeric` columns must cast; today they are only
  stored and echoed, so this is latent, not active.
- **Workers AI quality parity.** OCR/VLM output must be validated against today's Tesseract+VLM tiering
  before cutover; the tiered-fallback design (`server/CLAUDE.md`) still applies.

## Versions targeted

Wrangler **4.123.0** · compatibility-date **2026-08-14** · `nodejs_compat` · drizzle-orm **0.44.7** ·
drizzle-kit **0.31.10** · Hono **4.13.2** · Zod **4.4.3** · Node **24**. D1 local via miniflare
(`.wrangler/state`); unit tests via better-sqlite3 **11.10.0**. All Cloudflare APIs were confirmed
against `developers.cloudflare.com` before coding (Workflows Workers-API, Hyperdrive/D1 bindings, D1
`batch` semantics, Drizzle D1).

## Reproduce

```bash
cd server/spike-cf && npm install && npm run proof   # offline; boots wrangler dev, asserts, tears down
```

See `server/spike-cf/README.md`.
