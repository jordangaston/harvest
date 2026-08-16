import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, buildApp, initDbos, shutdownDbos, terminateOcr, PinterestFetcher, type AppCompat } from './helpers/edge-harness.js';
import type { PublicRecipe } from '../../src/models/recipe.js';

// LIVE end-to-end (npm run test:e2e). Drives the real API against Pinterest's
// public pidgets endpoint, then DeepSeek / website JSON-LD / Whisper ASR + ffmpeg.
// Excluded from `npm test`. Assertions key on each pin's real content.

const CASES = {
  caption: 'https://pin.it/6S1Z5sKLl',
  video1: 'https://pin.it/6q1kGQtUp',
  video2: 'https://pin.it/1B5KH6Niu',
} as const;

let app: AppCompat;
let phoneSeq = 0;

async function mintBearer(): Promise<string> {
  const phone = `+1555560${String(1000 + phoneSeq++).slice(-4)}`;
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
  for (let i = 0; i < 290; i++) {
    const res = await app.inject({ method: 'GET', url: `/v1/imports/${id}`, headers: { authorization: `Bearer ${token}` } });
    const job = res.json().job;
    if (job.status === 'ready' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('import never reached a terminal status');
}

async function importAndFetch(url: string): Promise<{ job: Record<string, unknown>; recipes: PublicRecipe[] }> {
  const token = await mintBearer();
  const created = await createImport(token, url);
  expect(created.statusCode).toBe(202);

  const job = await pollTerminal(token, created.json().job.id);
  expect(job, `import failed: ${JSON.stringify(job)}`).toMatchObject({ status: 'ready', source_type: 'pinterest' });

  const recipeIds = (job.recipe_ids as string[] | undefined) ?? [];
  const recipes: PublicRecipe[] = [];
  for (const id of recipeIds) {
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    recipes.push(res.json().recipe);
  }
  return { job, recipes };
}

/** A valid recipe, matching the pipeline's bar (title + ingredients). Steps may
 * be empty (Pinterest's structured recipe keeps the method on the linked site). */
function expectComplete(recipe: PublicRecipe): void {
  expect(recipe.title.length).toBeGreaterThan(0);
  expect(recipe.ingredients.length).toBeGreaterThan(0);
  expect(Array.isArray(recipe.steps)).toBe(true);
}

function haystack(recipe: PublicRecipe): string {
  return [recipe.title, ...recipe.ingredients.map((i) => i.name)].join(' ').toLowerCase();
}

beforeAll(async () => {
  expect(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY must be set for the live e2e').toBeTruthy();
  expect(process.env.GROQ_API_KEY, 'GROQ_API_KEY must be set for the live e2e').toBeTruthy();
  await initDbos();
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await shutdownDbos();
  await terminateOcr();
  await pool.end();
});

describe('Pinterest fetch latency (< 2s requirement)', () => {
  it('fetches pin data in under 2 seconds', async () => {
    const start = Date.now();
    const pin = await PinterestFetcher.create().fetchPin(CASES.caption);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(pin.description || pin.recipe || pin.link || pin.videoUrl).toBeTruthy();
  });
});

describe('Pinterest import — recipe in the caption', () => {
  it('imports one recipe (Jamaican Jerk Chicken)', async () => {
    const { recipes } = await importAndFetch(CASES.caption);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/chicken|jerk/);
  });
});

describe('Pinterest import — recipe in the video', () => {
  it('imports one recipe from the video (case 1)', async () => {
    const { recipes } = await importAndFetch(CASES.video1);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
  });

  it('imports one recipe from the video (case 2)', async () => {
    const { recipes } = await importAndFetch(CASES.video2);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
  });
});
