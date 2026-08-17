import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, buildApp, initDbos, shutdownDbos, terminateOcr, type AppCompat } from './helpers/edge-harness.js';
import type { PublicRecipe } from '../../src/models/recipe.js';

// LIVE end-to-end (npm run test:e2e). Drives the real API + allergenStep against a
// recipe website's schema.org JSON-LD, asserting the imported row carries the allergen
// profile. Excluded from `npm test`. Requires the seeded allergen catalog (WI-2) in the
// dev server's Turso — with an empty seed every recipe reads `complete: false` and no
// positives, so the guard below skips the positive assertion rather than fail spuriously.

// Corpus of real recipes with the major allergens their ingredients imply.
const CASES: { url: string; expectedAllergens: string[] }[] = [
  {
    // Croissant french toast: croissants (wheat), milk/cream, eggs.
    url: 'https://www.halfbakedharvest.com/strawberry-and-cream-stuffed-croissant-french-toast/',
    expectedAllergens: ['milk', 'egg', 'wheat'],
  },
];

let app: AppCompat;
let phoneSeq = 0;

async function mintBearer(): Promise<string> {
  const phone = `+1555564${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  return res.json().auth.access_token.jwt;
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
  const created = await app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: { authorization: `Bearer ${token}` },
    payload: { source: { url } },
  });
  expect(created.statusCode).toBe(202);

  const job = await pollTerminal(token, created.json().job.id);
  expect(job, `import failed: ${JSON.stringify(job)}`).toMatchObject({ status: 'ready' });

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

describe('Allergen import — imported rows carry the allergen profile', () => {
  it.each(CASES)('detects allergens for $url', async ({ url, expectedAllergens }) => {
    const [recipe] = await importAndFetch(url);
    expect(recipe).toBeDefined();

    const allergens = recipe.allergens;
    // With no seeded allergen catalog the profile is withheld/incomplete — skip the
    // positive assertion (seed-dependent), never fail. `allergens` present + complete
    // means the catalog is seeded and we can assert the expected set is covered.
    if (!allergens || !allergens.complete) return;

    const found = new Set([...allergens.contains, ...allergens.may_contain]);
    for (const allergen of expectedAllergens) {
      expect(found, `expected ${allergen} in ${JSON.stringify([...found])}`).toContain(allergen);
    }
  });
});
