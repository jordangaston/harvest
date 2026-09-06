import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recipes } from "../src/schema.js";
import { makeHarness, type Harness } from "./helpers/wave2-harness.js";

/**
 * Grocery items API — now HOUSEHOLD-scoped (groceries-chef WI-01). Each caller's list is
 * their household's; two members share one list; the household id is derived from the token,
 * never supplied, so cross-household access is impossible. Runs against a `file:` libSQL db.
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
    const { token, userId } = await h.mintBearer();
    await h.seedHousehold(userId);
    const res = await add(token, [{ name: "chicken breast", amount: 2 }]);
    expect(res.status).toBe(201);
    const [item] = (await res.json()).items;
    expect(item).toMatchObject({ name: "chicken breast", aisle: "meat_seafood", icon: "chicken", unit: "pound", amount: 2 });
    expect(await list(token)).toHaveLength(1);
  });

  it("merges a re-added item by name + unit", async () => {
    const { token, userId } = await h.mintBearer();
    await h.seedHousehold(userId);
    await add(token, [{ name: "milk", amount: 1, unit: "carton" }]);
    await add(token, [{ name: "Milk", amount: 2, unit: "carton" }]);
    const items = await list(token);
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(3);
  });

  it("adds many items from a recipe with source_recipe_id", async () => {
    const { token, userId } = await h.mintBearer();
    await h.seedHousehold(userId);
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
    const { token, userId } = await h.mintBearer();
    await h.seedHousehold(userId);
    const { id } = (await (await add(token, [{ name: "eggs", amount: 12 }])).json()).items[0];
    const patched = await h.app.request(`/v1/grocery_items/${id}`, { method: "PATCH", headers: h.auth(token), body: JSON.stringify({ checked: true }) });
    expect((await patched.json()).item.checked).toBe(true);
    const del = await h.app.request(`/v1/grocery_items/${id}`, { method: "DELETE", headers: h.auth(token) });
    expect(del.status).toBe(204);
    expect(await list(token)).toHaveLength(0);
  });

  it("404s patching or deleting another household's item", async () => {
    const a = await h.mintBearer();
    await h.seedHousehold(a.userId);
    const b = await h.mintBearer();
    await h.seedHousehold(b.userId);
    const { id } = (await (await add(a.token, [{ name: "butter", amount: 1 }])).json()).items[0];
    const patch = await h.app.request(`/v1/grocery_items/${id}`, { method: "PATCH", headers: h.auth(b.token), body: JSON.stringify({ checked: true }) });
    expect(patch.status).toBe(404);
    const del = await h.app.request(`/v1/grocery_items/${id}`, { method: "DELETE", headers: h.auth(b.token) });
    expect(del.status).toBe(404);
  });

  it("rejects an empty add and an unauthenticated read", async () => {
    const { token, userId } = await h.mintBearer();
    await h.seedHousehold(userId);
    expect((await add(token, [])).status).toBe(400);
    expect((await h.app.request("/v1/grocery_items")).status).toBe(401);
  });

  it("returns a clean 4xx (not 500) for a caller with no household", async () => {
    const { token } = await h.mintBearer(); // no seedHousehold
    const res = await h.app.request("/v1/grocery_items", { headers: h.auth(token) });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_HOUSEHOLD");
    expect((await add(token, [{ name: "eggs" }])).status).toBe(409);
  });
});

describe("household scoping", () => {
  it("member A sees and can check off items member B added to the shared list", async () => {
    const a = await h.mintBearer();
    const b = await h.mintBearer();
    await h.seedHousehold(a.userId, [a.userId, b.userId]);
    // B adds an item; A sees it.
    const { id } = (await (await add(b.token, [{ name: "bread", amount: 1 }])).json()).items[0];
    const aList = await list(a.token);
    expect(aList).toHaveLength(1);
    expect(aList[0].name).toBe("bread");
    // A can check off B's item (household membership authorizes).
    const patched = await h.app.request(`/v1/grocery_items/${id}`, { method: "PATCH", headers: h.auth(a.token), body: JSON.stringify({ checked: true }) });
    expect(patched.status).toBe(200);
    expect((await patched.json()).item.checked).toBe(true);
  });

  it("merges across the household — A's eggs + B's eggs = one line", async () => {
    const a = await h.mintBearer();
    const b = await h.mintBearer();
    await h.seedHousehold(a.userId, [a.userId, b.userId]);
    await add(a.token, [{ name: "eggs", amount: 2, unit: "count" }]);
    await add(b.token, [{ name: "eggs", amount: 3, unit: "count" }]);
    const items = await list(a.token);
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(5);
  });

  it("isolates a second household's list", async () => {
    const a = await h.mintBearer();
    await h.seedHousehold(a.userId);
    const b = await h.mintBearer();
    await h.seedHousehold(b.userId);
    await add(a.token, [{ name: "onions", amount: 3 }]);
    expect(await list(a.token)).toHaveLength(1);
    expect(await list(b.token)).toHaveLength(0);
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
