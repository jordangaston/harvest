# Sprint report — full serverless re-architecture on Cloudflare (Wave 3, v2)

**Outcome:** Verdict delivered with a working proof. **A full Cloudflare-serverless backend is
viable and recommended — replace DBOS with Cloudflare Workflows, Fastify with a Hono Worker, and
Postgres with D1.** No long-lived process remains. Full reasoning: `RECOMMENDATION.md`.

This v2 supersedes the v1 spike, which answered the wrong question ("can DBOS run serverless" → no)
and concluded "keep a long-lived container." That conclusion is void.

## What shipped

- `RECOMMENDATION.md` — target architecture, the DBOS-step → Workflow-step map, the Postgres → D1
  migration map (type-by-type + the `transaction` → `batch` change), the Node-only-API risk table,
  a migration outline, and residual risks.
- `server/spike-cf/` — a Worker (Hono) driving a Cloudflare **Workflow** that imports a recipe into
  **D1**, offline, with no long-lived process. Proves import → `ready` through durable steps **and**
  durable recovery. `npm run proof` runs it end to end in `wrangler dev` and asserts every claim.
- No production code changed. Existing server suite: **91/91 green, offline**. Spike unit tests:
  **5/5 green, offline**.

## Phases

**0–1 · Reference & framing.** Read `BRIEF-v2-cloudflare.md`, `CLAUDE.md`, `AGENTS.md`,
`server/CLAUDE.md`, and the pipeline. Fixed the crux early: the durability DBOS gave us (a failed
step resumes, not restarts) must survive with nothing kept alive. That is what the proof had to show.

**2 · Clarify (coordinator gate).** Mid-sprint the founder decided the database question: **D1, not
Hyperdrive/Postgres.** Folded in — the proof reads/writes D1 and runs on local SQLite, no Postgres.

**3 · Design (coordinator gate).** Confirmed every Cloudflare API against `developers.cloudflare.com`
before coding: Workflows Workers-API (`WorkflowEntrypoint`, `step.do`, retries), D1 bindings and
`batch` semantics, Drizzle-D1. Chose the least-change ports (Hono ≈ Fastify, `sqlite-core` keeps
Drizzle) and located the one genuine blocker (ffmpeg) up front.

**4 · Pre-mortem.** Anticipated:
- *"The proof secretly hits the network."* → offline stubs stand in for scrape/extract; the Worker
  makes no external request. Verified.
- *"Recovery is faked / the workflow restarts."* → assert exactly one recipe for the faulted job and
  step-execution counts (`extract` twice, neighbours once), so a restart or duplicate would fail the
  proof.
- *"D1 can't do the persist transaction."* → confirmed from docs it has no interactive transaction;
  designed persist as one atomic `batch` with an app-generated UUID.

**5 · Implement.** Built `spike-cf/`: `schema.ts` (`sqlite-core`), `db.ts` (D1 + `batch`),
`import-workflow.ts` (the DBOS port), `worker.ts` (Hono), offline `providers.ts`, and `proof.sh`.

**6 · Demo.** `npm run proof` — clean import → `ready`; faulted import → resumes → `ready`;
memoization counts and D1 integrity assert green. Reproduced from clean.

## Evidence captured

- **Durable steps:** clean import reaches `ready`, recipe persisted to D1.
- **Recovery:** `extract` throws once → the Workflow re-enters, replays `mark-running` and
  `fetch-source` from checkpoint **without re-running them**, retries only `extract`, persists once →
  `ready`. Step counts: `fetch-source` 1, `extract` 2, `persist-and-ready` 1. One recipe linked.
- **No long-lived process:** everything runs in `wrangler dev`; the isolate serves a request and stops.
- **Node-only blocker:** ffmpeg (video decode) has no Workers equivalent → Workers AI for OCR/ASR + an
  instance-scoped ffmpeg container for frame/audio extraction. Bounded, not architectural.

## Versions targeted

Wrangler **4.123.0** · compatibility-date **2026-08-14** · `nodejs_compat` · drizzle-orm **0.44.7** ·
drizzle-kit **0.31.10** · Hono **4.13.2** · Zod **4.4.3** · Node **24** · better-sqlite3 **11.10.0**
(unit tests). D1 local via miniflare.

## Founder ask (optional)

None required for the verdict. A real remote deploy (paid Cloudflare account) would re-confirm the
same behaviour on production Workflows/D1 and let us benchmark the ffmpeg-container media path;
available on request.

## Follow-ups

- Delete `server/spike-cf/` and the obsolete `server/spike/` when the spike closes (both throwaway).
- To execute the migration, follow the outline in `RECOMMENDATION.md`; the ffmpeg-container media path
  is the one piece needing a design spike of its own.
