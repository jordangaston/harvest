import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import { recipes, ingredients, recipeSteps, savedRecipes, importJobs, users } from '../../src/db/schema/index.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';
import { buildApp } from '../../src/api/app.js';

const RECIPE: RecipeInput = {
  title: 'Test Bake',
  sourceType: 'website',
  sourceUrl: 'https://example.com/r',
  servings: 4,
  ingredients: ['3 cloves garlic', '2 tbsp butter'],
  steps: ['Mix', 'Bake'],
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

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await db.delete(importJobs);
  await db.delete(savedRecipes);
  await db.delete(ingredients);
  await db.delete(recipeSteps);
  await db.delete(recipes);
  await db.delete(users);
});

describe('GET /v1/recipes/:id', () => {
  it('returns the recipe with ordered ingredients and steps for any authenticated caller', async () => {
    const owner = await mintBearer();
    const browser = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    // A different user who never saved it can still open it while browsing.
    const res = await getRecipe(browser.token, recipeId);
    expect(res.statusCode).toBe(200);
    expect(res.json().recipe).toEqual({
      id: recipeId,
      title: 'Test Bake',
      source_type: 'website',
      source_url: 'https://example.com/r',
      servings: 4,
      ingredients: [
        { name: '3 cloves garlic', icon: 'garlic' },
        { name: '2 tbsp butter', icon: 'butter' },
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
