# Local dev & test runbook — Cloudflare-serverless Harvest

How to run and test the Cloudflare-serverless backend on your laptop, with **no Cloudflare account
and no Postgres**. `wrangler dev` emulates Workers, Cloudflare Workflows, and D1 locally (miniflare).
Follow this top to bottom. It describes the `server/spike-cf/` prototype today; the migrated server
follows the same pattern.

Prerequisites: Node 24 and npm. Nothing else.

```bash
cd server/spike-cf
npm install
```

## 1. Run locally

Everything runs in one process you start and stop — there is no long-lived server.

### Apply the schema to local D1 (once per schema change)

```bash
npm run db:generate     # drizzle-kit → SQLite DDL under drizzle/*.sql
npm run db:apply-local  # wrangler d1 execute harvest_cf --local --file=<the generated .sql>
```

Local D1 is a SQLite file under `.wrangler/state/v3/d1`. To reset it, delete `.wrangler/state`.
Run ad-hoc SQL with `npx wrangler d1 execute harvest_cf --local --command "select * from import_jobs"`.

### Boot the dev server

```bash
npm run dev   # wrangler dev
```

Wrangler prints the bindings it wired — all `local`:

```
env.IMPORT_WORKFLOW (ImportWorkflow)   Workflow      local
env.DB (harvest_cf)                    D1 Database   local
Ready on http://127.0.0.1:8787
```

Those bindings come from `wrangler.jsonc`:

```jsonc
{
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-14",
  "compatibility_flags": ["nodejs_compat"],
  "workflows": [{ "name": "harvest-import", "binding": "IMPORT_WORKFLOW", "class_name": "ImportWorkflow" }],
  "d1_databases": [{ "binding": "DB", "database_name": "harvest_cf", "database_id": "local-spike-placeholder" }]
}
```

`database_id` is a placeholder — `--local` ignores it and uses the SQLite file. A real deploy needs a
provisioned id.

### Drive it

```bash
B=http://127.0.0.1:8787; H='-H content-type:application/json'
curl -s $B/healthz
USER=$(curl -s $H -XPOST $B/v1/users   -d '{"phone":"+15555550100"}' | jq -r .user.id)
JOB=$(curl  -s $H -XPOST $B/v1/imports -d "{\"userId\":\"$USER\",\"source\":{\"url\":\"https://recipes.example.com/creamy-garlic-chicken\"}}" | jq -r .job.id)
curl -s $B/v1/imports/$JOB | jq .job     # poll until status == ready
```

### Read Workflow step logs

Two ways to see which durable steps ran:

1. **Dev stdout.** Each step logs `[step] <name> job=<id>`; grep the `wrangler dev` output. This is
   what `proof.sh` uses — simplest and reliable.
2. **Local observability API.** `wrangler dev` exposes a read-only SQL endpoint over captured logs and
   traces:
   ```bash
   curl -s -X POST http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/observability/query \
     -H 'content-type: application/json' \
     -d '{"sql":"SELECT name, outcome, duration_ms FROM spans WHERE parent_id IS NULL LIMIT 20"}'
   ```

### Env & secrets

The prototype uses **offline stub providers** (`src/providers.ts`) — no scrape, no LLM, no keys —
mirroring the existing suite's `NODE_ENV=test` offline path. The proof needs no secrets.

For the migrated server's real providers, local secrets go in **`.dev.vars`** (git-ignored;
`wrangler dev` loads it into `env`); deployed secrets use `wrangler secret put`. Keep the
absent-key ⇒ stub-provider seam so local and CI stay hermetic by default.

## 2. Test — two tiers

### Tier 1 — fast, offline, no wrangler (`npm test`)

Vitest against **better-sqlite3**. Covers the pure logic (mapping, source classification, the stub
providers) and the **Drizzle `sqlite-core` layer** — the same schema and queries the Worker runs,
exercised in plain Node as the offline D1 stand-in (`test/db.integration.test.ts`). Per
`server/CLAUDE.md`: unit-test repos/services, integration-test routes, as few as cover all paths,
never hit the network.

One caveat: the D1 persist uses **`db.batch()`**, which better-sqlite3 does not implement, so the
batch write is not covered here — the end-to-end proof covers it against real local D1.

### Tier 2 — end-to-end proof (`npm run proof`)

`scripts/proof.sh` is the harness pattern: **reset local D1 → apply schema → boot `wrangler dev` →
drive over HTTP → assert → tear down.** It runs offline and exits non-zero on any failed assertion.

**Testing Workflow durability/recovery locally.** You cannot force-evict an isolate on a laptop, so
reproduce the *recovery mechanism* instead of the eviction: throw once inside a step (the import
route accepts `"faultStep":"extract"`). Cloudflare Workflows retries only that step; the engine
re-enters `run()` and returns the completed steps' checkpointed results **without re-executing them**
— the identical replay path an eviction triggers. Assert resume-not-restart:

```
faulted import → status ready, fault_attempts 2
step counts:   fetch-source=1  extract=2  persist-and-ready=1
recipes linked to the faulted job: 1     # one recipe, so no restart and no duplicate
```

`fetch-source` and `persist-and-ready` running once while `extract` runs twice is the memoization
proof; the single linked recipe is the no-restart proof.

## 3. CI

Both tiers are offline, deterministic, and account-free — they map straight to CI:

```yaml
- run: cd server/spike-cf && npm ci
- run: cd server/spike-cf && npm test        # Tier 1 — fast
- run: cd server/spike-cf && npm run proof    # Tier 2 — boots wrangler dev locally, asserts
```

No secrets, no services, Node 24. `proof.sh` is self-asserting, so a broken durability guarantee
fails the build.

## 4. Gotchas (each cost a cycle)

- **D1 has no interactive transaction.** Use `db.batch([...])` (one atomic SQL transaction). Generate
  UUIDs in app code (`crypto.randomUUID()`) so a batch can reference the new row id — SQLite has no
  `gen_random_uuid` and no `RETURNING`-into-a-transaction flow.
- **`wrangler dev` teardown.** `proof.sh` traps `EXIT` to kill the dev PID. If a run is interrupted and
  the port stays busy, free it with `pkill -f "wrangler dev"` (and `pkill -f workerd`).
- **Isolate the prototype's toolchain.** It carries its own `package.json`, `vitest.config.ts`, and
  `tsconfig.json`. Without the local vitest config, vitest walks up and runs `server/`'s Postgres
  global-setup.
- **Peer dep.** `wrangler@4.123` requires `@cloudflare/workers-types@5`.
- **Parse noise.** The `expo/tsconfig.base` warning from the repo-root `tsconfig.json` is harmless.
  When scripting with `jq`, echo the JSON alone — piping `"FINAL: {…}"` into `jq` fails on the prefix.

## Commands, in short

```bash
# run:  install → generate+apply schema → boot
npm install && npm run db:generate && npm run db:apply-local && npm run dev
# test: fast offline tier, then the end-to-end durability proof
npm test          # vitest + better-sqlite3, no wrangler
npm run proof     # wrangler dev + local D1, asserts resume-not-restart
```
