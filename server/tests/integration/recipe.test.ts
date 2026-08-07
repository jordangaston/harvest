import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import {
  recipes,
  ingredients,
  recipeSteps,
  savedRecipes,
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
  await db.delete(cookbookRecipes);
  await db.delete(savedRecipes);
  await db.delete(ingredients);
  await db.delete(recipeSteps);
  await db.delete(cookbooks);
  await db.delete(recipes);
  await db.delete(users);
});

/** Bearer header for an inject call. (inject sets content-type itself when there's a payload.) */
function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Ensures `token`'s user has the recipe saved (PUT membership with [] just ensures the library row). */
function saveForUser(token: string, recipeId: string, cookbookIds: string[] = []) {
  return app.inject({
    method: 'PUT',
    url: `/v1/recipes/${recipeId}/cookbooks`,
    headers: auth(token),
    payload: { cookbook_ids: cookbookIds },
  });
}

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

describe('PATCH /v1/recipes/:id (edit, copy-on-write)', () => {
  it('edits in place when the caller is the only saver', async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${recipeId}`,
      headers: auth(owner.token),
      payload: { steps: ['Mix well', 'Bake at 350'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().recipe.id).toBe(recipeId); // same id — no fork
    expect(res.json().recipe.steps).toEqual(['Mix well', 'Bake at 350']);
  });

  it('forks a private clone when another user also saved it, leaving theirs untouched', async () => {
    const owner = await mintBearer();
    const other = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);
    await saveForUser(other.token, recipeId); // now two savers

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${recipeId}`,
      headers: auth(owner.token),
      payload: { ingredients: ['1 onion, diced'] },
    });

    expect(res.statusCode).toBe(200);
    const cloneId = res.json().recipe.id;
    expect(cloneId).not.toBe(recipeId); // forked
    expect(res.json().recipe.ingredients).toEqual([{ name: '1 onion, diced', icon: 'onion' }]);

    // The other user's original is unchanged.
    const original = await getRecipe(other.token, recipeId);
    expect(original.json().recipe.ingredients).toEqual([
      { name: '3 cloves garlic', icon: 'garlic' },
      { name: '2 tbsp butter', icon: 'butter' },
    ]);
  });

  it("404s when the caller hasn't saved the recipe", async () => {
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
  });
});

describe('DELETE /v1/recipes/:id (remove from library)', () => {
  it('removes the recipe from the caller only; the shared recipe survives for other savers', async () => {
    const owner = await mintBearer();
    const other = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);
    await saveForUser(other.token, recipeId);

    const del = await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(owner.token) });
    expect(del.statusCode).toBe(204);

    // Owner no longer has it; a second delete 404s.
    expect((await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(owner.token) })).statusCode).toBe(404);
    // The canonical recipe still exists for the other saver.
    expect((await getRecipe(other.token, recipeId)).statusCode).toBe(200);
  });

  it("404s deleting a recipe the caller never saved", async () => {
    const owner = await mintBearer();
    const stranger = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, owner.userId);
    expect((await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(stranger.token) })).statusCode).toBe(404);
  });
});
