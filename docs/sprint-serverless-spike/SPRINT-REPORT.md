# Sprint report — serverless migration spike (Wave 3)

**Outcome:** Verdict delivered with a working proof. **Do not migrate to serverless functions;
keep one long-lived process.** Full reasoning + evidence: `RECOMMENDATION.md`.

## What shipped

- `RECOMMENDATION.md` — the question, four options, evidence (docs + measured proof), a single
  recommended path with risks and a migration outline.
- `server/spike/` — an isolated, offline proof on real DBOS 4.25.14 + Postgres: cold-start
  numbers, a function-freeze that strands a durable workflow, and a worker that recovers it.
- No production code changed. Existing suite: **86/86 green, offline**.

## Phases

**0–1 · Reference & framing.** Read `CLAUDE.md`, `AGENTS.md`, `server/CLAUDE.md`, and the backend.
Established the crux early: intake is a fast async enqueue (`DBOS.startWorkflow().run()` → `202` +
polling), but the import pipeline runs **detached from the request** across several network calls.
That decoupling is what serverless breaks.

**2 · Clarify.** No founder questions needed — the brief scoped it. One decision logged: prove the
blocker on a faithful **local** FaaS-lifecycle emulation (real DBOS + Postgres, offline) rather
than block on a paid hosted deploy. The blocker is architectural and platform-independent, so a
local emulation is sufficient evidence; a hosted deploy is offered as an optional follow-up.

**3 · Design.** Chose to answer with primary DBOS docs *plus* a runnable proof, not prose alone.
Verified the DBOS 4.25.14 API surface (`startWorkflow`, `getWorkflowStatus`,
`recoverPendingWorkflows`, admin `/dbos-workflow-recovery`) against the installed package, not
memory.

**4 · Pre-mortem.** Anticipated risks and how each was handled:
- *"The proof secretly hits the network."* → run with `NODE_ENV=test` and no API keys; the suite's
  offline stubs are selected. Verified the recovered import persists with zero network.
- *"The freeze races the workflow to completion."* → inspected the DBOS ledger after freeze: zero
  steps checkpointed, workflow purely `PENDING`. Deterministic across runs.
- *"Recovery is faked."* → recovery is real `DBOS.launch` auto-recovery in a separate process;
  DBOS logs *"Recovering 1 workflows"* and the job reaches `ready`.

**5 · Implement.** Built `spike/faas-emulation.ts` (reset/coldstart/freeze/observe/recover) +
`run-proof.sh`. Measured cold start, connection footprint, and the freeze→recover cycle.

**6 · Demo.** `bash spike/run-proof.sh` — reproduced end to end (see `RECOMMENDATION.md` table).

## Evidence captured

- **Blocker:** freeze at response → workflow `PENDING` and never advances; a long-lived worker
  recovers it → `ready`, recipe persisted.
- **Cold start:** `DBOS.launch` ≈ 328 ms per cold instance; first-200 ≈ 1.46 s.
- **Connections:** 8 per instance (3 app + 5 DBOS system) → pooler required; DBOS's system-DB
  `LISTEN/NOTIFY` needs a session-mode connection a transaction pooler can't give.
- **Timeouts:** the pipeline is detached and multi-minute; Vercel's 30-min ceiling doesn't help
  because the compute is request-scoped and recovery still can't run.

## Versions targeted

DBOS SDK 4.25.14 · `@dbos-inc/drizzle-datasource` 4.25.14 · Fastify 5.6.1 · pg 8.16.3 · Postgres
17. Platforms assessed: Vercel Functions, AWS Lambda. DBOS-blessed "serverless" = Google Cloud Run
(container).

## Founder ask (optional)

A hosted Vercel/Lambda deploy would re-confirm the same DBOS behavior at the cost of a paid account
and risk of leaking the real provider keys in `server/.env`. Not needed for the verdict; available
on request.

## Follow-ups

- Delete `server/spike/` when the spike closes (it's throwaway).
- If Option C (serverless read tier + worker) is ever pursued, follow the migration outline in
  `RECOMMENDATION.md`.
