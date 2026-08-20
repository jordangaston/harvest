import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * Integration tests for recipe read/edit/delete — ported from the original Fastify
 * suite (server/tests/integration/recipe.test.ts) to the Hono app driven with
 * `app.request()` against a local `file:` libSQL db (offline, no network).
 */
const RECIPE: RecipeInput = {
  title: "Test Bake",
  sourceType: "website",
  sourceUrl: "https://example.com/r",
  servings: 4,
  servingsEstimated: false,
  ingredients: [
    { name: "garlic", amount: "3", unit: null, quantityText: "3 cloves garlic" },
    { name: "butter", amount: "2", unit: "tablespoon", quantityText: "2 tbsp butter" },
  ],
  steps: ["Mix", "Bake"],
  nutrition: null,
  allergens: null,
};

let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
});

afterEach(() => cleanup());

/** Registers a fresh user and returns a Bearer token + id. */
async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555557${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function getRecipe(token: string | null, id: string) {
  return app.request(`/v1/recipes/${id}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("GET /v1/recipes/:id", () => {
  it("returns the recipe with ordered, measurement-separated ingredients for any authenticated caller", async () => {
    const owner = await mintBearer();
    const browser = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    // A different user who never created it can still open it while browsing.
    const res = await getRecipe(browser.token, recipeId);
    expect(res.status).toBe(200);
    expect((await res.json()).recipe).toEqual({
      id: recipeId,
      title: "Test Bake",
      source_type: "website",
      source_url: "https://example.com/r",
      servings: 4,
      servings_estimated: false,
      ingredients: [
        { name: "garlic", icon: "garlic", quantity_text: "3 cloves garlic", amount: "3" },
        { name: "butter", icon: "butter", quantity_text: "2 tbsp butter", amount: "2", unit: "tablespoon" },
      ],
      steps: ["Mix", "Bake"],
      categories: { cuisine: [], meal_type: [], dish_type: [], primary_ingredient: [] },
      diets: [],
      cost_per_serving_cents: null,
      cost_coverage: null,
    });
  });

  it("projects to id + exactly the requested ?fields (unknown names ignored)", async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    const res = await app.request(`/v1/recipes/${recipeId}?fields=ingredients,steps,bogus`, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(res.status).toBe(200);
    const { recipe } = await res.json();
    expect(Object.keys(recipe).sort()).toEqual(["id", "ingredients", "steps"]);
    expect(recipe.id).toBe(recipeId);
    expect(recipe.steps).toEqual(["Mix", "Bake"]);
    expect(recipe.title).toBeUndefined(); // not requested
  });

  it("persists diet verdicts + blocker and surfaces them on the read (WI-DS-1)", async () => {
    const owner = await mintBearer();
    const repo = RecipeRepository.create(db);
    const withDiets: RecipeInput = {
      ...RECIPE,
      diets: {
        fit: { vegan: "incompatible", keto: "compatible", pescatarian: "unknown" },
        blockers: { vegan: { kind: "ingredient", value: "bacon", class: "red_meat" } },
        coverageComplete: true,
      },
    };
    const recipeId = await repo.persist(withDiets, owner.userId);

    const diets = (await (await getRecipe(owner.token, recipeId)).json()).recipe.diets;
    expect(diets).toContainEqual({ diet_id: "keto", verdict: "compatible" });
    expect(diets).toContainEqual({ diet_id: "pescatarian", verdict: "unknown" });
    expect(diets).toContainEqual({
      diet_id: "vegan",
      verdict: "incompatible",
      blocker: { kind: "ingredient", value: "bacon", class: "red_meat" },
    });
  });

  it("404s an unknown id, 401s unauthenticated", async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    const unknown = await getRecipe(owner.token, "00000000-0000-0000-0000-000000000000");
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("NOT_FOUND");

    expect((await getRecipe(null, recipeId)).status).toBe(401);
  });
});

describe("PATCH /v1/recipes/:id (owner edits in place)", () => {
  it("edits the owner's recipe in place, keeping the same id", async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    const res = await app.request(`/v1/recipes/${recipeId}`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({ steps: ["Mix well", "Bake at 350"] }),
    });

    expect(res.status).toBe(200);
    const recipe = (await res.json()).recipe;
    expect(recipe.id).toBe(recipeId); // same id — no fork/clone
    expect(recipe.steps).toEqual(["Mix well", "Bake at 350"]);
  });

  it("re-parses edited ingredient lines so scaling survives an edit (C3)", async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    const res = await app.request(`/v1/recipes/${recipeId}`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({ ingredients: ["2 cups flour"] }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).recipe.ingredients).toEqual([
      { name: "flour", icon: "flour", quantity_text: "2 cups flour", amount: "2", unit: "cup" },
    ]);
  });

  it("404s a non-owner edit (we do not leak existence)", async () => {
    const owner = await mintBearer();
    const stranger = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    const res = await app.request(`/v1/recipes/${recipeId}`, {
      method: "PATCH",
      headers: auth(stranger.token),
      body: JSON.stringify({ steps: ["nope"] }),
    });
    expect(res.status).toBe(404);
    // The owner's recipe is untouched.
    expect((await (await getRecipe(owner.token, recipeId)).json()).recipe.steps).toEqual(["Mix", "Bake"]);
  });
});

describe("DELETE /v1/recipes/:id (owner deletes the canonical recipe)", () => {
  it("deletes the owner's recipe (children cascade); a second delete 404s", async () => {
    const owner = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);

    const del = await app.request(`/v1/recipes/${recipeId}`, { method: "DELETE", headers: auth(owner.token) });
    expect(del.status).toBe(204);

    // The canonical recipe is gone — a re-delete and a read both 404.
    expect(
      (await app.request(`/v1/recipes/${recipeId}`, { method: "DELETE", headers: auth(owner.token) })).status,
    ).toBe(404);
    expect((await getRecipe(owner.token, recipeId)).status).toBe(404);
  });

  it("404s a non-owner delete", async () => {
    const owner = await mintBearer();
    const stranger = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, owner.userId);
    expect(
      (await app.request(`/v1/recipes/${recipeId}`, { method: "DELETE", headers: auth(stranger.token) })).status,
    ).toBe(404);
    // Still there for the owner.
    expect((await getRecipe(owner.token, recipeId)).status).toBe(200);
  });
});
