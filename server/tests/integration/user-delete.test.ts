import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import {
  users,
  recipes,
  ingredients,
  recipeSteps,
  cookbooks,
  cookbookRecipes,
  importJobs,
} from '../../src/db/schema/index.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';
import { buildApp } from '../../src/api/app.js';

const RECIPE: RecipeInput = {
  title: 'Deletable Bake',
  sourceType: 'website',
  sourceUrl: 'https://example.com/r',
  servings: 4,
  servingsEstimated: false,
  ingredients: [{ name: 'garlic', amount: '3', unit: null, quantityText: '3 cloves garlic' }],
  steps: ['Mix', 'Bake'],
  nutrition: null,
};

let app: FastifyInstance;
let phoneSeq = 0;

/** Registers a fresh user, returns a Bearer token + id. */
async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Seeds a recipe, a cookbook, the recipe→cookbook link, and an import job for the user. */
async function seedOwnedData(user: { token: string; userId: string }): Promise<string> {
  const recipeId = await RecipeRepository.create().persist(RECIPE, user.userId);
  const cb = await app.inject({
    method: 'POST',
    url: '/v1/cookbooks',
    headers: auth(user.token),
    payload: { cookbook: { name: 'Mains' } },
  });
  await app.inject({
    method: 'PUT',
    url: `/v1/recipes/${recipeId}/cookbooks`,
    headers: auth(user.token),
    payload: { cookbook_ids: [cb.json().cookbook.id] },
  });
  await db.insert(importJobs).values({ userId: user.userId, status: 'ready', sourceType: 'website', sourceRef: 'https://x' });
  return recipeId;
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

describe('DELETE /v1/users/me', () => {
  it('deletes the user and every row they own, cascading recipe children', async () => {
    const me = await mintBearer();
    const recipeId = await seedOwnedData(me);
    // A second user whose data must survive the delete.
    const other = await mintBearer();
    await seedOwnedData(other);

    const res = await app.inject({ method: 'DELETE', url: '/v1/users/me', headers: auth(me.token) });
    expect(res.statusCode).toBe(204);

    // The caller and all their rows are gone.
    expect(await db.select().from(users).where(eq(users.id, me.userId))).toHaveLength(0);
    expect(await db.select().from(recipes).where(eq(recipes.userId, me.userId))).toHaveLength(0);
    expect(await db.select().from(cookbooks).where(eq(cookbooks.userId, me.userId))).toHaveLength(0);
    expect(await db.select().from(importJobs).where(eq(importJobs.userId, me.userId))).toHaveLength(0);
    // Recipe children cascaded.
    expect(await db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId))).toHaveLength(0);
    expect(await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).toHaveLength(0);
    expect(await db.select().from(cookbookRecipes)).toHaveLength(1); // only `other`'s link remains

    // The other user is untouched.
    expect(await db.select().from(users).where(eq(users.id, other.userId))).toHaveLength(1);
    expect(await db.select().from(recipes).where(eq(recipes.userId, other.userId))).toHaveLength(1);
  });

  it('requires a token — 401 deletes nothing', async () => {
    const me = await mintBearer();
    const res = await app.inject({ method: 'DELETE', url: '/v1/users/me' });
    expect(res.statusCode).toBe(401);
    expect(await db.select().from(users).where(eq(users.id, me.userId))).toHaveLength(1);
  });

  // Defensive coverage for tables owned by sibling branches (Meal Planning,
  // Grocery List). They are absent here, so `deleteAccount` guards each with
  // `to_regclass`. This test stands up throwaway tables to prove the guarded
  // delete fires when they DO exist — the shape the coordinator's post-merge
  // test will exercise for real.
  it('deletes meal_plan_entries and grocery_items when those tables exist', async () => {
    const me = await mintBearer();
    await db.execute(sql`create table meal_plan_entries (user_id uuid not null)`);
    await db.execute(sql`create table grocery_items (user_id uuid not null)`);
    try {
      await db.execute(sql`insert into meal_plan_entries (user_id) values (${me.userId})`);
      await db.execute(sql`insert into grocery_items (user_id) values (${me.userId})`);

      const res = await app.inject({ method: 'DELETE', url: '/v1/users/me', headers: auth(me.token) });
      expect(res.statusCode).toBe(204);

      const mpe = await db.execute<{ n: number }>(sql`select count(*)::int as n from meal_plan_entries`);
      const gi = await db.execute<{ n: number }>(sql`select count(*)::int as n from grocery_items`);
      expect(mpe.rows[0].n).toBe(0);
      expect(gi.rows[0].n).toBe(0);
    } finally {
      await db.execute(sql`drop table if exists meal_plan_entries`);
      await db.execute(sql`drop table if exists grocery_items`);
    }
  });
});
