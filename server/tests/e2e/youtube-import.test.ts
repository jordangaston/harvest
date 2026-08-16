import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, buildApp, initDbos, shutdownDbos, terminateOcr, YouTubeFetcher, type AppCompat } from './helpers/edge-harness.js';
import type { PublicRecipe } from '../../src/models/recipe.js';

// LIVE end-to-end (npm run test:e2e). Drives the real API against YouTube's
// InnerTube API (description + pinned comment) and website JSON-LD (a linked
// recipe). Excluded from `npm test`. Assertions key on each video's real content.

const CASES = {
  description: 'https://youtube.com/shorts/JESPUqVMJpU?is=jV9jxJP-SFbiyzmS',
  comments: 'https://youtube.com/shorts/WwSJhSpdnr0?is=v0p8_iFXXVWEjntz',
  transcript: 'https://youtu.be/79gZLSXINAU?is=5GiNUD8VMAxDjp8E',
} as const;

let app: AppCompat;
let phoneSeq = 0;

async function mintBearer(): Promise<string> {
  const phone = `+1555561${String(1000 + phoneSeq++).slice(-4)}`;
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
  expect(job, `import failed: ${JSON.stringify(job)}`).toMatchObject({ status: 'ready', source_type: 'youtube' });

  const recipeIds = (job.recipe_ids as string[] | undefined) ?? [];
  const recipes: PublicRecipe[] = [];
  for (const id of recipeIds) {
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    recipes.push(res.json().recipe);
  }
  return { job, recipes };
}

/** A valid recipe, matching the pipeline's bar (title + ingredients). */
function expectComplete(recipe: PublicRecipe): void {
  expect(recipe.title.length).toBeGreaterThan(0);
  expect(recipe.ingredients.length).toBeGreaterThan(0);
  expect(Array.isArray(recipe.steps)).toBe(true);
}

function haystack(recipe: PublicRecipe): string {
  return [recipe.title, ...recipe.ingredients.map((i) => i.name)].join(' ').toLowerCase();
}

beforeAll(async () => {
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

describe('YouTube fetch latency (< 2s requirement)', () => {
  it('fetches video data (description + pinned comment) in under 2 seconds', async () => {
    const start = Date.now();
    const video = await YouTubeFetcher.create().fetch(CASES.description);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(video.description || video.pinnedComment).toBeTruthy();
  });
});

describe('YouTube Shorts import — recipe in the description', () => {
  it('imports one recipe (Buffalo Chicken Hot Pockets)', async () => {
    const { recipes } = await importAndFetch(CASES.description);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/chicken|buffalo/);
  });
});

describe('YouTube Shorts import — recipe pinned in the comments', () => {
  it('imports one recipe from the pinned comment (Garlic Butter Spaghetti)', async () => {
    const { recipes } = await importAndFetch(CASES.comments);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/spaghetti|garlic|pasta/);
  });
});

describe('YouTube import — full-length video, recipe linked from the description', () => {
  it('imports one recipe (Marry Me Tuscan Chicken Soup)', async () => {
    const { recipes } = await importAndFetch(CASES.transcript);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/chicken|tuscan|soup/);
  });
});
