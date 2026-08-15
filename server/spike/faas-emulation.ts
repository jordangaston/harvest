/**
 * SPIKE — NOT PRODUCTION. Emulates a FaaS (Vercel/Lambda) request lifecycle to
 * measure serverless viability of the Fastify + DBOS backend, and to demonstrate
 * whether a DBOS durable workflow survives a function that freezes at response.
 *
 * Runs OFFLINE: invoked with NODE_ENV=test and no provider API keys, so the same
 * stubs the test suite uses are selected — no network. Real Postgres, real DBOS
 * 4.25.14 recovery. Each subcommand runs as its own OS process (see run-proof.sh),
 * so process boundaries are real cold starts and a real freeze, not fakes.
 *
 * Subcommands: reset | coldstart | freeze <file> | observe <file> | recover <file>
 */
import { Client } from 'pg';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const DB_URL = process.env.DATABASE_URL!;
const SYS_URL = process.env.DBOS_SYSTEM_DATABASE_URL!;

/** ms since this OS process started — the true cold-start-to-ready cost a FaaS
 * cold invocation pays (module load + DBOS launch + first query included). */
const uptimeMs = () => Math.round(process.uptime() * 1000);

/** Count Postgres backends this app holds open, per database — the per-instance
 * connection footprint a serverless pooler has to multiply by concurrency. */
async function connectionFootprint(): Promise<Record<string, number>> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const r = await c.query<{ datname: string; n: string }>(
      `select datname, count(*)::text as n from pg_stat_activity
       where datname in ($1,$2) group by datname order by datname`,
      [dbName(DB_URL), dbName(SYS_URL)],
    );
    return Object.fromEntries(r.rows.map((row) => [row.datname, Number(row.n)]));
  } finally {
    await c.end();
  }
}

const dbName = (url: string) => new URL(url).pathname.slice(1);

/** reset — ensure the local DBs exist, migrate the app schema, and drop the DBOS
 * ledger so the run starts from a clean workflow history. */
async function reset(): Promise<void> {
  const { ensureDatabases, LOCAL_ADMIN_URL } = await import('../scripts/create-databases.js');
  const { runMigrations } = await import('../src/db/migrate.js');
  await ensureDatabases(LOCAL_ADMIN_URL);
  await runMigrations(DB_URL);
  const sys = new Client({ connectionString: SYS_URL });
  await sys.connect();
  try {
    await sys.query('DROP SCHEMA IF EXISTS dbos CASCADE');
  } finally {
    await sys.end();
  }
  // Clear app rows a prior run left, so cold-start reads a known-empty app DB.
  const app = new Client({ connectionString: DB_URL });
  await app.connect();
  try {
    await app.query('TRUNCATE import_jobs, import_job_recipes, ingredients, recipe_steps, recipes, users CASCADE');
  } finally {
    await app.end();
  }
  console.log('reset: app migrated, DBOS ledger cleared, app rows truncated');
}

/** coldstart — measure a cold boot end to end: DBOS.launch (connects the system
 * DB, creates its schema, scans for pending workflows), Fastify build, and the
 * first real read routes. Reports the connection footprint too. */
async function coldstart(): Promise<void> {
  const { initDbos, shutdownDbos } = await import('../src/pipeline/bootstrap.js');
  const { buildApp } = await import('../src/api/app.js');

  const tLaunch = performance.now();
  await initDbos();
  const launchMs = Math.round(performance.now() - tLaunch);

  const tBuild = performance.now();
  const app = buildApp();
  const buildMs = Math.round(performance.now() - tBuild);

  const tHealth = performance.now();
  const health = await app.inject({ method: 'GET', url: '/healthz' });
  const healthMs = Math.round(performance.now() - tHealth);
  const readyAt = uptimeMs(); // full cold-start-to-first-200

  // One real authenticated read route: create a user (write+read) then read /me.
  const created = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: '+15555550100' } } });
  const token = created.json().auth.access_token.jwt;
  const tMe = performance.now();
  const me = await app.inject({ method: 'GET', url: '/v1/users/me', headers: { authorization: `Bearer ${token}` } });
  const readMs = Math.round(performance.now() - tMe);

  const conns = await connectionFootprint();

  console.log(JSON.stringify({
    marker: 'COLDSTART',
    dbos_launch_ms: launchMs,
    fastify_build_ms: buildMs,
    first_healthz_ms: healthMs,
    healthz_status: health.statusCode,
    authed_read_me_ms: readMs,
    me_status: me.statusCode,
    cold_start_to_first_200_ms: readyAt,
    connection_footprint: conns,
  }, null, 2));

  await app.close();
  await shutdownDbos();
}

