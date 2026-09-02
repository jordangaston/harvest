import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { seedFdcFixture } from "./fixtures/fdc-foods.fixture.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { recipeCategories } from "../src/schema.js";
import { backfillFoodCategory } from "../src/diet/backfill-food-category.js";

/**
 * Food-moderation Test Case 3 (AC 2): the one-off backfill re-classifies existing recipes and
 * writes their food_category rows, logs counts, and is idempotent. Offline against a migrated
 * `file:` libSQL db (real DietClassifier over the FDC fixture, no network).
 */
let db: Database;
let cleanup: () => void;

const base = (title: string, names: string[]): RecipeInput => ({
  title,
  sourceType: "website",
  servings: 2,
  servingsEstimated: false,
  ingredients: names.map((name) => ({ name, amount: null, unit: null, quantityText: name })),
  steps: ["Cook"],
  nutrition: null,
  allergens: null,
  // Deliberately NO categories → simulates a pre-feature recipe with no food_category rows.
});

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
});
afterEach(() => cleanup());

describe("backfillFoodCategory (Test Case 3, AC 2)", () => {
  it("tags pre-existing red-meat recipes, is idempotent, and reports counts", async () => {
    const repo = RecipeRepository.create(db);
    const user = await UserRepository.create(db).insert({ phone: "+15555550001", jwtPrivateKey: "k", jwtPublicKey: "p" });
    const beef1 = await repo.persist(base("Beef Chili", ["ground beef", "onion"]), user.id);
    const beef2 = await repo.persist(base("Steak Salad", ["steak", "spinach"]), user.id);
    const veg = await repo.persist(base("Garden Bowl", ["spinach", "rice"]), user.id);

    // No food_category rows before the backfill.
    expect((await db.select().from(recipeCategories).where(eq(recipeCategories.facet, "food_category"))).length).toBe(0);

    const first = await backfillFoodCategory(db);
    expect(first.recipes).toBe(3); // classified all three (all had a food class)
    expect(first.rowsWritten).toBeGreaterThanOrEqual(2);

    const redMeatRows = async (id: string) =>
      db.select().from(recipeCategories).where(and(eq(recipeCategories.recipeId, id), eq(recipeCategories.facet, "food_category"), eq(recipeCategories.value, "red_meat")));
    expect((await redMeatRows(beef1)).length).toBe(1);
    expect((await redMeatRows(beef2)).length).toBe(1);
    expect((await redMeatRows(veg)).length).toBe(0);

    // Idempotent: a second run writes no new rows.
    const second = await backfillFoodCategory(db);
    expect(second.rowsWritten).toBe(0);
    expect((await redMeatRows(beef1)).length).toBe(1);
  });
});
