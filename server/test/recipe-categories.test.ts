import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { recipeCategories } from "../src/schema.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * WI-TS-1: `recipe_categories` persistence + read + API shape. Offline, against a
 * migrated `file:` libSQL db (no network), mirroring test/recipe.test.ts.
 */
const BASE: RecipeInput = {
  title: "Shrimp Scampi",
  sourceType: "website",
  servings: 4,
  servingsEstimated: false,
  ingredients: [{ name: "shrimp", amount: null, unit: null, quantityText: "shrimp" }],
  steps: ["Cook"],
  nutrition: null,
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

async function mintUser(): Promise<{ token: string; userId: string }> {
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

describe("recipe_categories persistence (WI-TS-1)", () => {
  it("round-trips categories through persist and findById", async () => {
    const { userId } = await mintUser();
    const repo = RecipeRepository.create(db);
    const id = await repo.persist(
      { ...BASE, categories: { cuisine: ["italian"], dishType: ["pasta"], primaryIngredient: ["seafood"] } },
      userId,
    );

    const detail = await repo.findById(id);
    expect(detail!.categories).toEqual({ cuisine: ["italian"], dishType: ["pasta"], primaryIngredient: ["seafood"] });
  });

  it("reads a facet's values ordered deterministically", async () => {
    const { userId } = await mintUser();
    const repo = RecipeRepository.create(db);
    const id = await repo.persist(
      { ...BASE, categories: { cuisine: [], dishType: [], primaryIngredient: ["seafood", "poultry"] } },
      userId,
    );

    // Ordered by (facet, value) → poultry before seafood, regardless of input order.
    expect((await repo.findById(id))!.categories.primaryIngredient).toEqual(["poultry", "seafood"]);
  });

  it("writes zero rows when categories are absent or all-empty", async () => {
    const { userId } = await mintUser();
    const repo = RecipeRepository.create(db);
    const absent = await repo.persist(BASE, userId);
    const empty = await repo.persist(
      { ...BASE, categories: { cuisine: [], dishType: [], primaryIngredient: [] } },
      userId,
    );

    expect((await db.select().from(recipeCategories)).length).toBe(0);
    const emptyCats = { cuisine: [], dishType: [], primaryIngredient: [] };
    expect((await repo.findById(absent))!.categories).toEqual(emptyCats);
    expect((await repo.findById(empty))!.categories).toEqual(emptyCats);
  });

  it("dedups rows via the composite PK, so a replay re-insert is a no-op", async () => {
    const { userId } = await mintUser();
    const repo = RecipeRepository.create(db);
    const id = await repo.persist(
      { ...BASE, categories: { cuisine: ["italian"], dishType: [], primaryIngredient: ["seafood"] } },
      userId,
    );

    // Re-inserting the same (recipe, facet, value) rows must not duplicate or throw.
    await db
      .insert(recipeCategories)
      .values([
        { recipeId: id, facet: "cuisine", value: "italian" },
        { recipeId: id, facet: "primary_ingredient", value: "seafood" },
      ])
      .onConflictDoNothing();

    expect((await db.select().from(recipeCategories).where(eq(recipeCategories.recipeId, id))).length).toBe(2);
  });

  it("cascades category rows when the recipe is deleted", async () => {
    const { userId } = await mintUser();
    const repo = RecipeRepository.create(db);
    const id = await repo.persist(
      { ...BASE, categories: { cuisine: ["italian"], dishType: [], primaryIngredient: [] } },
      userId,
    );
    expect((await db.select().from(recipeCategories).where(eq(recipeCategories.recipeId, id))).length).toBe(1);

    await repo.deleteOwned(userId, id);
    expect((await db.select().from(recipeCategories).where(eq(recipeCategories.recipeId, id))).length).toBe(0);
  });

  it("supports the reverse (facet, value) lookup ranking will use", async () => {
    const { userId } = await mintUser();
    const repo = RecipeRepository.create(db);
    const seafood = await repo.persist(
      { ...BASE, title: "Scampi", categories: { cuisine: [], dishType: [], primaryIngredient: ["seafood"] } },
      userId,
    );
    await repo.persist(
      { ...BASE, title: "Roast Chicken", categories: { cuisine: [], dishType: [], primaryIngredient: ["poultry"] } },
      userId,
    );

    const hits = await db
      .select({ recipeId: recipeCategories.recipeId })
      .from(recipeCategories)
      .where(and(eq(recipeCategories.facet, "primary_ingredient"), eq(recipeCategories.value, "seafood")));

    expect(hits).toEqual([{ recipeId: seafood }]);
  });

  it("surfaces categories on GET /v1/recipes/:id", async () => {
    const { token, userId } = await mintUser();
    const id = await RecipeRepository.create(db).persist(
      { ...BASE, categories: { cuisine: ["italian"], dishType: ["pasta"], primaryIngredient: ["seafood"] } },
      userId,
    );

    const res = await app.request(`/v1/recipes/${id}`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).recipe.categories).toEqual({
      cuisine: ["italian"],
      dish_type: ["pasta"],
      primary_ingredient: ["seafood"],
    });
  });
});