/** freeze — the FaaS intake request: launch, accept POST /v1/imports (which
 * durably starts the import workflow), return 202, then FREEZE the instance the
 * instant the response is sent — process.exit with no shutdown, no await of the
 * detached pipeline. This is exactly what a function platform does at response. */
async function freeze(file: string): Promise<void> {
  const { initDbos } = await import('../src/pipeline/bootstrap.js');
  const { buildApp } = await import('../src/api/app.js');
  await initDbos();
  const app = buildApp();

  const created = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: '+15555550101' } } });
  const token = created.json().auth.access_token.jwt;

  // A website source: its offline stub (StubWebsiteFetcher, 'Creamy Garlic Chicken')
  // is a module-const picked once at import, so it survives DBOS recovery replay
  // deterministically — the recovered worker runs the real pipeline to a persisted
  // recipe with no network.
  const res = await app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: { authorization: `Bearer ${token}` },
    payload: { source: { url: 'https://recipes.example.com/creamy-garlic-chicken' } },
  });
  const job = res.json().job;
  writeFileSync(file, JSON.stringify({ jobId: job.id, token }));

  console.log(JSON.stringify({ marker: 'FREEZE', http_status: res.statusCode, job_id: job.id, job_status: job.status }));
  // The function's compute stops here. The started workflow is PENDING in Postgres;
  // its steps have NOT run. No shutdown, no waitUntil — the platform froze us.
  process.exit(0);
}

/** observe — read the stranded state WITHOUT launching a DBOS runtime (a pure
 * observer, as a monitoring query would be). Shows the job never advanced and the
 * workflow sits PENDING: on FaaS, nothing exists to move it. */
async function observe(file: string): Promise<void> {
  const { jobId } = JSON.parse(readFileSync(file, 'utf8'));
  const app = new Client({ connectionString: DB_URL });
  const sys = new Client({ connectionString: SYS_URL });
  await app.connect();
  await sys.connect();
  try {
    const jobRow = await app.query<{ status: string }>('select status from import_jobs where id = $1', [jobId]);
    const wf = await sys.query<{ status: string; executor_id: string }>(
      'select status, executor_id from dbos.workflow_status where workflow_uuid = $1',
      [jobId],
    );
    console.log(JSON.stringify({
      marker: 'OBSERVE',
      job_status: jobRow.rows[0]?.status ?? '(missing)',
      workflow_status: wf.rows[0]?.status ?? '(missing)',
      workflow_executor: wf.rows[0]?.executor_id ?? '(missing)',
    }));
  } finally {
    await app.end();
    await sys.end();
  }
}

/** recover — a long-lived worker boots and DBOS auto-recovers pending workflows
 * for this executor on launch. Poll the job to a terminal status: the stranded
 * import now runs to completion and persists its recipe. This is the worker the
 * split architecture keeps; FaaS has none. */
async function recover(file: string): Promise<void> {
  const { jobId } = JSON.parse(readFileSync(file, 'utf8'));
  // A worker must register the workflow + its steps before launch, exactly as the
  // real server does (buildApp imports this chain). Without it DBOS recovers the
  // checkpoint in a degraded form and the pipeline mis-runs.
  await import('../src/pipeline/import-workflow.js');
  const { initDbos, shutdownDbos } = await import('../src/pipeline/bootstrap.js');

  const tRec = performance.now();
  await initDbos(); // launch → scans PENDING for executor 'local' → re-executes them
  const app = new Client({ connectionString: DB_URL });
  await app.connect();
  let status = 'unknown';
  let recipeTitle: string | null = null;
  try {
    for (let i = 0; i < 400; i++) {
      const r = await app.query<{ status: string; recipe_id: string | null }>(
        'select status, recipe_id from import_jobs where id = $1',
        [jobId],
      );
      status = r.rows[0]?.status ?? 'missing';
      if (status === 'ready' || status === 'failed') {
        if (r.rows[0]?.recipe_id) {
          const rec = await app.query<{ title: string }>('select title from recipes where id = $1', [r.rows[0].recipe_id]);
          recipeTitle = rec.rows[0]?.title ?? null;
        }
        break;
      }
      await new Promise((res) => setTimeout(res, 25));
    }
  } finally {
    await app.end();
  }
  console.log(JSON.stringify({
    marker: 'RECOVER',
    recovered_in_ms: Math.round(performance.now() - tRec),
    terminal_job_status: status,
    persisted_recipe_title: recipeTitle,
  }));
  await shutdownDbos();
}

const [cmd, file] = process.argv.slice(2);
const run = { reset, coldstart, freeze: () => freeze(file), observe: () => observe(file), recover: () => recover(file) }[cmd];
if (!run) {
  console.error(`usage: faas-emulation.ts reset|coldstart|freeze <file>|observe <file>|recover <file>`);
  process.exit(2);
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
