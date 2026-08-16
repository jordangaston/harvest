# Harvest server — Vercel/Turso serverless stack

The Harvest backend: Hono + Nitro on Vercel Functions, Vercel Queue + Workflow DevKit
for the durable import pipeline, and Turso/libSQL (Drizzle `sqlite-core`) for storage.
This directory replaced the old Fastify + DBOS + Postgres stack in place — one `server/`
that *is* the migrated stack.

## Layout

```
src/index.ts            # Hono API (users/auth, imports, recipes) + deployed entry
src/import-service.ts   # intake: classify → queued row → enqueue (single choke point)
src/queue-consumer.ts   # Nitro plugin: Vercel Queue consumer → starts the workflow
src/workflows/          # durable import workflow + media steps (ASR/OCR/extract)
src/fetch/, src/parse/  # provider fetchers (Apify, YouTube, Pinterest, website) + extractors
src/repositories/, src/models/  # Drizzle repos + Zod domain models (boundary parsing)
drizzle/                # versioned migrations (drizzle-kit generate → migrate)
test/                   # fast offline suite (38 tests, `npm test`)
tests/e2e/              # live e2e over `vercel dev` (`npm run test:e2e`) — real providers
```

## Commands

```
npm install
npm test              # fast offline suite (38 tests) — no network
npm run test:e2e      # live e2e: boots vercel dev, real scrape + ffmpeg + Groq (slow, $)
npm run dev           # nitro dev (NITRO_PRESET=vercel)
npm run db:generate   # generate a new versioned migration from schema.ts
npm run db:migrate    # apply pending migrations to the Turso target (.env.local creds)
```

The e2e tier reads `.env.local` (Turso creds + APIFY_TOKEN + GROQ_API_KEY) and boots one
`vercel dev` for the whole suite via `tests/e2e/helpers/global-setup.ts`, resetting the
Turso dev DB to a clean schema each run. `vercel dev` mints its own short-lived
`VERCEL_OIDC_TOKEN` (the Queue API auth) — the setup deliberately does not forward the
stale one saved in `.env.local`.

## Migration note

The old `tests/unit/` + `tests/integration/` (Fastify/pg/DBOS) suites were removed, not
ported: they exercised code that no longer exists (Fastify app, DBOS bootstrap, pg pool).
The migrated fast suite in `test/` (38 tests) covers the data layer, auth, media, and
import pipeline against a local `file:` libSQL db. The `tests/e2e/*` suites were kept and
repointed at the migrated stack through a compat harness (`tests/e2e/helpers/edge-harness.ts`).
```
