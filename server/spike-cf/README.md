# `spike-cf/` — Cloudflare-serverless target (throwaway prototype)

**Not production.** A parallel prototype for the Wave-3 serverless spike. It changes no `src/` code
and runs entirely locally — `wrangler dev` for the Worker/Workflow, a local `turso dev` libSQL server
for the database — with no Cloudflare or Turso account. Delete it when the spike closes. See
`docs/sprint-serverless-spike/RECOMMENDATION.md`.

## What it proves

The Harvest recipe-import pipeline runs on Cloudflare with **zero long-lived processes**:

- **HTTP API → Worker (Hono).** `src/worker.ts` ports the Fastify intake/poll routes.
- **DBOS pipeline → Cloudflare Workflow.** `src/import-workflow.ts` maps each `@DBOS.step`
  (mark-running → fetch → extract → persist-and-ready) onto a `step.do(...)` durable step.
- **Postgres → Turso (libSQL).** `src/schema.ts` re-targets Drizzle to `sqlite-core`; `src/db.ts`
  persists through a real interactive **`db.transaction()`** (libSQL supports it — no D1 `batch`
  workaround), reached over `@libsql/client/web` (`src/edge-db.ts`).
- **Offline stubs** (`src/providers.ts`) stand in for scrape/extract, so the proof is hermetic.

## Run

Full runbook (run + test + CI + gotchas): **`docs/sprint-serverless-spike/LOCAL-DEV.md`**. Needs the
Turso CLI (`curl -sSfL https://get.tur.so/install.sh | bash` — one-time, no account).

```bash
npm install
npm run db:generate      # drizzle-kit → SQLite DDL (already committed under drizzle/)
npm test                 # offline tests: pure logic + the libSQL layer on @libsql/client (file:)
npm run proof            # end-to-end proof (boots turso dev + wrangler dev, asserts, tears down)
```

`npm run proof` prints, and asserts:

```
2. CLEAN import → ready via durable steps (interactive libSQL txn)  → status ready, recipe persisted
3. FAULTED import → recovers and reaches ready                       → status ready, fault_attempts 2
4. memoization: fetch-source=1 extract=2 persist-and-ready=1
5. libSQL integrity: recipes linked to faulted job: 1
== PROOF PASSED ==
```

## The recovery demo (durability, not restart)

Passing `"faultStep":"extract"` makes the `extract` step throw once. Cloudflare Workflows retries
**only that step**; the completed upstream steps (`mark-running`, `fetch-source`) return their
checkpointed results without re-executing. The step-log counts prove it — `extract` runs twice, its
neighbours once — and libSQL holds exactly one recipe for the job. The Workflow **resumed**; it did
not restart. This is the same durability guarantee DBOS gave us, delivered with no process kept alive.

## Versions targeted

Wrangler `4.123.0` · compatibility-date `2026-08-14` · `nodejs_compat` · drizzle-orm `0.44.7` ·
drizzle-kit `0.31.10` · hono `4.13.2` · zod `4.4.3` · `@libsql/client` `0.17.4` · Turso CLI `v1.0.31` ·
Node `24`. Turso **Free** tier. Local dev: `@libsql/client` `file:` (tests) + `turso dev` libSQL
server (the Worker, over HTTP).
