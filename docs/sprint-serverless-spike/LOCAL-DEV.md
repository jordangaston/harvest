# Local dev & test runbook — Cloudflare-serverless Harvest

How to run and test the backend on your laptop, with **no Cloudflare account and no Turso account**.
`wrangler dev` emulates Workers and Cloudflare Workflows locally; the database is **Turso (libSQL)**,
which runs locally two ways — a plain `file:` SQLite for tests, and a local `turso dev` server for the
Worker. Follow this top to bottom. It describes the `server/spike-cf/` prototype; the migrated server
follows the same pattern.

Prerequisites: Node 24, npm, and the Turso CLI (one-time, like wrangler — no account needed for the
local server):

```bash
curl -sSfL https://get.tur.so/install.sh | bash    # installs `turso` + local `sqld`
cd server/spike-cf && npm install
```

## Local database: `file:` vs Turso cloud

libSQL is SQLite over a client. Where the client points is the only thing that changes between local
and prod:

| Context | `TURSO_DATABASE_URL` | Client build |
|---------|----------------------|--------------|
| **Node tests** | `file:…` (a local SQLite file) | `@libsql/client` (node) — opens files |
| **Worker under `wrangler dev`** | `http://127.0.0.1:8080` (a local `turso dev` server) | `@libsql/client/web` — HTTP only |
| **Production** | `libsql://<db>.turso.io` + `TURSO_AUTH_TOKEN` | `@libsql/client/web` — HTTP |

The Worker always uses the **web** build (`src/edge-db.ts`), which cannot open a `file:` db — so even
local Worker runs need a server. `turso dev` is that server, backed by a local file, offline.

## 1. Run locally

### Apply the schema (once per schema change)

```bash
npm run db:generate     # drizzle-kit → SQLite DDL under drizzle/*.sql
TURSO_DATABASE_URL=file:local.db npm run db:apply-local   # node scripts/apply-schema.mjs
```

`apply-schema.mjs` runs the generated DDL through `@libsql/client` and works against a `file:`, a
`turso dev` URL, or a cloud URL — the same script everywhere. (`npm run proof` applies the schema to
its `turso dev` server for you.)

### Boot the local libSQL server + the Worker

```bash
turso dev --db-file .turso/local.db --port 8080 &        # local libSQL at http://127.0.0.1:8080
echo 'TURSO_DATABASE_URL=http://127.0.0.1:8080' > .dev.vars
npm run dev                                               # wrangler dev
```

Wrangler prints the Workflow binding (the DB is *not* a binding — it comes from `.dev.vars`):

```
env.IMPORT_WORKFLOW (ImportWorkflow)   Workflow   local
Ready on http://127.0.0.1:8787
```

`wrangler.jsonc` carries only the Worker + Workflow; there is no `d1_databases` block:

```jsonc
{
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-14",
  "compatibility_flags": ["nodejs_compat"],
  "workflows": [{ "name": "harvest-import", "binding": "IMPORT_WORKFLOW", "class_name": "ImportWorkflow" }]
  // DB: Turso/libSQL via env (TURSO_DATABASE_URL [+ TURSO_AUTH_TOKEN]), not a binding.
}
```

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
mirroring the existing suite's `NODE_ENV=test` offline path. The only env it needs is the DB URL.

Local DB env and (later) real provider keys go in **`.dev.vars`** (git-ignored; `wrangler dev` loads
it into `env`); deployed secrets — `TURSO_AUTH_TOKEN`, provider keys — use `wrangler secret put`. Keep
the absent-key ⇒ stub-provider seam so local and CI stay hermetic by default.

## 2. Test — two tiers

### Tier 1 — fast, offline, no server (`npm test`)

Vitest against **`@libsql/client` with a `file:` database** — the same client build that talks to
Turso cloud, so the queries are real. Covers the pure logic (mapping, source classification, stub
providers) and the **libSQL data layer** (`test/db.integration.test.ts`): it drives the restored
interactive `db.transaction()` persist and asserts the recipe, its children, the job link, and the
terminal status all commit atomically. Per `server/CLAUDE.md`: unit-test repos/services,
integration-test routes, as few as cover all paths, never hit the network.

