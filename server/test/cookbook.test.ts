import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { CookbookRepository } from "../src/repositories/cookbook-repository.js";
import { cookbooks, cookbookRecipes } from "../src/schema.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * Integration tests for cookbook CRUD + recipe membership — ported from the original
 * Fastify suite (server/tests/integration/cookbook.test.ts) to the Hono app driven
 * with `app.request()` against a local `file:` libSQL db (offline, no network).
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

let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
});

afterEach(() => cleanup());

async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function createCookbook(token: string, name: unknown) {
  return app.request("/v1/cookbooks", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ cookbook: { name } }),
  });
}

function setMembership(token: string, recipeId: string, cookbookIds: string[]) {
  return app.request(`/v1/recipes/${recipeId}/cookbooks`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ cookbook_ids: cookbookIds }),
  });
}

function listCookbooks(token: string) {
  return app.request("/v1/cookbooks", { headers: auth(token) });
}

describe("POST /v1/cookbooks", () => {
  it("creates a cookbook (201) with a zero count", async () => {
    const me = await mintBearer();
    const res = await createCookbook(me.token, "Mains");
    expect(res.status).toBe(201);
    const cookbook = (await res.json()).cookbook;
    expect(cookbook).toMatchObject({ name: "Mains", recipe_count: 0 });
    expect(cookbook.id).toBeTruthy();
  });

  it("400s an empty / whitespace name", async () => {
    const me = await mintBearer();
    expect((await createCookbook(me.token, "")).status).toBe(400);
    expect((await createCookbook(me.token, "   ")).status).toBe(400);
  });

  it("409s a duplicate name for the same user, but allows the same name for a different user", async () => {
    const a = await mintBearer();
    const b = await mintBearer();
    expect((await createCookbook(a.token, "Mains")).status).toBe(201);
    const dup = await createCookbook(a.token, "Mains");
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("COOKBOOK_EXISTS");
    expect((await createCookbook(b.token, "Mains")).status).toBe(201); // different owner, fine
  });
});

describe("GET /v1/cookbooks", () => {
  it("lists the caller cookbooks with counts and a cover, newest first; empty for a new user", async () => {
    const me = await mintBearer();
    expect((await (await listCookbooks(me.token)).json()).cookbooks).toEqual([]);

    const cbId = (await (await createCookbook(me.token, "Dinners")).json()).cookbook.id;
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, me.userId);
    await setMembership(me.token, recipeId, [cbId]);

    const list = (await (await listCookbooks(me.token)).json()).cookbooks;
    expect(list).toEqual([
      { id: cbId, name: "Dinners", recipe_count: 1, cover_image_url: "https://img.example/chicken.jpg", system: false },
    ]);
  });
});

describe("GET /v1/cookbooks/:id", () => {
  it("returns the cookbook and its recipe cards; 404s another user cookbook", async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const cbId = (await (await createCookbook(me.token, "Mains")).json()).cookbook.id;
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, me.userId);
    await setMembership(me.token, recipeId, [cbId]);

    const res = await app.request(`/v1/cookbooks/${cbId}`, { headers: auth(me.token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cookbook: { id: cbId, name: "Mains" },
      recipes: [{ id: recipeId, title: "Maple Soy Chicken", image_url: "https://img.example/chicken.jpg" }],
    });

    expect((await app.request(`/v1/cookbooks/${cbId}`, { headers: auth(other.token) })).status).toBe(404);
  });
});

describe("PUT /v1/recipes/:id/cookbooks", () => {
  it("files the recipe into the cookbook and ignores ids the caller does not own; 404s an unknown recipe", async () => {
    const me = await mintBearer();
    const other = await mintBearer();
    const mine = (await (await createCookbook(me.token, "Mine")).json()).cookbook.id;
    const theirs = (await (await createCookbook(other.token, "Theirs")).json()).cookbook.id;
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, me.userId);

    const res = await setMembership(me.token, recipeId, [mine, theirs]);
    expect(res.status).toBe(200);
    expect((await res.json()).cookbook_ids).toEqual([mine]); // theirs ignored

    // Unknown recipe id → 404.
    const unknown = await setMembership(me.token, "00000000-0000-0000-0000-000000000000", [mine]);
    expect(unknown.status).toBe(404);
  });
});

describe("CookbookRepository system cookbooks (WI-RANK-4)", () => {
  it("ensureSystemCookbook creates once and reuses; addRecipe is idempotent", async () => {
    const me = await mintBearer();
    const repo = CookbookRepository.create(db);
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, me.userId);

    const first = await repo.ensureSystemCookbook(me.userId, "liked", "Liked");
    const second = await repo.ensureSystemCookbook(me.userId, "liked", "Liked");
    expect(second).toBe(first); // reused, not duplicated
    const liked = await db.select().from(cookbooks).where(eq(cookbooks.systemSlug, "liked"));
    expect(liked).toHaveLength(1);

    await repo.addRecipe(me.userId, first, recipeId);
    await repo.addRecipe(me.userId, first, recipeId); // idempotent
    const members = await db.select().from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, first));
    expect(members).toHaveLength(1);
  });
});
