import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import { groceryItems, recipes } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/api/app.js';

let app: FastifyInstance;
let phoneSeq = 0;

async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555557${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/users', payload: { user: { phone_number: phone } } });
  const body = res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const add = (token: string, items: unknown) =>
  app.inject({ method: 'POST', url: '/v1/grocery_items', headers: auth(token), payload: { items } });
const list = (token: string) =>
  app.inject({ method: 'GET', url: '/v1/grocery_items', headers: auth(token) }).then((r) => r.json().items);

beforeAll(() => {
  app = buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await db.delete(groceryItems);
  await db.delete(recipes);
});

describe('grocery items API', () => {
  it('adds a manual item, resolving aisle/icon/default unit', async () => {
    const { token } = await mintBearer();
    const res = await add(token, [{ name: 'chicken breast', amount: 2 }]);
    expect(res.statusCode).toBe(201);
    const [item] = res.json().items;
    expect(item).toMatchObject({ name: 'chicken breast', aisle: 'meat_seafood', icon: 'chicken', unit: 'pound', amount: 2 });
    expect(await list(token)).toHaveLength(1);
  });

  it('merges a re-added item by name + unit', async () => {
    const { token } = await mintBearer();
    await add(token, [{ name: 'milk', amount: 1, unit: 'carton' }]);
    await add(token, [{ name: 'Milk', amount: 2, unit: 'carton' }]);
    const items = await list(token);
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(3);
  });

  it('adds many items from a recipe with source_recipe_id', async () => {
    const { token, userId } = await mintBearer();
    const [recipe] = await db.insert(recipes).values({ userId, title: 'Test', sourceType: 'website' }).returning();
    const res = await add(token, [
      { name: 'soy sauce', amount: 0.25, unit: 'cup', source_recipe_id: recipe!.id },
      { name: 'garlic', amount: 3, unit: 'clove', source_recipe_id: recipe!.id },
      { name: 'salt', quantity_text: 'a pinch', source_recipe_id: recipe!.id },
    ]);
    expect(res.statusCode).toBe(201);
    const items = await list(token);
    expect(items).toHaveLength(3);
    expect(items.every((i: { source_recipe_id: string | null }) => i.source_recipe_id === recipe!.id)).toBe(true);
  });

  it('checks off, edits, and deletes an item', async () => {
    const { token } = await mintBearer();
    const { id } = (await add(token, [{ name: 'eggs', amount: 12 }])).json().items[0];
    const patched = await app.inject({ method: 'PATCH', url: `/v1/grocery_items/${id}`, headers: auth(token), payload: { checked: true } });
    expect(patched.json().item.checked).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: `/v1/grocery_items/${id}`, headers: auth(token) });
    expect(del.statusCode).toBe(204);
    expect(await list(token)).toHaveLength(0);
  });

  it("404s patching or deleting another user's item", async () => {
    const a = await mintBearer();
    const b = await mintBearer();
    const { id } = (await add(a.token, [{ name: 'butter', amount: 1 }])).json().items[0];
    const patch = await app.inject({ method: 'PATCH', url: `/v1/grocery_items/${id}`, headers: auth(b.token), payload: { checked: true } });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/v1/grocery_items/${id}`, headers: auth(b.token) });
    expect(del.statusCode).toBe(404);
  });

  it('rejects an empty add and an unauthenticated read', async () => {
    const { token } = await mintBearer();
    expect((await add(token, [])).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/grocery_items' })).statusCode).toBe(401);
  });
});

describe('common ingredients API', () => {
  it('serves the catalog contract, filterable by q', async () => {
    const { token } = await mintBearer();
    const res = await app.inject({ method: 'GET', url: '/v1/ingredients/common?q=apple', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const { ingredients } = res.json();
    expect(ingredients.length).toBeGreaterThan(0);
    expect(ingredients[0]).toHaveProperty('canonicalName');
    expect(ingredients[0]).toHaveProperty('aisle');
    expect(ingredients[0]).toHaveProperty('defaultUnit');
    expect(ingredients[0]).toHaveProperty('iconKey');
  });
});
