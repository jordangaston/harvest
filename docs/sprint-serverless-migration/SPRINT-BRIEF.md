# Serverless migration — implementation sprint (BRIEF)

You are the **Feature Lead**. The Cloudflare spike proved the shape of a serverless backend; this
sprint **implements the real migration on Vercel**. Run a **full `/autonomous-sprint`** (analyze
reference material → one batch of clarifying questions → per-story specs → pre-mortem → implement
without stopping, decide-and-log every blocker → demo each story → sprint report). Author design/spec
prose with `/writing-design-documents`, edit all prose with `/writing-clearly-and-concisely`. Read
`CLAUDE.md`, `AGENTS.md`, and `server/CLAUDE.md` first. Work only in this `serverless-migration`
worktree (branch `jordangaston/serverless-migration`).

Every document you write — the design, the specs, the pre-mortem — is a **clean, standalone Vercel
document**. Do not annotate a Cloudflare doc with "use Vercel instead"; write it as if Vercel was
always the target.

## The target

Migrate the production backend (`server/`, today **Fastify + DBOS + Postgres**) to **fully serverless
on Vercel** with **zero long-lived processes**:

| Layer | From | To |
|-------|------|----|
| HTTP API | Fastify | **Vercel Functions** (Node.js runtime) — same routes, same Zod, same auth |
| Durable pipeline | DBOS workflow/steps | **Vercel Workflow (WDK)** — durable steps, retries, resume |
| Async intake | in-process start | **Vercel Queues** → consumer → Workflow (ALL workflow starts go through a queue; retries + DLQ) |
| Database | Postgres + `pg` | **Turso (libSQL)** + Drizzle `sqlite-core`; **local = `file:` libSQL** |

**What carries over from the spike, unchanged:** the **Turso/libSQL data layer** (Drizzle
`sqlite-core` schema, repositories, `@libsql/client`, interactive `db.transaction()`), the **Zod
domain models**, and the pipeline's decomposition (one durable step per provider call). The Node.js
runtime keeps `jsonwebtoken` working (no `jose` swap) and lets **ffmpeg run in-function** (bundled
binary + ephemeral `/tmp`) — assess Vercel function duration/memory limits and decide-and-log whether
to land media this sprint.

Non-negotiables: interactive `db.transaction()` (libSQL supports it), the durable resume-not-restart
guarantee, migrations-only, classes with `static create()`, model the domain, and **read the
versioned Vercel + Turso docs before writing code** (you have the Vercel skills/CLI and the Turso
docs — do not rely on memory; both our training on Vercel is stale).

## Decisions already made (founder)

1. **Scope** — the whole in-scope backend, sequenced as stories on the import spine: **S1** data layer
   (pg→`sqlite-core` schema + repos + migrations, offline-tested), **S2** import pipeline
   (Queue→Workflow→Turso, generalized from the spike), **S3** auth + users + OTP, **S4** recipes +
   cookbooks CRUD, **S5** HTTP app assembly + health + cutover wiring.
2. **Media / ffmpeg** — the Node runtime runs ffmpeg in-function, so the Cloudflare-Container blocker
   is gone. Assess the function limits; land media in-function if it fits, else decide-and-log a
   deferral. ffmpeg itself is a local binary (offline-testable); only the ASR/OCR providers stay
   stubbed offline.
3. **Cutover** — **replace in place.** DBOS/Fastify is not deployed; do not keep it running or build a
   parallel app. Replace `server/` with the Vercel stack and rewrite its tests. The new offline suite
   must be green.
4. **Data** — greenfield Turso schema (fresh migrations, no Postgres copy — pre-launch, no prod data).
5. **Dev** — fully offline: tests on `file:` libSQL, demos on `vercel dev`. The founder's
   `TURSO_API_KEY` (at `/Users/jordangaston/orca/workspaces/harvest/remaining-features/server/.env`)
   provisions a dev Turso DB only if needed for a live smoke — **never print or commit it or any
   derived token/URL**.

## First deliverable — design, then stop for review

Before implementing, write the design as **`docs/sprint-serverless-migration/DESIGN.md`** (a clean
Vercel-native document). Read the **versioned Vercel docs first** — Vercel Functions + the Node
runtime's limits, **Vercel Workflow (WDK)** (durable steps, retries, resume) as the DBOS replacement
with the **DBOS-step → WDK-step mapping**, and **Vercel Queues** (topics/consumer-groups/retries) as
the intake path — plus the Turso docs. Cover: the target architecture, the layer-by-layer mapping,
what carries over vs. what's rebuilt, the media-in-function plan bounded by the exact function limits,
the offline-testing approach for Queues/WDK, and the S1–S5 sequence. Then **stop and report** —
the coordinator reviews the design with the founder before you implement.

## Done

The in-scope backend runs on Vercel Functions + Queues + Workflow + Turso, zero long-lived processes,
a green offline suite, and a per-story demo. Report `worker_done` with the migrated surface, the
test/demo evidence, versions targeted, and anything deferred (with why).
