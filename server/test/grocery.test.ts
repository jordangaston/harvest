import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recipes } from "../src/schema.js";
import { makeHarness, type Harness } from "./helpers/wave2-harness.js";

/**
 * Grocery items API (add/list/patch/delete + common) — ported from the Fastify suite
 * (tests/integration/grocery.test.ts) to the Hono app over a `file:` libSQL db.
 * Assertions preserved; only the harness changed.
 */
let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

const add = (token: string, items: unknown) =>
  h.app.request("/v1/grocery_items", { method: "POST", headers: h.auth(token), body: JSON.stringify({ items }) });
const list = async (token: string) => {
  const res = await h.app.request("/v1/grocery_items", { headers: h.auth(token) });
  return (await res.json()).items;
};

describe("grocery items API", () => {
  it("adds a manual item, resolving aisle/icon/default unit", async () => {
    const { token } = await h.mintBearer();
    const res = await add(token, [{ name: "chicken breast", amount: 2 }]);
    expect(res.status).toBe(201);
    const [item] = (await res.json()).items;
    expect(item).toMatchObject({ name: "chicken breast", aisle: "meat_seafood", icon: "chicken", unit: "pound", amount: 2 });
    expect(await list(token)).toHaveLength(1);
  });

  it("merges a re-added item by name + unit", async () => {
    const { token } = await h.mintBearer();
    await add(token, [{ name: "milk", amount: 1, unit: "carton" }]);
    await add(token, [{ name: "Milk", amount: 2, unit: "carton" }]);
    const items = await list(token);
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(3);
  });

  it("adds many items from a recipe with source_recipe_id", async () => {
    const { token, userId } = await h.mintBearer();
    const [recipe] = await h.db.insert(recipes).values({ userId, title: "Test", sourceType: "website" }).returning();
    const res = await add(token, [
      { name: "soy sauce", amount: 0.25, unit: "cup", source_recipe_id: recipe!.id },
      { name: "garlic", amount: 3, unit: "clove", source_recipe_id: recipe!.id },
      { name: "salt", quantity_text: "a pinch", source_recipe_id: recipe!.id },
    ]);
    expect(res.status).toBe(201);
    const items = await list(token);
    expect(items).toHaveLength(3);
    expect(items.every((i: { source_recipe_id: string | null }) => i.source_recipe_id === recipe!.id)).toBe(true);
  });

  it("checks off, edits, and deletes an item", async () => {
    const { token } = await h.mintBearer();
    const { id } = (await (await add(token, [{ name: "eggs", amount: 12 }])).json()).items[0];
    const patched = await h.app.request(`/v1/grocery_items/${id}`, { method: "PATCH", headers: h.auth(token), body: JSON.stringify({ checked: true }) });
    expect((await patched.json()).item.checked).toBe(true);
    const del = await h.app.request(`/v1/grocery_items/${id}`, { method: "DELETE", headers: h.auth(token) });
    expect(del.status).toBe(204);
    expect(await list(token)).toHaveLength(0);
  });

  it("404s patching or deleting another user's item", async () => {
    const a = await h.mintBearer();
    const b = await h.mintBearer();
    const { id } = (await (await add(a.token, [{ name: "butter", amount: 1 }])).json()).items[0];
    const patch = await h.app.request(`/v1/grocery_items/${id}`, { method: "PATCH", headers: h.auth(b.token), body: JSON.stringify({ checked: true }) });
    expect(patch.status).toBe(404);
    const del = await h.app.request(`/v1/grocery_items/${id}`, { method: "DELETE", headers: h.auth(b.token) });
    expect(del.status).toBe(404);
  });

  it("rejects an empty add and an unauthenticated read", async () => {
    const { token } = await h.mintBearer();
    expect((await add(token, [])).status).toBe(400);
    expect((await h.app.request("/v1/grocery_items")).status).toBe(401);
  });
});

describe("common ingredients API", () => {
  it("serves the catalog contract, filterable by q", async () => {
    const { token } = await h.mintBearer();
    const res = await h.app.request("/v1/ingredients/common?q=apple", { headers: h.auth(token) });
    expect(res.status).toBe(200);
    const { ingredients } = await res.json();
    expect(ingredients.length).toBeGreaterThan(0);
    expect(ingredients[0]).toHaveProperty("canonicalName");
    expect(ingredients[0]).toHaveProperty("aisle");
    expect(ingredients[0]).toHaveProperty("defaultUnit");
    expect(ingredients[0]).toHaveProperty("iconKey");
  });
});
