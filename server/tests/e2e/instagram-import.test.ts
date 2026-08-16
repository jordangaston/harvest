import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, buildApp, initDbos, shutdownDbos, terminateOcr, type AppCompat } from './helpers/edge-harness.js';
import type { PublicRecipe } from '../../src/models/recipe.js';

// LIVE end-to-end (npm run test:e2e). Drives the real API — POST /v1/imports →
// workflow → GET /v1/imports/:id → GET /v1/recipes/:id — against the actual
// Apify scraper, Groq ASR/vision/extraction, and ffmpeg. It hits the network and
// costs money every run; that is the point of an e2e. It is excluded from
// `npm test`. Assertions key on each post's real content (a stub or a
// network fallback returns different data and fails), so a green run proves the
// pipeline pulled and parsed these specific Instagram posts.

// The six acceptance URLs, grouped by content shape.
const CASES = {
  reelCaption1: 'https://www.instagram.com/reel/DYmyAAaMDBj/?igsh=N2Rtd21rcnhuanA=',
  reelCaption2: 'https://www.instagram.com/reel/DaDh4o8PFvG/?igsh=MXZpaGcxbDE1bXg0Nw==',
  photoCaption: 'https://www.instagram.com/p/DW8r9IDkcZ-/?igsh=MW5ybTZmcmF2anpkaQ==',
  reelContent: 'https://www.instagram.com/reel/DUMTpkqE5Mw/?igsh=MXgyM2xlaDRtcGpydw==',
  slideshow1: 'https://www.instagram.com/p/DRxXRvVD6wQ/?img_index=10&igsh=bWlpdjY1NnRtNDcx',
  slideshow2: 'https://www.instagram.com/p/DSVcUWtEjiL/?img_index=10&igsh=MXU0b29mOTB3d2g3MQ==',
} as const;

let app: AppCompat;
let phoneSeq = 0;

/** Registers a fresh user and returns a Bearer token. */
async function mintBearer(): Promise<string> {
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
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

/** Polls a job to a terminal status; real scraping + LLM per import is slow. */
async function pollTerminal(token: string, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 290; i++) {
    const res = await app.inject({ method: 'GET', url: `/v1/imports/${id}`, headers: { authorization: `Bearer ${token}` } });
    const job = res.json().job;
    if (job.status === 'ready' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('import never reached a terminal status');
}

/** Imports a URL and returns the terminal job plus its fetched recipes. */
async function importAndFetch(url: string): Promise<{ job: Record<string, unknown>; recipes: PublicRecipe[] }> {
  const token = await mintBearer();
  const created = await createImport(token, url);
  expect(created.statusCode).toBe(202);

  const job = await pollTerminal(token, created.json().job.id);
  expect(job, `import failed: ${JSON.stringify(job)}`).toMatchObject({ status: 'ready', source_type: 'instagram' });

  const recipeIds = (job.recipe_ids as string[] | undefined) ?? [];
  const recipes: PublicRecipe[] = [];
  for (const id of recipeIds) {
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    recipes.push(res.json().recipe);
  }
  return { job, recipes };
}

/** A valid recipe, matching the pipeline's bar (title + ingredients). Steps
 * aren't required non-empty: some captions keep the method behind a bio link. */
function expectComplete(recipe: PublicRecipe): void {
  expect(recipe.title.length).toBeGreaterThan(0);
  expect(recipe.ingredients.length).toBeGreaterThan(0);
  expect(Array.isArray(recipe.steps)).toBe(true);
}

/** The recipe's searchable text — title + ingredients — lowercased. */
function haystack(recipe: PublicRecipe): string {
  return [recipe.title, ...recipe.ingredients.map((i) => i.name)].join(' ').toLowerCase();
}

beforeAll(async () => {
  // Guard: without live creds the pipeline silently uses offline stubs, which
  // would return the wrong data. Fail loudly instead.
  expect(process.env.APIFY_TOKEN, 'APIFY_TOKEN must be set for the live e2e').toBeTruthy();
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

describe('Instagram import — reel with the recipe in the caption', () => {
  it('imports one recipe from a caption (Peruvian chicken)', async () => {
    const { recipes } = await importAndFetch(CASES.reelCaption1);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(recipes[0].image_url, 'reel thumbnail').toBeDefined();
    expect(haystack(recipes[0])).toMatch(/chicken/);
  });

  it('imports one recipe from a caption (peach salsa + grilled lemon asparagus)', async () => {
    const { recipes } = await importAndFetch(CASES.reelCaption2);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/peach|salsa|asparagus/);
  });
});

describe('Instagram import — single photo with the recipe in the caption', () => {
  it('imports one recipe from a photo caption (sweet potato fritters)', async () => {
    const { recipes } = await importAndFetch(CASES.photoCaption);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/sweet potato|ricotta|fritter/);
  });
});

describe('Instagram import — reel whose recipe lives in the video (not the caption)', () => {
  it('imports one recipe from the video content (honey lemon garlic chicken)', async () => {
    const { recipes } = await importAndFetch(CASES.reelContent);
    expect(recipes).toHaveLength(1);
    expectComplete(recipes[0]);
    expect(haystack(recipes[0])).toMatch(/chicken/);
  });
});

describe('Instagram import — multi-recipe slideshow carousel', () => {
  it('imports several recipes, each with its own thumbnail (slideshow 1)', async () => {
    const { recipes } = await importAndFetch(CASES.slideshow1);
    expect(recipes.length).toBeGreaterThanOrEqual(2);
    for (const recipe of recipes) {
      expectComplete(recipe);
      // The thumbnail is the dish photo on the slide before the instructions.
      expect(recipe.image_url, `thumbnail for "${recipe.title}"`).toMatch(/^https?:\/\//);
      // Carousel recipe cards carry their method — every recipe has cooking steps.
      expect(recipe.steps.length, `steps for "${recipe.title}"`).toBeGreaterThan(0);
    }
  });

  it('imports several recipes, each with its own thumbnail (slideshow 2)', async () => {
    const { recipes } = await importAndFetch(CASES.slideshow2);
    expect(recipes.length).toBeGreaterThanOrEqual(2);
    for (const recipe of recipes) {
      expectComplete(recipe);
      expect(recipe.image_url, `thumbnail for "${recipe.title}"`).toMatch(/^https?:\/\//);
      expect(recipe.steps.length, `steps for "${recipe.title}"`).toBeGreaterThan(0);
    }
  });
});
