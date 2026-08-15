# Serverless re-architecture (Cloudflare) — recommendation

**Verdict: Yes. A full Cloudflare-serverless backend is viable, and it is the recommended shape.**
Cloudflare Workflows preserves the exact durability guarantee DBOS gave us — a failed step resumes,
it does not restart — with **no long-lived process**. The HTTP layer, the durable pipeline, and the
async model run on Cloudflare; the database is **Turso (libSQL)**, reached over HTTP so it needs no
pool. One piece does not fit the Workers runtime — **video decoding (ffmpeg)** — and it has a bounded
serverless answer. Everything else ports.

This is a spike, not a migration. Production `src/` is untouched and its suite stays green (91/91).
The prototype lives in `server/spike-cf/` and runs entirely locally — `wrangler dev` for the
Worker/Workflow, a local `turso dev` libSQL server for the database, no Cloudflare or Turso account.

## Recommended target

| Layer | Today | Cloudflare target |
|-------|-------|-------------------|
| HTTP API | Fastify (long-lived) | **Worker + Hono** — same routes, same Zod validation |
| Durable pipeline | DBOS workflow + steps | **Cloudflare Workflow** — `WorkflowEntrypoint` + `step.do()` |
| Async intake | `DBOS.startWorkflow` | Intake → **Cloudflare Queue** → consumer → Workflow (every import is enqueued) |
| Database | Postgres + `pg` pool | **Turso (libSQL)** + Drizzle `sqlite-core`, over `@libsql/client/web` |
| Scheduled work | — (none) | Cron Triggers (not needed today) |

No process stays alive between requests. An isolate serves a request and stops; the Workflow engine,
not a worker we run, drives the import to completion and recovers it after a fault.

## What the proof shows

`server/spike-cf/` — a Worker (Hono) enqueues each import to a Cloudflare Queue whose consumer starts
a Cloudflare Workflow that imports a recipe into Turso (libSQL), offline, over a local `turso dev`
server. Run it with `npm run proof`. It asserts:

| Check | Result |
|-------|--------|
| Clean import through durable steps | job **`ready`**, recipe persisted via one interactive libSQL transaction |
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

## Database: Postgres → Turso (libSQL)

Turso is SQLite over **libSQL** — SQLite-compatible, but a hosted database reached over HTTP, so it
runs from Workers with no long-lived pool. (The founder chose it over D1.) Drizzle moves from
`pg-core` to `sqlite-core`; the **schema and the type-map are identical to any SQLite target** — the
change from the earlier D1 plan is only the **driver and access path**, plus a transaction *win*.

**Driver & access path.** `drizzle-orm/d1` (a Cloudflare binding) → `drizzle-orm/libsql` with
`@libsql/client`. On Workers use the **`@libsql/client/web`** build — HTTP-only, Node-free, the one
that runs on workerd (the `file:` node build does not). Connection comes from env, not a binding:
`TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN` for cloud). See `spike-cf/src/edge-db.ts`.

**Type map** (unchanged from any Postgres→SQLite move; applied in `spike-cf/src/schema.ts`):

| Postgres | libSQL / SQLite | Note |
|----------|-----------------|------|
| `uuid` `default gen_random_uuid()` | `text` + `$defaultFn(crypto.randomUUID)` | SQLite has no server-side UUID; generate in app code |
| `pgEnum` | `text` + `{ enum: [...] }` union | type-safe in Drizzle; add a `CHECK` if DB-level enforcement is wanted |
| `numeric` | `text` | preserves precision, matches today's pg-`numeric`→string models |
| `boolean` | `integer { mode: 'boolean' }` | |
| `timestamptz` | `integer { mode: 'timestamp' }` (epoch) | ISO `text` is the alternative |
| `enum[]` (e.g. `users.goals`) | `text { mode: 'json' }` | arrays become JSON text |

**Transactions — the win over D1.** libSQL **supports interactive `db.transaction()`**, so the
D1 `db.batch()` workaround is gone. `RecipeRepository.persist` (recipe + ingredients + steps in one
`db.transaction`) ports **as-is** — the proof's `persistAndReady` wraps the recipe, its children, the
job link, and the terminal status in a single interactive transaction (`spike-cf/src/db.ts`). Ids are
still app-generated (`crypto.randomUUID`) to keep Workflow steps replay-safe, but the atomic
multi-row write is now the natural Drizzle transaction, not a collapsed batch.

**Postgres-specific behaviour, mapped:** cross-table transaction → real `db.transaction()`;
`ON CONFLICT` upserts → SQLite supports the same clause (Drizzle `onConflictDoUpdate`); partial
indexes → SQLite supports them; `LISTEN/NOTIFY` → gone with DBOS, replaced by the Workflow engine.
Migrations regenerate from `sqlite-core` via `drizzle-kit generate` (dialect `sqlite`) and apply with
`@libsql/client` `executeMultiple` (`scripts/apply-schema.mjs`) against a local file / `turso dev`
(dev) or a Turso cloud URL (deploy); the existing `server/drizzle/*.sql` Postgres migrations do not
carry over.

