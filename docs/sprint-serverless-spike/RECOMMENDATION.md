# Serverless migration spike — recommendation

**Verdict: No. Keep the backend as one long-lived process.** A pure serverless-function
deployment cannot run Harvest's durable core, and the one serverless split that *would* work
buys nothing today while adding cost and moving parts. Ship the existing single process to a
container host.

This is a spike, not a migration. Nothing in the production runtime changed. The proof code
lives in `server/spike/` and the existing suite stays green and offline.

## The question

Can the Fastify + DBOS + Postgres backend run on serverless functions (Vercel Functions / AWS
Lambda) instead of a long-lived Node process — and should it?

## Answer in one paragraph

DBOS is a durable-execution engine: a recipe import is a checkpointed workflow that runs
**detached from the HTTP request** and spans several network calls (scrape → OCR/ASR/VLM →
persist). Making progress on that work, and recovering it after a crash, both require a
**process that stays alive between requests**. A serverless function is the opposite: its
compute exists only while a request is in flight and is frozen the instant it responds. So the
import work a function starts is abandoned when the function returns, and nothing exists to
resume it. We proved this on the real runtime (DBOS 4.25.14 + Postgres): a function that freezes
at response leaves the workflow `PENDING` forever, and only a long-lived worker recovers it. The
secondary costs (per-invocation DBOS launch, connection fan-out, a pooler that DBOS's own
`LISTEN/NOTIFY` can't tolerate) all point the same way.

## Evidence

Versions targeted: **DBOS SDK 4.25.14**, `@dbos-inc/drizzle-datasource` 4.25.14, Fastify 5.6.1,
pg 8.16.3, Postgres 17. Platforms assessed: **Vercel Functions** (Node runtime, Fluid Compute;
default `maxDuration` 300 s, up to 800 s, 1800 s in beta) and **AWS Lambda** (900 s hard cap).
DBOS's own "serverless" target is **Google Cloud Run — a container**, not a function.

### 1. DBOS durable execution needs an always-on executor (the blocker)

From the DBOS docs (primary sources, verified against 4.25.14):

- Workflows execute **in-process**. "All processes running DBOS periodically poll queues to find
  and execute new work." An enqueued or started workflow runs inside a live executor, not on a
  request.
- Recovery is **launch-triggered**: "in single-node deployments this happens automatically at
  startup when DBOS scans for incomplete (`PENDING`) workflows." Distributed recovery needs
  coordination "through services like DBOS Conductor."
- Recovery is **scoped to `(executorID, applicationVersion)`**. The admin server refuses to adopt
  another version's work: an executor on a new app version "will complete existing workflows but
  will not create new workflows."

A function platform provides none of this: no process persists to poll or to scan on launch, and
each cold instance gets a fresh identity, so a later invocation would not even be a matching
executor for a dead one's stranded workflow.

**Demonstrated** (`server/spike`, real DBOS + Postgres, offline stubs):

| Step | Result |
|------|--------|
| Intake returns `202`, then the function **freezes** (`process.exit`, no shutdown) | job `queued`, workflow **`PENDING`** |
| Observe with no worker running | job stays `queued`, workflow stays **`PENDING`** — stranded |
| A **long-lived worker** boots (`DBOS.launch` → recovery scan) | log: *"Recovering 1 workflows"*; job → **`ready`**, recipe **persisted** |

The durable guarantee is real — but it is delivered by the worker, which is exactly the
always-on process serverless removes.

### 2. Longer function timeouts don't rescue it

Vercel now runs functions up to 30 min, so a *single* import might fit inside one invocation. It
still doesn't help. To use it you would have to abandon the async job model and make intake
**block** for the whole import — holding a function (and its DB connections) open for minutes,
paying active-CPU the entire time, and **still losing durability**: a freeze or timeout mid-import
leaves a `PENDING` workflow with no process to recover it. A bigger timeout only lets you
brute-force one import at higher cost with no recovery. The request-scoped compute model is the
blocker, not the number of seconds.

### 3. Cold start

Every cold invocation pays DBOS's launch cost — connect to the system database, verify its
schema, scan for `PENDING` workflows — before serving anything:

```
dbos_launch_ms:               328     ← unavoidable per cold start
fastify_build_ms:              86
first_healthz_ms:              20
cold_start_to_first_200_ms:  1456     (includes tsx transpile; a bundled deploy trims module load, not launch)
```

~330 ms of mandatory Postgres-round-trip work on every cold instance, on top of module load.

### 4. Connections need a pooler — that DBOS partly can't use

One instance opens **8 Postgres connections** (3 app pool + 5 DBOS system). Serverless fan-out
multiplies that by concurrency:

```
connection_footprint: { harvest: 3, harvest_dbos: 5 }   →  8 × N instances
```

Postgres defaults to ~100 connections, so ~12 concurrent instances exhaust it; a real function
tier scales to hundreds. A **transaction-mode pooler** (PgBouncer / Neon / RDS Proxy) is
mandatory for the app DB. But DBOS drives its **system DB with `LISTEN/NOTIFY`** (confirmed in the
SDK) for workflow events and queue wake-ups — session-level features that transaction-mode
poolers drop. So the DBOS executor needs a **direct / session-mode** connection regardless. The
piece that most needs to be always-on is also the piece that pools worst.

## Options considered

| Option | Viable on 4.25? | Why |
|--------|:---:|-----|
| **A. Stay long-lived** (one Fastify+DBOS process on a container host) | ✅ | The model DBOS is built for. One deployable, no pooler tax, recovery on restart. **Recommended.** |
| B. Lift-and-shift the whole app into one function | ❌ | Durable work abandoned at response; recovery can't run; timeouts. Proven above. |
| C. Split: serverless HTTP (reads + intake-enqueue) + long-lived DBOS worker | ⚠️ | Works, but you still run and pay for the worker — plus a pooler, cold starts, two deployables, and split-brain. No benefit until the read tier needs independent scaling. |
| D. Fully serverless DBOS | ❌ (raw FaaS) | Needs DBOS Cloud / Conductor (managed, paid) or Cloud Run **containers** — not Vercel/Lambda functions. |

## Recommended path: stay long-lived (A)

Deploy the existing single process to a container platform — Fly, Render, Railway, a small VM, or
Cloud Run with `min-instances=1`. It already meets pre-launch load, keeps one deployable, needs no
pooler, and gets DBOS crash recovery for free on restart. Cost at idle is a few dollars a month
for a small always-on instance — cheaper in practice than the pooler + worker + function bill of a
split.

**Revisit Option C only when** the read API demonstrably needs to autoscale independently of the
importer. If we ever want managed durable execution instead of babysitting a box, **DBOS Cloud /
Conductor** is the DBOS-blessed path — not raw functions.

### Risks of A, and mitigations

- **Single-process availability.** A container platform auto-restarts, and DBOS recovers
  in-flight imports on restart. For HA, run 2+ replicas against one system DB — DBOS coordinates
  ownership.
- **Not "serverless-cheap" at true zero.** Mitigation: a small `min-instances=1` instance. The
  workload isn't spiky enough for scale-to-zero to matter pre-launch.

### If Option C is ever taken — rough outline

1. Change intake from `DBOS.startWorkflow(...).run()` to **enqueue** onto a `WorkflowQueue`.
2. Deploy HTTP handlers as functions (one Fastify handler via `@fastify/aws-lambda` or a Vercel
   Node handler) for reads and intake-enqueue.
3. Run a **long-lived worker** (container) that registers the queue and drains it, with a
   **session-mode** connection to the DBOS system DB.
4. Put the **app DB behind a transaction-mode pooler** for the functions.
5. Pin **`DBOS__APPVERSION` per deploy** so recovery scoping is stable.

## Reproduce the proof

```bash
cd server && bash spike/run-proof.sh      # offline; needs the local Postgres the test suite uses
```

See `server/spike/README.md`. The proof is deliberately small: cold-start numbers, one freeze,
one recovery. It changes no production code.
