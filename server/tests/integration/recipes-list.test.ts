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

function recipe(title: string): RecipeInput {
  return {
    title,
    sourceType: 'instagram',
    servings: 2,
    servingsEstimated: false,
    imageUrl: `https://img.example/${title}.jpg`,
    totalMinutes: 20,
    ingredients: [
      { name: 'chicken thighs', amount: '2', unit: 'pound', quantityText: '2 lb chicken thighs' },
      { name: 'soy sauce', amount: '2', unit: 'tbsp', quantityText: '2 tbsp soy sauce' },
    ],
    steps: ['Cook'],
    nutrition: null,
  };
}

let app: FastifyInstance;
let phoneSeq = 0;

async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555556${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone, code: '123456', name: 'Test User' } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function newCookbook(token: string, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/v1/cookbooks', headers: auth(token), payload: { cookbook: { name } } });
  return res.json().cookbook.id;
}

function fileInto(token: string, recipeId: string, cookbookIds: string[]) {
  return app.inject({ method: 'PUT', url: `/v1/recipes/${recipeId}/cookbooks`, headers: auth(token), payload: { cookbook_ids: cookbookIds } });
}

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await db.delete(mealPlanEntries);
  await db.delete(importJobs);
  await db.delete(cookbookRecipes);
  await db.delete(ingredients);
  await db.delete(recipeSteps);
  await db.delete(cookbooks);
  await db.delete(recipes);
  await db.delete(users);
});

describe('GET /v1/recipes', () => {
  it('401s without a bearer token', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/recipes' })).statusCode).toBe(401);
  });

  it('lists owned ∪ cookbook recipes, deduped, and never double-counts one that is both', async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const repo = RecipeRepository.create();
    const a = await repo.persist(recipe('A'), me.userId);
    const b = await repo.persist(recipe('B'), me.userId);
    const c = await repo.persist(recipe('C'), other.userId); // owned by other

    const cb = await newCookbook(me.token, 'Mine');
    await fileInto(me.token, c, [cb]); // C is in my cookbook (not owned)
    await fileInto(me.token, a, [cb]); // A is owned AND in my cookbook → still once

    const res = await app.inject({ method: 'GET', url: '/v1/recipes', headers: auth(me.token) });
    expect(res.statusCode).toBe(200);
    const ids = res.json().recipes.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual([a, b, c].sort());
  });

  it('keyset-paginates without overlap or gaps', async () => {
    const me = await mintBearer();
    const repo = RecipeRepository.create();
    const all = new Set<string>();
    for (const t of ['A', 'B', 'C', 'D', 'E']) all.add(await repo.persist(recipe(t), me.userId));

    const seen: string[] = [];
    let token: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const url: string = `/v1/recipes?page_size=2${token ? `&page_token=${encodeURIComponent(token)}` : ''}`;
      const body = (await app.inject({ method: 'GET', url, headers: auth(me.token) })).json();
      seen.push(...body.recipes.map((r: { id: string }) => r.id));
      token = body.page_token;
      if (!token) break;
    }
    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5); // no overlap
    expect([...all].every((id) => seen.includes(id))).toBe(true); // no gaps
  });

  it('omits expand fields unless requested, and scopes cookbook_ids to the caller', async () => {
    const me = await mintBearer();
    const repo = RecipeRepository.create();
    const a = await repo.persist(recipe('A'), me.userId);
    const cb = await newCookbook(me.token, 'Mine');
    await fileInto(me.token, a, [cb]);

    const lean = (await app.inject({ method: 'GET', url: '/v1/recipes', headers: auth(me.token) })).json().recipes[0];
    expect(lean.ingredient_names).toBeUndefined();
    expect(lean.cookbook_ids).toBeUndefined();
    expect(lean).toMatchObject({ id: a, title: 'A', total_minutes: 20 });

    const expanded = (
      await app.inject({ method: 'GET', url: '/v1/recipes?expand=ingredient_names,cookbook_ids', headers: auth(me.token) })
    ).json().recipes[0];
    expect(expanded.ingredient_names).toEqual(['chicken thighs', 'soy sauce']);
    expect(expanded.cookbook_ids).toEqual([cb]);
  });
});
