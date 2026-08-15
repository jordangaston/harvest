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
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone, code: '123456', name: 'Test' } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createCookbook(token: string, name: unknown) {
  return app.inject({ method: 'POST', url: '/v1/cookbooks', headers: auth(token), payload: { cookbook: { name } } });
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

describe('POST /v1/cookbooks', () => {
  it('creates a cookbook (201) with a zero count', async () => {
    const me = await mintBearer();
    const res = await createCookbook(me.token, 'Mains');
    expect(res.statusCode).toBe(201);
    expect(res.json().cookbook).toMatchObject({ name: 'Mains', recipe_count: 0 });
    expect(res.json().cookbook.id).toBeTruthy();
  });

  it('400s an empty / whitespace name', async () => {
    const me = await mintBearer();
    expect((await createCookbook(me.token, '')).statusCode).toBe(400);
    expect((await createCookbook(me.token, '   ')).statusCode).toBe(400);
  });

  it('409s a duplicate name for the same user, but allows the same name for a different user', async () => {
    const a = await mintBearer();
    const b = await mintBearer();
    expect((await createCookbook(a.token, 'Mains')).statusCode).toBe(201);
    const dup = await createCookbook(a.token, 'Mains');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('COOKBOOK_EXISTS');
    expect((await createCookbook(b.token, 'Mains')).statusCode).toBe(201); // different owner, fine
  });
});

describe('GET /v1/cookbooks', () => {
  it('lists the caller cookbooks with counts and a cover, newest first; empty for a new user', async () => {
    const me = await mintBearer();
    expect((await app.inject({ method: 'GET', url: '/v1/cookbooks', headers: auth(me.token) })).json().cookbooks).toEqual([]);

    const cbId = (await createCookbook(me.token, 'Dinners')).json().cookbook.id;
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    await app.inject({ method: 'PUT', url: `/v1/recipes/${recipeId}/cookbooks`, headers: auth(me.token), payload: { cookbook_ids: [cbId] } });

    const list = (await app.inject({ method: 'GET', url: '/v1/cookbooks', headers: auth(me.token) })).json().cookbooks;
    expect(list).toEqual([
      { id: cbId, name: 'Dinners', recipe_count: 1, cover_image_url: 'https://img.example/chicken.jpg' },
    ]);
  });
});

describe('GET /v1/cookbooks/:id', () => {
  it('returns the cookbook and its recipe cards; 404s another user cookbook', async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const cbId = (await createCookbook(me.token, 'Mains')).json().cookbook.id;
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);
    await app.inject({ method: 'PUT', url: `/v1/recipes/${recipeId}/cookbooks`, headers: auth(me.token), payload: { cookbook_ids: [cbId] } });

    const res = await app.inject({ method: 'GET', url: `/v1/cookbooks/${cbId}`, headers: auth(me.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      cookbook: { id: cbId, name: 'Mains' },
      recipes: [{ id: recipeId, title: 'Maple Soy Chicken', image_url: 'https://img.example/chicken.jpg' }],
    });

    expect((await app.inject({ method: 'GET', url: `/v1/cookbooks/${cbId}`, headers: auth(other.token) })).statusCode).toBe(404);
  });
});

describe('PUT /v1/recipes/:id/cookbooks', () => {
  it('files the recipe into the cookbook and ignores ids the caller does not own; 404s an unknown recipe', async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const mine = (await createCookbook(me.token, 'Mine')).json().cookbook.id;
    const theirs = (await createCookbook(other.token, 'Theirs')).json().cookbook.id;
    const recipeId = await RecipeRepository.create().persist(RECIPE, me.userId);

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/recipes/${recipeId}/cookbooks`,
      headers: auth(me.token),
      payload: { cookbook_ids: [mine, theirs] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cookbook_ids).toEqual([mine]); // theirs ignored

    // Unknown recipe id → 404.
    const unknown = await app.inject({
      method: 'PUT',
      url: `/v1/recipes/00000000-0000-0000-0000-000000000000/cookbooks`,
      headers: auth(me.token),
      payload: { cookbook_ids: [mine] },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
