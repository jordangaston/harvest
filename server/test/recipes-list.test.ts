import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { makeHarness, type Harness } from "./helpers/wave2-harness.js";

/**
 * GET /v1/recipes (library list) — ported from the Fastify suite
 * (tests/integration/recipes-list.test.ts) to the Hono app over a `file:` libSQL db.
 * Assertions preserved; only the harness changed.
 */
function recipe(title: string): RecipeInput {
  return {
    title,
    sourceType: "instagram",
    servings: 2,
    servingsEstimated: false,
    imageUrl: `https://img.example/${title}.jpg`,
    totalMinutes: 20,
    ingredients: [
      { name: "chicken thighs", amount: "2", unit: "pound", quantityText: "2 lb chicken thighs" },
      { name: "soy sauce", amount: "2", unit: "tbsp", quantityText: "2 tbsp soy sauce" },
    ],
    steps: ["Cook"],
    nutrition: null,
  };
}

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

async function newCookbook(token: string, name: string): Promise<string> {
  const res = await h.app.request("/v1/cookbooks", { method: "POST", headers: h.auth(token), body: JSON.stringify({ cookbook: { name } }) });
  return (await res.json()).cookbook.id;
}

function fileInto(token: string, recipeId: string, cookbookIds: string[]) {
  return h.app.request(`/v1/recipes/${recipeId}/cookbooks`, { method: "PUT", headers: h.auth(token), body: JSON.stringify({ cookbook_ids: cookbookIds }) });
}

describe("GET /v1/recipes", () => {
  it("401s without a bearer token", async () => {
    expect((await h.app.request("/v1/recipes")).status).toBe(401);
  });

  it("lists owned ∪ cookbook recipes, deduped, and never double-counts one that is both", async () => {
    const me = await h.mintBearer();
    const other = await h.mintBearer();
    const repo = RecipeRepository.create(h.db);
    const a = await repo.persist(recipe("A"), me.userId);
    const b = await repo.persist(recipe("B"), me.userId);
    const c = await repo.persist(recipe("C"), other.userId); // owned by other

    const cb = await newCookbook(me.token, "Mine");
    await fileInto(me.token, c, [cb]); // C is in my cookbook (not owned)
    await fileInto(me.token, a, [cb]); // A is owned AND in my cookbook → still once

    const res = await h.app.request("/v1/recipes", { headers: h.auth(me.token) });
    expect(res.status).toBe(200);
    const ids = (await res.json()).recipes.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual([a, b, c].sort());
  });

  it("keyset-paginates without overlap or gaps", async () => {
    const me = await h.mintBearer();
    const repo = RecipeRepository.create(h.db);
    const all = new Set<string>();
    for (const t of ["A", "B", "C", "D", "E"]) all.add(await repo.persist(recipe(t), me.userId));

    const seen: string[] = [];
    let token: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const url: string = `/v1/recipes?page_size=2${token ? `&page_token=${encodeURIComponent(token)}` : ""}`;
      const body = await (await h.app.request(url, { headers: h.auth(me.token) })).json();
      seen.push(...body.recipes.map((r: { id: string }) => r.id));
      token = body.page_token;
      if (!token) break;
    }
    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5); // no overlap
    expect([...all].every((id) => seen.includes(id))).toBe(true); // no gaps
  });

  it("omits expand fields unless requested, and scopes cookbook_ids to the caller", async () => {
    const me = await h.mintBearer();
    const repo = RecipeRepository.create(h.db);
    const a = await repo.persist(recipe("A"), me.userId);
    const cb = await newCookbook(me.token, "Mine");
    await fileInto(me.token, a, [cb]);

    const lean = (await (await h.app.request("/v1/recipes", { headers: h.auth(me.token) })).json()).recipes[0];
    expect(lean.ingredient_names).toBeUndefined();
    expect(lean.cookbook_ids).toBeUndefined();
    expect(lean).toMatchObject({ id: a, title: "A", total_minutes: 20 });

    const expanded = (
      await (await h.app.request("/v1/recipes?expand=ingredient_names,cookbook_ids", { headers: h.auth(me.token) })).json()
    ).recipes[0];
    expect(expanded.ingredient_names).toEqual(["chicken thighs", "soy sauce"]);
    expect(expanded.cookbook_ids).toEqual([cb]);
  });
});
