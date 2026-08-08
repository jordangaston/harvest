import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import {
  recipes,
  ingredients,
  recipeSteps,
  cookbooks,
  cookbookRecipes,
  importJobs,
  users,
} from '../../src/db/schema/index.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';
import { buildApp } from '../../src/api/app.js';

const RECIPE: RecipeInput = {
  title: 'Test Bake',
  sourceType: 'website',
  sourceUrl: 'https://example.com/r',
  servings: 4,
  servingsEstimated: false,
  ingredients: [
    { name: 'garlic', amount: '3', unit: null, quantityText: '3 cloves garlic' },
    { name: 'butter', amount: '2', unit: 'tablespoon', quantityText: '2 tbsp butter' },
  ],
  steps: ['Mix', 'Bake'],
  nutrition: null,
};

let app: FastifyInstance;
let phoneSeq = 0;

/** Registers a fresh user and returns a Bearer token + id. */
async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555557${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function getRecipe(token: string | null, id: string) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await db.delete(importJobs);
  await db.delete(cookbookRecipes);
  await db.delete(ingredients);
  await db.delete(recipeSteps);
  await db.delete(cookbooks);
  await db.delete(recipes);
  await db.delete(users);
});

describe('GET /v1/recipes/:id', () => {
  it('returns the recipe with ordered, measurement-separated ingredients for any authenticated caller', async () => {
    const owner = await mintBearer();
    const browser = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    // A different user who never created it can still open it while browsing.
    const res = await getRecipe(browser.token, recipeId);
    expect(res.statusCode).toBe(200);
    expect(res.json().recipe).toEqual({
      id: recipeId,
      title: 'Test Bake',
      source_type: 'website',
      source_url: 'https://example.com/r',
      servings: 4,
      servings_estimated: false,
      ingredients: [
        { name: 'garlic', icon: 'garlic', quantity_text: '3 cloves garlic', amount: '3' },
        { name: 'butter', icon: 'butter', quantity_text: '2 tbsp butter', amount: '2', unit: 'tablespoon' },
      ],
      steps: ['Mix', 'Bake'],
    });
  });

  it('404s an unknown id, 401s unauthenticated', async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    const unknown = await getRecipe(owner.token, '00000000-0000-0000-0000-000000000000');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('NOT_FOUND');

    expect((await getRecipe(null, recipeId)).statusCode).toBe(401);
  });
});

describe('PATCH /v1/recipes/:id (owner edits in place)', () => {
  it('edits the owner\'s recipe in place, keeping the same id', async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${recipeId}`,
      headers: auth(owner.token),
      payload: { steps: ['Mix well', 'Bake at 350'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().recipe.id).toBe(recipeId); // same id — no fork/clone
    expect(res.json().recipe.steps).toEqual(['Mix well', 'Bake at 350']);
  });

  it('re-parses edited ingredient lines so scaling survives an edit (C3)', async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${recipeId}`,
      headers: auth(owner.token),
      payload: { ingredients: ['2 cups flour'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().recipe.ingredients).toEqual([
      { name: 'flour', icon: 'flour', quantity_text: '2 cups flour', amount: '2', unit: 'cup' },
    ]);
  });

  it('404s a non-owner edit (we do not leak existence)', async () => {
    const owner = await mintBearer();
    const stranger = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${recipeId}`,
      headers: auth(stranger.token),
      payload: { steps: ['nope'] },
    });
    expect(res.statusCode).toBe(404);
    // The owner's recipe is untouched.
    expect((await getRecipe(owner.token, recipeId)).json().recipe.steps).toEqual(['Mix', 'Bake']);
  });
});

describe('DELETE /v1/recipes/:id (owner deletes the canonical recipe)', () => {
  it('deletes the owner\'s recipe (children cascade); a second delete 404s', async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    const del = await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(owner.token) });
    expect(del.statusCode).toBe(204);

    // The canonical recipe is gone — a re-delete and a read both 404.
    expect((await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(owner.token) })).statusCode).toBe(404);
    expect((await getRecipe(owner.token, recipeId)).statusCode).toBe(404);
  });

  it('404s a non-owner delete', async () => {
    const owner = await mintBearer();
    const stranger = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);
    expect((await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(stranger.token) })).statusCode).toBe(404);
    // Still there for the owner.
    expect((await getRecipe(owner.token, recipeId)).statusCode).toBe(200);
  });
});
