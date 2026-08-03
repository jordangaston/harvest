import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '../../src/db/index.js';
import { recipes, ingredients, recipeSteps, savedRecipes, users } from '../../src/db/schema/index.js';
import { RealParseProvider } from '../../src/parse/parse-provider.js';
import { StubTranscriber } from '../../src/parse/asr.js';
import { StubVision } from '../../src/parse/vision.js';
import { StubExtractor } from '../../src/parse/extractor.js';
import { MediaExtractor } from '../../src/fetch/media-extractor.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';
import type { ParseInput } from '../../src/pipeline/parse-step.js';

// A recipe page with JSON-LD, served locally so the website path is hermetic.
const RECIPE_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe",
 "name":"Garlic Butter Chicken",
 "recipeIngredient":["2 chicken breasts","3 cloves garlic","2 tbsp butter"],
 "recipeInstructions":[{"@type":"HowToStep","text":"Sear the chicken."},
                       {"@type":"HowToStep","text":"Add the garlic butter."}],
 "recipeYield":["4 servings"],"totalTime":"PT30M"}
</script></head><body></body></html>`;

let server: Server;
let recipeUrl: string;
// Rows this file created, torn down in afterEach so it never touches other files' data.
const createdUsers: string[] = [];
const createdRecipes: string[] = [];

/** A provider wired with stubs; `extractor` is a spy so tests can assert calls. */
function makeProvider(extractor = new StubExtractor()) {
  const extractSpy = vi.spyOn(extractor, 'extract');
  const provider = new RealParseProvider(
    new StubTranscriber(),
    new StubVision(),
    extractor,
    MediaExtractor.create(),
    RecipeRepository.create(),
  );
  return { provider, extractSpy };
}

async function seedUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ phone: `+1${Date.now()}${createdUsers.length}`, jwtPrivateKey: 'k', jwtPublicKey: 'k' })
    .returning({ id: users.id });
  createdUsers.push(row.id);
  return row.id;
}

async function recipeIdsFor(userId: string): Promise<string[]> {
  const rows = await db.select({ id: savedRecipes.recipeId }).from(savedRecipes).where(eq(savedRecipes.userId, userId));
  const ids = rows.map((r) => r.id);
  createdRecipes.push(...ids);
  return ids;
}

function input(over: Partial<ParseInput>): ParseInput {
  return { jobId: 'job', userId: '', sourceType: 'tiktok', sourceRef: '', ...over };
}

beforeAll(async () => {
  server = createServer((_, res) => res.end(RECIPE_HTML));
  await new Promise<void>((r) => server.listen(0, r));
  recipeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/recipe`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end();
});

// Tear down only this file's rows (FK-safe order) so parallel files don't clash.
afterEach(async () => {
  vi.restoreAllMocks();
  if (createdUsers.length) await db.delete(savedRecipes).where(inArray(savedRecipes.userId, createdUsers));
  if (createdRecipes.length) await db.delete(recipes).where(inArray(recipes.id, createdRecipes));
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
  createdUsers.length = 0;
  createdRecipes.length = 0;
});

describe('TC-1 (AC-1): website path, Tier 0, no LLM', () => {
  it('persists the JSON-LD recipe + saved row without calling the extractor', async () => {
    const userId = await seedUser();
    const { provider, extractSpy } = makeProvider();

    const outcome = await provider.run(input({ userId, sourceType: 'website', sourceRef: recipeUrl }));

    expect(outcome).toMatchObject({ outcome: 'ready' });
    expect(extractSpy).not.toHaveBeenCalled();
    const [recipeId] = await recipeIdsFor(userId);
    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(row.title).toBe('Garlic Butter Chicken');
    expect(await db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId))).toHaveLength(3);
    expect(await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).toHaveLength(2);
    expect(await db.select().from(savedRecipes).where(eq(savedRecipes.userId, userId))).toHaveLength(1);
  });
});

