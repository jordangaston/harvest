import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import { importJobs, users, recipes } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/api/app.js';
import { startDbos, stopDbos } from '../helpers/dbos-harness.js';
import { setParseProvider, resetParseProvider } from '../../src/pipeline/parse-step.js';

const TIKTOK_URL = 'https://www.tiktok.com/@caitlynskitchen/video/7663645567339334943';
const CODE = '123456';

const CRASH_WORKER = fileURLToPath(new URL('../helpers/crash-worker.ts', import.meta.url));

/** Runs crash-worker.ts (which starts a workflow whose parse step hangs) until it
 * prints RUNNING, then SIGKILLs it — a true mid-step crash that leaves the
 * workflow un-terminal with no recorded step result. */
async function crashWorkerAfterRunning(jobId: string, userId: string): Promise<void> {
  const child = spawn('node', ['--import', 'tsx', CRASH_WORKER, jobId, userId, TIKTOK_URL], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (d: Buffer) => d.toString().includes('RUNNING') && resolve());
    child.on('exit', (code) => reject(new Error(`crash worker exited early (${code})`)));
  });
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
}

let app: FastifyInstance;
let phoneSeq = 0;

/** Mints a Bearer access token for a fresh user via the WI-02 flow + stub OTP. */
async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555555${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/users',
    payload: { user: { phone_number: phone, code: CODE } },
  });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

/** Inserts a recipe so a `ready` outcome can reference a real recipe id
 * (import_jobs.recipe_id FKs to recipes.id). */
async function seedRecipe(): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({ title: 'Test Recipe', sourceType: 'tiktok' })
    .returning({ id: recipes.id });
  return row.id;
}

async function createImport(token: string, url = TIKTOK_URL) {
  return app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: { authorization: `Bearer ${token}` },
    payload: { source: { url } },
  });
}

async function getJob(token: string, id: string) {
  return app.inject({ method: 'GET', url: `/v1/imports/${id}`, headers: { authorization: `Bearer ${token}` } });
}

/** Polls GET /:id until terminal or attempts run out; records the status path. */
async function pollUntilTerminal(token: string, id: string) {
  const statuses: string[] = [];
  let final: Record<string, unknown> = {};
  for (let i = 0; i < 240; i++) {
    final = (await getJob(token, id)).json().job;
    if (statuses[statuses.length - 1] !== final.status) statuses.push(final.status as string);
    if (final.status === 'ready' || final.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return { statuses, final };
}

beforeAll(async () => {
  await startDbos();
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await stopDbos();
  await pool.end();
});

beforeEach(async () => {
  resetParseProvider();
  await db.delete(importJobs);
  await db.delete(recipes);
  await db.delete(users);
});

afterEach(() => resetParseProvider());

describe('TC-2/3: create → 202 + queued row + workflow drives transitions (AC-2/3/5/6/7)', () => {
  it('returns 202 queued, writes one owner-scoped row, then advances running → failed(NO_RECIPE)', async () => {
    // Gate the parse step so we can observe the queued/running row first.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setParseProvider(async () => {
      await gate;
      return { outcome: 'failed', errorCode: 'NO_RECIPE' };
    });

    const { token, userId } = await mintBearer();
    const res = await createImport(token);
    expect(res.statusCode).toBe(202);
    const job = res.json().job;
    expect(job).toMatchObject({ status: 'queued', source_type: 'tiktok' });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await db.select().from(importJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);

    // Catch the running transition while the parse step is gated.
    let sawRunning = false;
    for (let i = 0; i < 80 && !sawRunning; i++) {
      if ((await getJob(token, job.id)).json().job.status === 'running') sawRunning = true;
      else await new Promise((r) => setTimeout(r, 25));
    }
    expect(sawRunning).toBe(true);

    release();
    const { statuses, final } = await pollUntilTerminal(token, job.id);
    expect(statuses).toContain('running');
    expect(final).toMatchObject({ status: 'failed', error_code: 'NO_RECIPE', progress: 100 });
  });

  it('persists a ready terminal with the recipe id when the parser returns ready', async () => {
    const { token } = await mintBearer();
    const recipeId = await seedRecipe();
    setParseProvider(async () => ({ outcome: 'ready', recipeId }));

    const id = (await createImport(token)).json().job.id;
    const { final } = await pollUntilTerminal(token, id);
    expect(final).toMatchObject({ status: 'ready', recipe_id: recipeId, progress: 100 });
  });
});

describe('TC-4: unsupported source → 422, zero rows (AC-4)', () => {
  it('rejects a profile URL and a junk share_payload with 422 and writes no rows', async () => {
    const { token } = await mintBearer();

    const profile = await createImport(token, 'https://instagram.com/someprofile');
    expect(profile.statusCode).toBe(422);
    expect(profile.json().error.code).toBe('UNSUPPORTED');

    const junk = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { authorization: `Bearer ${token}` },
      payload: { source: { share_payload: { text: 'hi' } } },
    });
    expect(junk.statusCode).toBe(422);
    expect(junk.json().error.code).toBe('UNSUPPORTED');

    expect(await db.select().from(importJobs)).toHaveLength(0);
  });
});

describe('TC-5: ownership + auth (AC-8)', () => {
  it("returns 404 for another user's job and 401 unauthenticated; 200 for the owner", async () => {
    setParseProvider(async () => ({ outcome: 'failed', errorCode: 'NO_RECIPE' }));
    const a = await mintBearer();
    const b = await mintBearer();
    const id = (await createImport(a.token)).json().job.id;

    expect((await getJob(a.token, id)).statusCode).toBe(200);

    const foreign = await getJob(b.token, id);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    const unauth = await app.inject({ method: 'GET', url: `/v1/imports/${id}` });
    expect(unauth.statusCode).toBe(401);
  });
});

describe('TC-6: crash-resume idempotency (AC-5)', () => {
  it('reaches its terminal state exactly once after a worker crashes mid-run', async () => {
    const { token, userId } = await mintBearer();
    const recipeId = await seedRecipe();
    const jobId = randomUUID();

    // A separate worker process starts the workflow, commits markRunning, then
    // hangs in the parse step; we SIGKILL it — a true mid-step crash.
    await crashWorkerAfterRunning(jobId, userId);
    expect((await getJob(token, jobId)).json().job.status).toBe('running');

    // Restarting this process's DBOS triggers recovery of the crashed run. The
    // parse step (no recorded result) re-runs here and returns ready; OAOO replay
    // skips the already-committed markRunning, so the terminal write lands once.
    setParseProvider(async () => ({ outcome: 'ready', recipeId }));
    await stopDbos();
    await startDbos();

    const { final } = await pollUntilTerminal(token, jobId);
    expect(final).toMatchObject({ status: 'ready', recipe_id: recipeId, progress: 100 });

    const rows = await db.select({ status: importJobs.status }).from(importJobs).where(sql`id = ${jobId}`);
    expect(rows).toEqual([{ status: 'ready' }]);
  }, 60000);
});
