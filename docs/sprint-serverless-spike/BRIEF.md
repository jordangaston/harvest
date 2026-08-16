# Wave 3 — Serverless migration spike (BRIEF)

You are the **Feature Lead** for the final Wave-3 task. This is a **spike**: an investigation that
ends in a **recommendation backed by a working proof**, **not** a production migration. Do not rip out
the current server. The deliverable is evidence + a decision, plus the smallest prototype that proves
(or disproves) it.

Run a **full `/autonomous-sprint`** (clarify → design → pre-mortem → implement the spike prototype →
demo → report). Author the design doc with **`/writing-design-documents`** and edit every prose
artifact with **`/writing-clearly-and-concisely`**. Read `CLAUDE.md`, `AGENTS.md`, and
`server/CLAUDE.md` **first**. Work only in this `serverless-spike` worktree; branch is
`jordangaston/serverless-spike`.

## The question

**Can the Harvest backend run on serverless functions (e.g. Vercel Functions / AWS Lambda) instead of a
long-lived Node process — and should it?** Give a clear **yes / no / yes-with-caveats** with evidence.

## Why this is non-trivial — start here

The backend is **Fastify + DBOS + Postgres** (see `server/`). The crux is **DBOS**:

- DBOS is a **durable-execution engine** — its import/recipe pipelines are class-syntax workflows with
  one `@DBOS.step` per network call, and it uses **Postgres-backed checkpoints** to recover a workflow
  that dies mid-run. Recovery traditionally assumes a **long-lived process** that resumes interrupted
  workflows on startup. A serverless function that freezes/dies between steps is exactly the case DBOS
  is meant to survive — so the real question is **how DBOS behaves when the host is ephemeral**.
- **Read the current DBOS version's own serverless guidance against the actual pinned version** in
  `server/package.json` — do not assume. DBOS has shipped serverless/queue-runner and "detach"
  execution models; confirm what *our* version supports before designing around it.
- Secondary concerns, each of which you must actually check, not hand-wave:
  - **Postgres connections** — serverless fan-out exhausts connection pools. Does our `pool` singleton
    survive? Is a pooler (PgBouncer / Neon / RDS Proxy / Supabase pooler) required? (Neon MCP is
    available in this session if useful for a scratch DB.)
  - **Cold starts** — Fastify boot + DBOS launch per invocation; measure it, don't guess.
  - **Long-running import jobs** — a recipe import spans several network calls (scrape → OCR/VLM →
    persist). Serverless request timeouts (~10–60s) vs. a job that may exceed them → does this force a
    **queue/background** execution model, and does DBOS provide it on our version?
  - **Fastify on serverless** — one function handler wrapping the app, or a per-route split? What's the
    idiomatic path for the target platform (read the platform's **versioned** docs before writing code).

## What to produce

1. **A design/recommendation doc** — `docs/sprint-serverless-spike/RECOMMENDATION.md`: the question, the
   options considered (stay long-lived / lift-and-shift the whole app into one function / split the
   HTTP API serverless + keep a worker for DBOS / fully serverless DBOS if the version supports it), the
   evidence for each, connection + cold-start + timeout findings, cost/ops trade-offs, and a **single
   recommended path** with its risks and a rough migration outline. Underwhelm the reader.
2. **A minimal working proof** — the smallest prototype that validates the recommended path end-to-end
   on a real function runtime: e.g. one representative route (a health check **and** one real
   read/route) plus **one DBOS pipeline invocation** running under the serverless model you recommend,
   with the connection strategy you recommend. Measured cold-start + a successful pipeline run is the
   bar. If the finding is "don't migrate," the proof is the concrete blocker demonstrated (e.g. DBOS
   recovery can't work on our version serverless), not just prose.
3. **`SPRINT-REPORT.md` + `POSTMORTEM.md`** in `docs/sprint-serverless-spike/`.

## Constraints (non-negotiable)

- **Spike, not migration** — do not change the production server's runtime model. New prototype code
  lives isolated (e.g. `server/spike/` or a clearly-marked entrypoint) so nothing regresses.
- **The existing test suite stays green** and **offline** (no network in tests; stub providers).
- **Migrations-only** for any schema (there shouldn't be any for a spike).
- Follow `server/CLAUDE.md`: classes with `static create()`, DBOS workflow = status+exceptions only,
  model the domain, laziest rung that works.
- **Read the versioned platform + DBOS docs before writing code** (`AGENTS.md` rule). State the exact
  versions you targeted in the report.
- Decide-and-log blockers; don't stall. If you need the founder (a paid platform account, a real
  deploy), **escalate** with the specific ask rather than guessing.

## Done

Recommendation doc + the working proof (or demonstrated blocker) + green offline suite + the two
sprint docs. Report `worker_done` with: the recommendation (one-line verdict), the proof evidence
(cold-start numbers, a pipeline run), the DBOS + platform versions you targeted, and any founder ask.
