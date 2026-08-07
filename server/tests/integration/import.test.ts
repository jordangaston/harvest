import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import { importJobs, users, recipes, ingredients, recipeSteps } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/api/app.js';
import { initDbos, shutdownDbos } from '../../src/pipeline/bootstrap.js';

const TIKTOK_URL = 'https://www.tiktok.com/@caitlynskitchen/video/7663645567339334943';

let app: FastifyInstance;
let phoneSeq = 0;

/** Registers a fresh user (WI-02 flow) and returns a Bearer token + id. */
async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555556${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function createImport(token: string, source: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: { authorization: `Bearer ${token}` },
    payload: { source },
  });
}

function getJob(token: string, id: string) {
  return app.inject({ method: 'GET', url: `/v1/imports/${id}`, headers: { authorization: `Bearer ${token}` } });
}

/** Polls until the job reaches a terminal status (the workflow runs async). */
async function pollTerminal(token: string, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const job = (await getJob(token, id)).json().job;
    if (job.status === 'ready' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('job never reached a terminal status');
}

beforeAll(async () => {
  await initDbos();
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await shutdownDbos();
  await pool.end();
});

beforeEach(async () => {
  // Clear FK dependents before their parents.
  await db.delete(importJobs);
  await db.delete(ingredients);
  await db.delete(recipeSteps);
  await db.delete(recipes);
  await db.delete(users);
});

describe('POST /v1/imports', () => {
  it('creates one owner-scoped queued job that the workflow drives to a persisted recipe', async () => {
    const { token, userId } = await mintBearer();

    const res = await createImport(token, { url: TIKTOK_URL });
    expect(res.statusCode).toBe(202);
    const job = res.json().job;
    expect(job).toMatchObject({ status: 'queued', source_type: 'tiktok' });

    const jobRows = await db.select().from(importJobs);
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0].userId).toBe(userId);

    // Offline stubs run in test: the stub TikTok caption yields a recipe, so the
    // workflow terminates `ready` with a persisted recipe. The title comes from
    // the stub caption — asserting it guards against this test going to the network.
    const terminal = await pollTerminal(token, job.id);
    expect(terminal).toMatchObject({ status: 'ready', progress: 100 });
    expect(terminal.recipe_id).toBeDefined();
    const recipeRows = await db.select().from(recipes);
    expect(recipeRows).toHaveLength(1);
    expect(recipeRows[0].title).toBe('Crockpot Chicken Teriyaki');
    // C6: the importer owns the recipe. C4: the stub carries no yield, so servings
    // is the estimate. C5: the stub's lone ingredient doesn't resolve → below the
    // coverage floor → nutrition stays unknown (null), never fabricated.
    expect(recipeRows[0].userId).toBe(userId);
    expect(recipeRows[0].servings).toBe(4);
    expect(recipeRows[0].servingsEstimated).toBe(true);
    expect(recipeRows[0].nutritionSource).toBeNull();
  });

  it('rejects an unsupported source with 422 and writes no row', async () => {
    const { token } = await mintBearer();

    const profile = await createImport(token, { url: 'https://instagram.com/someprofile' });
    expect(profile.statusCode).toBe(422);
    expect(profile.json().error.code).toBe('UNSUPPORTED');

    const junk = await createImport(token, { share_payload: { text: 'no link here' } });
    expect(junk.statusCode).toBe(422);

    expect(await db.select().from(importJobs)).toHaveLength(0);
  });
});

describe('GET /v1/imports/:id', () => {
  it('200 for the owner, 404 for another user, 401 unauthenticated', async () => {
    const owner = await mintBearer();
    const other = await mintBearer();
    const id = (await createImport(owner.token, { url: TIKTOK_URL })).json().job.id;

    expect((await getJob(owner.token, id)).statusCode).toBe(200);

    const foreign = await getJob(other.token, id);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    expect((await app.inject({ method: 'GET', url: `/v1/imports/${id}` })).statusCode).toBe(401);
  });
});
