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
  mealPlanEntries,
  users,
} from '../../src/db/schema/index.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';
import { buildApp } from '../../src/api/app.js';

const RECIPE: RecipeInput = {
  title: 'Maple Soy Chicken',
  sourceType: 'instagram',
  servings: 4,
  servingsEstimated: false,
  imageUrl: 'https://img.example/chicken.jpg',
  ingredients: [{ name: 'chicken thighs', amount: '2', unit: 'pound', quantityText: '2 lb chicken thighs' }],
  steps: ['Bake'],
  nutrition: null,
};

let app: FastifyInstance;
let phoneSeq = 0;

async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555557${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function addEntry(token: string, entry: { date: string; meal: string; recipe_id: string }) {
  return app.inject({ method: 'POST', url: '/v1/meal-plan', headers: auth(token), payload: { entry } });
}

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  // meal_plan_entries first — it FK-references recipes and users.
  await db.delete(mealPlanEntries);
  await db.delete(importJobs);
  await db.delete(cookbookRecipes);
  await db.delete(ingredients);
  await db.delete(recipeSteps);
  await db.delete(cookbooks);
  await db.delete(recipes);
  await db.delete(users);
});

describe('POST /v1/meal-plan', () => {
  it('assigns a recipe to a slot (201) with its card and position 0, then appends at 1', async () => {
    const me = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);

    const first = await addEntry(me.token, { date: '2026-08-06', meal: 'lunch', recipe_id: recipeId });
    expect(first.statusCode).toBe(201);
    expect(first.json().entry).toMatchObject({
      date: '2026-08-06',
      meal: 'lunch',
      position: 0,
      recipe: { id: recipeId, title: 'Maple Soy Chicken', image_url: 'https://img.example/chicken.jpg' },
    });

    const second = await addEntry(me.token, { date: '2026-08-06', meal: 'lunch', recipe_id: recipeId });
    expect(second.json().entry.position).toBe(1);
  });

  it('404s an unknown recipe id', async () => {
    const me = await mintBearer();
    const res = await addEntry(me.token, { date: '2026-08-06', meal: 'lunch', recipe_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('400s a malformed date', async () => {
    const me = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    expect((await addEntry(me.token, { date: '08/06/2026', meal: 'lunch', recipe_id: recipeId })).statusCode).toBe(400);
  });
});

describe('GET /v1/meal-plan', () => {
  it('returns the caller entries in the range, ordered by date then meal, scoped to the caller', async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    const otherRecipe = await RecipeRepository.create().persist(RECIPE, other.userId);

    await addEntry(me.token, { date: '2026-08-07', meal: 'dinner', recipe_id: recipeId });
    await addEntry(me.token, { date: '2026-08-06', meal: 'breakfast', recipe_id: recipeId });
    await addEntry(other.token, { date: '2026-08-06', meal: 'lunch', recipe_id: otherRecipe });

    const res = await app.inject({ method: 'GET', url: '/v1/meal-plan?start=2026-08-03&end=2026-08-09', headers: auth(me.token) });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries;
    expect(entries.map((e: { date: string; meal: string }) => [e.date, e.meal])).toEqual([
      ['2026-08-06', 'breakfast'],
      ['2026-08-07', 'dinner'],
    ]);
  });

  it('excludes entries outside the range', async () => {
    const me = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    await addEntry(me.token, { date: '2026-08-20', meal: 'lunch', recipe_id: recipeId });
    const res = await app.inject({ method: 'GET', url: '/v1/meal-plan?start=2026-08-03&end=2026-08-09', headers: auth(me.token) });
    expect(res.json().entries).toEqual([]);
  });

  it('400s missing, malformed, or too-wide ranges', async () => {
    const me = await mintBearer();
    expect((await app.inject({ method: 'GET', url: '/v1/meal-plan', headers: auth(me.token) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/meal-plan?start=2026-08-09&end=2026-08-03', headers: auth(me.token) })).json().error.code).toBe('INVALID_RANGE');
    expect((await app.inject({ method: 'GET', url: '/v1/meal-plan?start=2026-08-01&end=2026-09-30', headers: auth(me.token) })).json().error.code).toBe('INVALID_RANGE');
  });
});

describe('DELETE /v1/meal-plan/:id', () => {
  it('removes the caller entry (204); a repeat or another user 404s', async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    const entryId = (await addEntry(me.token, { date: '2026-08-06', meal: 'lunch', recipe_id: recipeId })).json().entry.id;

    expect((await app.inject({ method: 'DELETE', url: `/v1/meal-plan/${entryId}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/v1/meal-plan/${entryId}`, headers: auth(me.token) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/v1/meal-plan/${entryId}`, headers: auth(me.token) })).statusCode).toBe(404);
  });

  it('cascades: deleting the recipe removes its meal-plan entries', async () => {
    const me = await mintBearer();
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    await addEntry(me.token, { date: '2026-08-06', meal: 'lunch', recipe_id: recipeId });

    await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipeId}`, headers: auth(me.token) });

    const res = await app.inject({ method: 'GET', url: '/v1/meal-plan?start=2026-08-03&end=2026-08-09', headers: auth(me.token) });
    expect(res.json().entries).toEqual([]);
  });
});

describe('auth', () => {
  it('401s every meal-plan route without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/meal-plan?start=2026-08-03&end=2026-08-09' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/meal-plan', payload: { entry: {} } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/v1/meal-plan/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(401);
  });
});
