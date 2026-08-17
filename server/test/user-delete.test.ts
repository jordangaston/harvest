import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  users,
  recipes,
  ingredients,
  recipeSteps,
  cookbooks,
  cookbookRecipes,
  importJobs,
  mealPlanEntries,
} from "../src/schema.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { makeHarness, type Harness } from "./helpers/wave2-harness.js";

/**
 * DELETE /v1/users/me — ported from the Fastify suite (tests/integration/user-delete.test.ts)
 * to the Hono app over a `file:` libSQL db. Assertions preserved; only the harness changed.
 */
const RECIPE: RecipeInput = {
  title: "Deletable Bake",
  sourceType: "website",
  sourceUrl: "https://example.com/r",
  servings: 4,
  servingsEstimated: false,
  ingredients: [{ name: "garlic", amount: "3", unit: null, quantityText: "3 cloves garlic" }],
  steps: ["Mix", "Bake"],
  nutrition: null,
  allergens: null,
};

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

/** Seeds a recipe, a cookbook, the recipe→cookbook link, and an import job for the user. */
async function seedOwnedData(user: { token: string; userId: string }): Promise<string> {
  const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, user.userId);
  const cb = await h.app.request("/v1/cookbooks", { method: "POST", headers: h.auth(user.token), body: JSON.stringify({ cookbook: { name: "Mains" } }) });
  const cbId = (await cb.json()).cookbook.id;
  await h.app.request(`/v1/recipes/${recipeId}/cookbooks`, { method: "PUT", headers: h.auth(user.token), body: JSON.stringify({ cookbook_ids: [cbId] }) });
  await h.db.insert(importJobs).values({ userId: user.userId, status: "ready", sourceType: "website", sourceRef: "https://x" });
  return recipeId;
}

describe("DELETE /v1/users/me", () => {
  it("deletes the user and every row they own, cascading recipe children", async () => {
    const me = await h.mintBearer();
    const recipeId = await seedOwnedData(me);
    // A second user whose data must survive the delete.
    const other = await h.mintBearer();
    await seedOwnedData(other);

    const res = await h.app.request("/v1/users/me", { method: "DELETE", headers: h.auth(me.token) });
    expect(res.status).toBe(204);

    // The caller and all their rows are gone.
    expect(await h.db.select().from(users).where(eq(users.id, me.userId))).toHaveLength(0);
    expect(await h.db.select().from(recipes).where(eq(recipes.userId, me.userId))).toHaveLength(0);
    expect(await h.db.select().from(cookbooks).where(eq(cookbooks.userId, me.userId))).toHaveLength(0);
    expect(await h.db.select().from(importJobs).where(eq(importJobs.userId, me.userId))).toHaveLength(0);
    // Recipe children cascaded.
    expect(await h.db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId))).toHaveLength(0);
    expect(await h.db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).toHaveLength(0);
    expect(await h.db.select().from(cookbookRecipes)).toHaveLength(1); // only `other`'s link remains

    // The other user is untouched.
    expect(await h.db.select().from(users).where(eq(users.id, other.userId))).toHaveLength(1);
    expect(await h.db.select().from(recipes).where(eq(recipes.userId, other.userId))).toHaveLength(1);
  });

  it("requires a token — 401 deletes nothing", async () => {
    const me = await h.mintBearer();
    const res = await h.app.request("/v1/users/me", { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await h.db.select().from(users).where(eq(users.id, me.userId))).toHaveLength(1);
  });

  it("deletes the user's meal_plan_entries", async () => {
    const me = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    await h.db.insert(mealPlanEntries).values({ userId: me.userId, date: "2026-08-10", meal: "dinner", recipeId, position: 0 });

    const res = await h.app.request("/v1/users/me", { method: "DELETE", headers: h.auth(me.token) });
    expect(res.status).toBe(204);

    expect(await h.db.select().from(mealPlanEntries).where(eq(mealPlanEntries.userId, me.userId))).toHaveLength(0);
  });
});