Note: use a `file:` db, not `:memory:` — libSQL's in-memory database is **connection-private**, so the
transaction's connection would see an empty schema. The test writes to a temp file and deletes it.

### Tier 2 — end-to-end proof (`npm run proof`)

`scripts/proof.sh` is the harness pattern: **start `turso dev` + apply schema → boot `wrangler dev` →
drive over HTTP → assert → tear down.** It runs offline (both servers are local) and exits non-zero on
any failed assertion.

**Testing Workflow durability/recovery locally.** You cannot force-evict an isolate on a laptop, so
reproduce the *recovery mechanism* instead of the eviction: throw once inside a step (the import route
accepts `"faultStep":"extract"`). Cloudflare Workflows retries only that step; the engine re-enters
`run()` and returns the completed steps' checkpointed results **without re-executing them** — the
identical replay path an eviction triggers. Assert resume-not-restart:

```
faulted import → status ready, fault_attempts 2
step counts:   fetch-source=1  extract=2  persist-and-ready=1
recipes linked to the faulted job: 1     # one recipe, so no restart and no duplicate
```

`fetch-source` and `persist-and-ready` running once while `extract` runs twice is the memoization
proof; the single linked recipe is the no-restart proof.

## 3. CI

Both tiers are offline, deterministic, and account-free. The only extra step over a normal Node build
is installing the Turso CLI for the Tier-2 local server:

```yaml
- run: curl -sSfL https://get.tur.so/install.sh | bash   # local libSQL server for the proof
- run: cd server/spike-cf && npm ci
- run: cd server/spike-cf && npm test        # Tier 1 — fast, file: libSQL, no server
- run: cd server/spike-cf && npm run proof    # Tier 2 — turso dev + wrangler dev, asserts
```

No secrets, no cloud, Node 24. `proof.sh` is self-asserting, so a broken durability guarantee fails
the build.

## 4. Gotchas (each cost a cycle)

- **libSQL `:memory:` is connection-private.** A `db.transaction()` opens its own connection and sees
  an empty in-memory schema → `no such table`. Use a `file:` db for anything with a transaction.
- **`@libsql/client/web` can't open `file:`.** The Worker build is HTTP-only, so local Worker runs need
  a `turso dev` server; only the node client (tests) opens files directly.
- **libSQL DOES support interactive transactions** — unlike D1. `RecipeRepository.persist` keeps its
  `db.transaction()`; there is no `db.batch()` workaround. (Ids are still app-generated with
  `crypto.randomUUID()` — SQLite has no `gen_random_uuid`.)
- **Teardown.** `proof.sh` traps `EXIT` to kill both the `turso dev` and `wrangler dev` PIDs. If a run
  is interrupted and a port stays busy, `pkill -f "turso dev"` and `pkill -f "wrangler dev"`.
- **Isolate the prototype's toolchain.** It carries its own `package.json`, `vitest.config.ts`, and
  `tsconfig.json`. Without the local vitest config, vitest walks up and runs `server/`'s Postgres
  global-setup.
- **Peer dep.** `wrangler@4.123` requires `@cloudflare/workers-types@5`.
- **Parse noise.** The `expo/tsconfig.base` warning from the repo-root `tsconfig.json` is harmless.
  When scripting with `jq`, echo the JSON alone — piping `"FINAL: {…}"` into `jq` fails on the prefix.

## Commands, in short

```bash
# run:  install turso CLI → npm install → generate+apply schema (file:) → turso dev + wrangler dev
npm run db:generate && TURSO_DATABASE_URL=file:local.db npm run db:apply-local
turso dev --db-file .turso/local.db --port 8080 &
echo 'TURSO_DATABASE_URL=http://127.0.0.1:8080' > .dev.vars && npm run dev
# test: fast offline tier, then the end-to-end durability proof
npm test          # vitest + @libsql/client (file:), no server
npm run proof     # turso dev + wrangler dev, asserts resume-not-restart
```
