import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../../src/db/index.js';
import { buildApp } from '../../src/api/app.js';
import { initDbos, shutdownDbos } from '../../src/pipeline/bootstrap.js';
import { terminateOcr } from '../../src/parse/vision.js';
import type { PublicRecipe } from '../../src/models/recipe.js';

// LIVE end-to-end (npm run test:e2e). Drives the real API against a recipe
// website's schema.org JSON-LD (no LLM, no scraper — the Tier-0 structured path).
// Excluded from `npm test`. Assertions key on the real page's content.

const CASES = {
  // Half Baked Harvest (WP Recipe Maker) emits the whole method as ONE HowToStep
  // whose text is a numbered blob — the pipeline must explode it into discrete steps.
  numberedBlob: 'https://www.halfbakedharvest.com/strawberry-and-cream-stuffed-croissant-french-toast/',
} as const;

let app: FastifyInstance;
let phoneSeq = 0;

async function mintBearer(): Promise<string> {
  const phone = `+1555563${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  return res.json().auth.access_token.jwt;
}

function createImport(token: string, url: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: { authorization: `Bearer ${token}` },
    payload: { source: { url } },
  });
}

async function pollTerminal(token: string, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i++) {
    const res = await app.inject({ method: 'GET', url: `/v1/imports/${id}`, headers: { authorization: `Bearer ${token}` } });
    const job = res.json().job;
    if (job.status === 'ready' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('import never reached a terminal status');
}

async function importAndFetch(url: string): Promise<PublicRecipe[]> {
  const token = await mintBearer();
  const created = await createImport(token, url);
  expect(created.statusCode).toBe(202);

  const job = await pollTerminal(token, created.json().job.id);
  expect(job, `import failed: ${JSON.stringify(job)}`).toMatchObject({ status: 'ready', source_type: 'website' });

  const recipeIds = (job.recipe_ids as string[] | undefined) ?? [];
  const recipes: PublicRecipe[] = [];
  for (const id of recipeIds) {
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    recipes.push(res.json().recipe);
  }
  return recipes;
}

beforeAll(async () => {
  await initDbos();
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await shutdownDbos();
  await terminateOcr();
  await pool.end();
});

describe('Website import — method collapsed into one numbered HowToStep', () => {
  it('splits the method into discrete ordered steps (croissant french toast)', async () => {
    const recipes = await importAndFetch(CASES.numberedBlob);
    expect(recipes).toHaveLength(1);
    const recipe = recipes[0];
    expect(recipe.title.length).toBeGreaterThan(0);
    expect(recipe.ingredients.length).toBeGreaterThan(0);
    // The bug: the whole method came back as ONE garbled step. Now it's many.
    expect(recipe.steps.length).toBeGreaterThanOrEqual(5);
    // No single step still carries the embedded "2." / "3." list markers.
    for (const step of recipe.steps) {
      expect(step, `step still contains an embedded list marker: "${step}"`).not.toMatch(/\s\d+\.\s/);
    }
    expect(recipe.steps[0].toLowerCase()).toMatch(/preheat|oven|375/);
  });
});
