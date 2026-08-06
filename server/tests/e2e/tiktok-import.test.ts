import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../../src/db/index.js';
import { buildApp } from '../../src/api/app.js';
import { initDbos, shutdownDbos } from '../../src/pipeline/bootstrap.js';
import { terminateOcr } from '../../src/parse/vision.js';
import type { PublicRecipe } from '../../src/models/recipe.js';

// LIVE end-to-end (npm run test:e2e). Drives the real API against LamaTok
// (TikTok private-media API), DeepSeek extraction, Groq Whisper ASR, and ffmpeg.
// Hits the network and costs money; excluded from `npm test`. Assertions key on
// each post's real content so a stub or fallback fails.

const CASES = {
  videoCaption1: 'https://www.tiktok.com/t/ZTAsQBAYX/',
  slideshow: 'https://www.tiktok.com/t/ZTAsQP5Ah/',
  videoCaption2: 'https://www.tiktok.com/t/ZTAsQb743/',
  videoOnly: 'https://www.tiktok.com/t/ZTAsQgLAx/',
} as const;

let app: FastifyInstance;
let phoneSeq = 0;

async function mintBearer(): Promise<string> {
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
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
  expect(job, `import failed: ${JSON.stringify(job)}`).toMatchObject({ status: 'ready', source_type: 'tiktok' });

  const recipeIds = (job.recipe_ids as string[] | undefined) ?? [];
  const recipes: PublicRecipe[] = [];
  for (const id of recipeIds) {
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    recipes.push(res.json().recipe);
  }
  return { job, recipes };
}

// A valid recipe, matching the pipeline's own bar (title + ingredients). Steps
// aren't required to be non-empty: some captions list ingredients but keep the
// method behind a "link in bio" (e.g. the Soy Chili Eggs post).
function expectComplete(recipe: PublicRecipe): void {
  expect(recipe.title.length).toBeGreaterThan(0);
  expect(recipe.ingredients.length).toBeGreaterThan(0);
  expect(Array.isArray(recipe.steps)).toBe(true);
}

function haystack(recipe: PublicRecipe): string {
  return [recipe.title, ...recipe.ingredients.map((i) => i.name)].join(' ').toLowerCase();
}

beforeAll(async () => {
  expect(process.env.LAMATOK_API_KEY, 'LAMATOK_API_KEY must be set for the live e2e').toBeTruthy();
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

describe('TikTok import — video with the recipe in the caption', () => {
  it('imports one recipe from a caption (Creamy Garlic Paprika Chicken)', async () => {
    const { recipes } = await importAndFetch(CASES.videoCaption1);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(recipes[0].image_url, 'video cover thumbnail').toBeDefined();
    expect(haystack(recipes[0])).toMatch(/chicken/);
  });

  it('imports one recipe from a second caption', async () => {
    const { recipes } = await importAndFetch(CASES.videoCaption2);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
  });
});

describe('TikTok import — multi-recipe slideshow (photo mode)', () => {
  it('imports several recipes, each with its own thumbnail', async () => {
    const { recipes } = await importAndFetch(CASES.slideshow);
    expect(recipes.length).toBeGreaterThanOrEqual(2);
    for (const recipe of recipes) {
      expectComplete(recipe);
      expect(recipe.image_url, `thumbnail for "${recipe.title}"`).toMatch(/^https?:\/\//);
    }
  });
});

describe('TikTok import — recipe only in the video (not the caption)', () => {
  it('imports one recipe from the video content via ASR + on-screen text', async () => {
    const { recipes } = await importAndFetch(CASES.videoOnly);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
  });
});