**Pricing.** Turso **Free** tier covers this workload comfortably: 100 databases, 5 GB storage,
500 M row reads/mo, 10 M row writes/mo, 3 GB syncs (turso.tech/pricing, read Aug 2026). Paid tiers:
Developer $4.99/mo, Scaler $24.92/mo, Pro $416.58/mo, Enterprise custom.

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
| `pg` | `db/index.ts` | Moot | Replaced by libSQL (`@libsql/client/web`) |
| `apify-client`, `twilio` | fetchers, OTP | Likely (HTTP SDKs); verify | Keep behind their seams, or call the REST APIs directly |

**The single genuine blocker is video decoding.** The clean framing: move **ASR and vision to Workers
AI** (removes tesseract and, optionally, Groq), and keep **one instance-scoped ffmpeg container** for
the narrow job of pulling audio and sampled frames from a video URL. That container is invoked
per-step and torn down — not a long-lived process. Images and carousels (no video decode) need no
container at all once OCR is Workers AI. The stubs in `spike-cf/src/providers.ts` mark exactly these
seams.

## Migration outline

1. **Data layer.** Port `db/schema/*` to `sqlite-core` (type map above); regenerate migrations;
   point the repositories at `drizzle-orm/libsql` (`@libsql/client/web` on Workers). The multi-row
   writes (`persist`, edits) keep their `db.transaction()` — libSQL supports it.
2. **Workflow.** Port `ImportPipeline`/`ImportWorkflow` to a `WorkflowEntrypoint`, one `step.do` per
   provider call; set per-step retries.
3. **Media.** Move OCR/ASR to Workers AI bindings; put ffmpeg audio/frame extraction behind a
   container (or external service) the video step calls.
4. **HTTP.** Port Fastify routes to Hono on a Worker; swap `jsonwebtoken` → `jose`; keep Zod as-is.
5. **Intake.** The intake route writes the `queued` row and **enqueues** to a Cloudflare Queue; the
   Worker's `queue()` consumer drains the batch and starts the Workflow (id = jobId, so a redelivery
   is idempotent). This is the standard path — every import is enqueued, not only under load.
6. **Cut over** behind the mobile client's existing base-URL config; run both until parity holds.

## Residual risks

- **Video decode needs a container.** Bounded and understood (above), but it is real infra to stand
  up — the only piece that is not a plain Worker.
- **libSQL is a network hop, not a local binding.** Unlike D1 (colocated with the Worker), every
  query is HTTP to Turso, so it adds latency and an external dependency the Cloudflare-native path
  avoids; interactive transactions hold a stream across round-trips, so keep them short. Mitigations
  if this bites: Turso **embedded replicas** (a local read copy synced from cloud) or reverting the DB
  to D1. Egress/row-count sit inside the Free tier for this workload but must be watched at scale.
- **Even local dev needs a libSQL server for the Worker.** `@libsql/client/web` cannot open a `file:`
  db, so the workerd proof runs a local `turso dev` server (offline, no account). Node tests use the
  `file:` client directly. D1 gave local SQLite inside miniflare for free; libSQL does not.
- **Numeric-as-text.** Any server-side arithmetic on `numeric` columns must cast; today they are only
  stored and echoed, so this is latent, not active.
- **Workers AI quality parity.** OCR/VLM output must be validated against today's Tesseract+VLM tiering
  before cutover; the tiered-fallback design (`server/CLAUDE.md`) still applies.

## Versions targeted

Wrangler **4.123.0** · compatibility-date **2026-08-14** · `nodejs_compat` · drizzle-orm **0.44.7** ·
drizzle-kit **0.31.10** · Hono **4.13.2** · Zod **4.4.3** · `@libsql/client` **0.17.4** · Turso CLI
**v1.0.31** (local `turso dev` libSQL server) · Node **24**. Turso **Free** tier. APIs confirmed
against their versioned docs before coding: Cloudflare Workflows Workers-API, `docs.turso.tech`
(local `file:`/`turso dev`, `@libsql/client/web` on Workers), `turso.tech/pricing`, and the
`drizzle-orm/libsql` docs (interactive transactions, client builds).

## Reproduce

```bash
cd server/spike-cf && npm install && npm run proof   # offline; boots turso dev + wrangler dev, asserts, tears down
```

The proof needs the Turso CLI for the local libSQL server (`curl -sSfL https://get.tur.so/install.sh
| bash` — one-time, like wrangler; no account). See `server/spike-cf/README.md`, and **`LOCAL-DEV.md`**
for the full run-and-test runbook (local `turso dev` + `wrangler dev`, the two test tiers, how to test
Workflow durability locally, and CI).
