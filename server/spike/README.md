# `spike/` — serverless viability proof (throwaway)

**Not production.** Isolated prototype for the Wave-3 serverless spike. Changes no `src/` code.
Delete it when the spike closes. See `docs/sprint-serverless-spike/RECOMMENDATION.md`.

## What it shows

A FaaS (Vercel/Lambda) function's compute stops when it responds. This emulates that lifecycle
against **real DBOS 4.25.14 + real Postgres**, offline, to answer: does a DBOS durable workflow
survive a function that freezes at response?

Each step runs as its **own OS process** (see `run-proof.sh`), so the cold starts and the freeze
are real, not simulated in one process.

## Run

```bash
cd server && bash spike/run-proof.sh
```

Needs the same local Postgres the test suite uses (`postgresql://postgres:postgres@localhost:5432`).
Runs with `NODE_ENV=test` and **no provider API keys**, so the suite's offline stubs are selected —
no network.

## Steps (`faas-emulation.ts`)

| Subcommand | Emulates | Shows |
|-----------|----------|-------|
| `reset` | clean deploy | migrated app schema + empty DBOS ledger |
| `coldstart` | a cold function invocation | `DBOS.launch` cost, first-200 latency, connection footprint |
| `freeze <file>` | intake returns `202`, platform freezes the instance | workflow started, then `process.exit` — no shutdown |
| `observe <file>` | a monitoring query (no DBOS runtime) | job `queued`, workflow **`PENDING`** — stranded |
| `recover <file>` | a long-lived worker boots | DBOS recovers the `PENDING` workflow → job **`ready`** |

## Result

```
COLDSTART  dbos_launch_ms 328 · cold_start_to_first_200_ms 1456 · connections {app:3, dbos:5}
FREEZE     202 → job queued, workflow started
OBSERVE    job queued, workflow PENDING          ← FaaS strands durable work
RECOVER    "Recovering 1 workflows" → job ready, recipe "Creamy Garlic Chicken" persisted
```

The durable guarantee holds — but only the long-lived worker delivers it. That worker is the
process serverless removes, which is why the recommendation is to keep one long-lived process.

## Note on the offline source

The proof imports a **website** URL. Its stub (`StubWebsiteFetcher`) is chosen as a module-const at
import, so it survives DBOS's recovery replay deterministically. The TikTok stub is selected at
step runtime and isn't reconstructed the same way under recovery replay — a test-stub timing
quirk, not a product defect (an in-process run of the same TikTok import yields a recipe). Using
the website source keeps the proof about DBOS recovery, not stub plumbing.