describe('TC-2 (AC-2): tiktok caption path via stub extractor', () => {
  it('yields a recipe from the caption and returns ready', async () => {
    const userId = await seedUser();
    const oembed = await import('../../src/fetch/tiktok-oembed.js');
    vi.spyOn(oembed.TikTokOembed.prototype, 'fetch').mockResolvedValue({
      caption: 'Crockpot Chicken Teriyaki',
      thumbnailUrl: 'https://cdn/x.jpg',
    });
    const { provider, extractSpy } = makeProvider();

    const outcome = await provider.run(input({ userId, sourceType: 'tiktok', sourceRef: 'https://tiktok.com/@x/video/1' }));

    expect(outcome).toMatchObject({ outcome: 'ready' });
    expect(extractSpy).toHaveBeenCalledOnce();
    const [recipeId] = await recipeIdsFor(userId);
    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(row.title).toBe('Crockpot Chicken Teriyaki');
  });
});

describe('TC-3 (AC-3): pinterest outbound link → website recurse', () => {
  it('follows the outbound link and persists the linked page recipe (no LLM)', async () => {
    const userId = await seedUser();
    const fetcher = await import('../../src/fetch/apify-fetcher.js');
    vi.spyOn(fetcher.StubApifyFetcher.prototype, 'fetchPost').mockResolvedValue({
      caption: 'pin',
      outboundLink: recipeUrl,
    });
    const { provider, extractSpy } = makeProvider();

    const outcome = await provider.run(input({ userId, sourceType: 'pinterest', sourceRef: 'https://pin.it/abc' }));

    expect(outcome).toMatchObject({ outcome: 'ready' });
    expect(extractSpy).not.toHaveBeenCalled();
    const [recipeId] = await recipeIdsFor(userId);
    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(row.title).toBe('Garlic Butter Chicken');
  });
});

describe('TC-4 (AC-4): empty source → NO_RECIPE, nothing persisted', () => {
  it('returns failed NO_RECIPE and saves nothing for the user', async () => {
    const userId = await seedUser();
    const empty = new StubExtractor();
    vi.spyOn(empty, 'extract').mockResolvedValue({ title: '', ingredients: [], steps: [], confidence: 0 });
    const { provider } = makeProvider(empty);

    const outcome = await provider.run(input({ userId, sourceType: 'tiktok', sourceRef: 'https://tiktok.com/@x/video/2' }));

    expect(outcome).toEqual({ outcome: 'failed', errorCode: 'NO_RECIPE' });
    expect(await db.select().from(savedRecipes).where(eq(savedRecipes.userId, userId))).toHaveLength(0);
  });
});

describe('TC-5 (AC-5): RecipeRepository.persist row counts + idempotent re-save', () => {
  const recipe: RecipeInput = {
    title: 'Test Bake',
    sourceType: 'website',
    sourceUrl: 'https://example.com/r',
    ingredients: ['3 cloves garlic', '2 tbsp butter'],
    steps: ['Mix', 'Bake'],
    confidence: 0.9,
  };

  it('writes recipe + N ingredients (with icons) + M steps + one join, idempotently', async () => {
    const userId = await seedUser();
    const repo = RecipeRepository.create();

    const recipeId = await repo.persist(recipe, userId);
    createdRecipes.push(recipeId);
    const ingRows = await db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId));
    expect(ingRows).toHaveLength(2);
    expect(ingRows.map((r) => r.icon).sort()).toEqual(['butter', 'garlic']);
    expect(await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).toHaveLength(2);
    expect(await db.select().from(savedRecipes).where(eq(savedRecipes.userId, userId))).toHaveLength(1);

    // The unique (user_id, recipe_id) makes a re-save of the same pair a no-op.
    await db.insert(savedRecipes).values({ userId, recipeId }).onConflictDoNothing();
    expect(await db.select().from(savedRecipes).where(eq(savedRecipes.recipeId, recipeId))).toHaveLength(1);
  });
});
