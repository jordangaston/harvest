import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { makeHarness, type Harness } from "./helpers/wave2-harness.js";

/**
 * Meal-plan CRUD — ported from the Fastify suite (tests/integration/meal-plan.test.ts)
 * to the Hono app driven with `app.request()` against a local `file:` libSQL db. Every
 * assertion is preserved; only the harness (buildApp/inject/pg → app.request/file:) changed.
 */
const RECIPE: RecipeInput = {
  title: "Maple Soy Chicken",
  sourceType: "instagram",
  servings: 4,
  servingsEstimated: false,
  imageUrl: "https://img.example/chicken.jpg",
  ingredients: [{ name: "chicken thighs", amount: "2", unit: "pound", quantityText: "2 lb chicken thighs" }],
  steps: ["Bake"],
  nutrition: null,
  allergens: null,
};

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

function addEntry(token: string, entry: { date: string; meal: string; recipe_id: string }) {
  return h.app.request("/v1/meal-plan", { method: "POST", headers: h.auth(token), body: JSON.stringify({ entry }) });
}

describe("POST /v1/meal-plan", () => {
  it("assigns a recipe to a slot (201) with its card and position 0, then appends at 1", async () => {
    const me = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);

    const first = await addEntry(me.token, { date: "2026-08-06", meal: "lunch", recipe_id: recipeId });
    expect(first.status).toBe(201);
    expect((await first.json()).entry).toMatchObject({
      date: "2026-08-06",
      meal: "lunch",
      position: 0,
      recipe: { id: recipeId, title: "Maple Soy Chicken", image_url: "https://img.example/chicken.jpg" },
    });

    const second = await addEntry(me.token, { date: "2026-08-06", meal: "lunch", recipe_id: recipeId });
    expect((await second.json()).entry.position).toBe(1);
  });

  it("404s an unknown recipe id", async () => {
    const me = await h.mintBearer();
    const res = await addEntry(me.token, { date: "2026-08-06", meal: "lunch", recipe_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("400s a malformed date", async () => {
    const me = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    expect((await addEntry(me.token, { date: "08/06/2026", meal: "lunch", recipe_id: recipeId })).status).toBe(400);
  });
});

describe("GET /v1/meal-plan", () => {
  it("returns the caller entries in the range, ordered by date then meal, scoped to the caller", async () => {
    const me = await h.mintBearer();
    const other = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    const otherRecipe = await RecipeRepository.create(h.db).persist(RECIPE, other.userId);

    await addEntry(me.token, { date: "2026-08-07", meal: "dinner", recipe_id: recipeId });
    await addEntry(me.token, { date: "2026-08-06", meal: "breakfast", recipe_id: recipeId });
    await addEntry(other.token, { date: "2026-08-06", meal: "lunch", recipe_id: otherRecipe });

    const res = await h.app.request("/v1/meal-plan?start=2026-08-03&end=2026-08-09", { headers: h.auth(me.token) });
    expect(res.status).toBe(200);
    const entries = (await res.json()).entries;
    expect(entries.map((e: { date: string; meal: string }) => [e.date, e.meal])).toEqual([
      ["2026-08-06", "breakfast"],
      ["2026-08-07", "dinner"],
    ]);
  });

  it("excludes entries outside the range", async () => {
    const me = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    await addEntry(me.token, { date: "2026-08-20", meal: "lunch", recipe_id: recipeId });
    const res = await h.app.request("/v1/meal-plan?start=2026-08-03&end=2026-08-09", { headers: h.auth(me.token) });
    expect((await res.json()).entries).toEqual([]);
  });

  it("400s missing, malformed, or too-wide ranges", async () => {
    const me = await h.mintBearer();
    expect((await h.app.request("/v1/meal-plan", { headers: h.auth(me.token) })).status).toBe(400);
    const rev = await h.app.request("/v1/meal-plan?start=2026-08-09&end=2026-08-03", { headers: h.auth(me.token) });
    expect((await rev.json()).error.code).toBe("INVALID_RANGE");
    const wide = await h.app.request("/v1/meal-plan?start=2026-08-01&end=2026-09-30", { headers: h.auth(me.token) });
    expect((await wide.json()).error.code).toBe("INVALID_RANGE");
  });
});

describe("DELETE /v1/meal-plan/:id", () => {
  it("removes the caller entry (204); a repeat or another user 404s", async () => {
    const me = await h.mintBearer();
    const other = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    const entryId = (await (await addEntry(me.token, { date: "2026-08-06", meal: "lunch", recipe_id: recipeId })).json()).entry.id;

    expect((await h.app.request(`/v1/meal-plan/${entryId}`, { method: "DELETE", headers: h.auth(other.token) })).status).toBe(404);
    expect((await h.app.request(`/v1/meal-plan/${entryId}`, { method: "DELETE", headers: h.auth(me.token) })).status).toBe(204);
    expect((await h.app.request(`/v1/meal-plan/${entryId}`, { method: "DELETE", headers: h.auth(me.token) })).status).toBe(404);
  });

  it("cascades: deleting the recipe removes its meal-plan entries", async () => {
    const me = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    await addEntry(me.token, { date: "2026-08-06", meal: "lunch", recipe_id: recipeId });

    await h.app.request(`/v1/recipes/${recipeId}`, { method: "DELETE", headers: h.auth(me.token) });

    const res = await h.app.request("/v1/meal-plan?start=2026-08-03&end=2026-08-09", { headers: h.auth(me.token) });
    expect((await res.json()).entries).toEqual([]);
  });
});

describe("meal-plan auth", () => {
  it("401s every meal-plan route without a token", async () => {
    expect((await h.app.request("/v1/meal-plan?start=2026-08-03&end=2026-08-09")).status).toBe(401);
    expect((await h.app.request("/v1/meal-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry: {} }) })).status).toBe(401);
    expect((await h.app.request("/v1/meal-plan/00000000-0000-0000-0000-000000000000", { method: "DELETE" })).status).toBe(401);
  });
});
