# Wave 3 — Full serverless re-architecture on Cloudflare (BRIEF v2 — SUPERSEDES v1)

**This supersedes the v1 brief and its conclusion.** v1 answered the wrong question ("can DBOS
itself run serverless" → no). The real assignment is the opposite direction: **replace DBOS with a
serverless-native durable-execution engine and move the *entire* backend to serverless — no
long-lived processes remain.** The v1 "keep one long-lived container" recommendation is void. Treat
the prior `server/spike/` proof + `RECOMMENDATION.md` as obsolete; replace them.

## The goal (unambiguous)

Re-architect the Harvest backend to run **fully on Cloudflare serverless**. **Zero long-lived
processes** — the always-on Fastify server and the DBOS executor both go away. Prove the durable
recipe-import pipeline still works end-to-end under this model.

## Target stack — Cloudflare (confirm every API against the VERSIONED Cloudflare docs first)

**Read `developers.cloudflare.com` for each of these before writing code — do not guess APIs.**

- **HTTP API → Cloudflare Workers.** Port the Fastify routes to a Worker (Hono is the idiomatic
  router on Workers and maps cleanly from Fastify). Same routes, same Zod validation, same auth.
- **DBOS import pipeline → Cloudflare Workflows.** This is the crux. Cloudflare Workflows is
  Cloudflare's durable-execution primitive (`WorkflowEntrypoint`, `step.do(...)` with automatic
  retries and durable, replay-safe state that survives instance eviction). Map the DBOS workflow
  (one `@DBOS.step` per network call: scrape → OCR/ASR/VLM → persist) onto Workflow steps. The
  durability guarantee DBOS gave us must be preserved by Workflows — prove it.
- **Async intake → Cloudflare Queues** (or trigger a Workflow directly from the intake Worker).
- **Scheduled work → Cron Triggers** (if anything needs it).
- **Database → migrate to Cloudflare D1 (DECIDED — not open).** The founder's call: move the
  database to **D1** (Cloudflare's serverless SQLite), not Hyperdrive/Postgres. This is the biggest
  single change and part of the scope:
  - **Drizzle moves from `pg-core` to `sqlite-core`** (`drizzle-orm/d1`). Re-map every Postgres-only
    type: `uuid` → `text` (generate UUIDs in app code), `jsonb` → `text` with a JSON codec,
    Postgres **enums** → `text` + a check/union, `text[]` **arrays** → JSON `text`, `timestamptz` →
    `integer` (epoch) or ISO `text`. Enumerate each in the migration map.
  - **Regenerate migrations for the SQLite/D1 dialect** (`drizzle-kit` with the D1 driver) — the
    existing `server/drizzle/*.sql` Postgres migrations don't carry over.
  - **Tests** move off the local Postgres to D1 local (miniflare/`wrangler dev` provides a local D1
    SQLite; Drizzle can also run against better-sqlite3 for unit tests). Keep them green + offline.
  - Call out anything that leans on Postgres-specific behavior (transactions across the pipeline,
    `LISTEN/NOTIFY` — gone with DBOS anyway, `ON CONFLICT`, partial indexes) and how it maps to D1.

**Keep** the parts that are portable: the **Zod domain models** and the repository/service structure
wherever they survive the Workers runtime (no Node-only APIs). The **Drizzle layer stays Drizzle** —
but re-targeted at D1's SQLite dialect.

## What to produce

1. **Design/recommendation doc** — `docs/sprint-serverless-spike/RECOMMENDATION.md` (replace the old
   one): the target Cloudflare architecture, a **layer-by-layer migration map** (Fastify→Workers,
   DBOS→Workflows, pool→Hyperdrive, intake→Queues), the **DBOS-step → Workflow-step** mapping for the
   import pipeline, the Postgres-access decision with its trade-offs, what has to change vs. what
   ports as-is (Node APIs that don't exist on Workers are a key risk — enumerate them), a migration
   outline, and residual risks. Underwhelm the reader.
2. **A working proof** — the recipe-import pipeline (or a representative slice) running as a
   **Cloudflare Workflow** locally via **wrangler / workerd (miniflare)**, driven by a **Worker**
   route, reading/writing Postgres through the **recommended access path**, with **no long-lived
   process**. The bar: an import runs to `ready` through durable Workflow steps, AND you demonstrate
   **durability/recovery** (a step fails/instance is evicted → the Workflow resumes and completes,
   not restarts from zero). Offline/stubbed providers (no real scrape/VLM network), same as the
   existing suite. If a hard blocker exists (a Node-only dependency in the pipeline with no Workers
   equivalent), demonstrate it concretely and say what it would take.
3. **`SPRINT-REPORT.md` + `POSTMORTEM.md`** (update in place).

## Constraints

- **Spike, not a merge-to-prod migration** — build the Cloudflare target as a **parallel prototype**
  (e.g. `server/spike-cf/` or a `workers/` dir) so production `src/` stays intact and the existing
  suite stays green. The point is to prove the architecture, not to cut over today.
- **Read the versioned Cloudflare docs before writing code** (Workers, Workflows, Queues, Hyperdrive,
  Wrangler). State the exact Wrangler/compat-date + library versions you targeted in the report.
- **No long-lived process anywhere** in the target design — that's the whole point. If some piece
  seems to need one, that's a finding: name it and propose the serverless equivalent.
- Follow `server/CLAUDE.md` principles (classes + `static create()`, model the domain, laziest rung).
- Decide-and-log blockers; don't stall. **Escalate to the coordinator** with a specific ask only if
  you truly need a **paid Cloudflare account or a real remote deploy** — `wrangler dev` local
  emulation (Workers + Workflows + Queues + Hyperdrive-to-local-Postgres) should cover the proof.

## Done

Replaced RECOMMENDATION.md (Cloudflare target + migration map) + a working local Cloudflare-Workflows
proof of the import pipeline (durable + recovery, no long-lived process) + updated sprint docs;
production `src/` untouched; existing suite green. Report `worker_done` with: the one-line verdict
(is a full Cloudflare-serverless backend viable? what's the recommended shape?), the proof evidence
(an import reaching `ready` via Workflow steps + a demonstrated resume/recovery), the
Postgres-access decision, the exact Cloudflare/Wrangler versions targeted, and any founder ask.
