import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { ingredients as ingredientsTable, fdcFoods, tasteIngredients } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { seedFdcFixture, seedOkraFood, OKRA_FDC_ID } from "./fixtures/fdc-foods.fixture.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { NutritionEstimator } from "../src/nutrition/nutrition-estimator.js";
import { toRecipeInput } from "../src/parse/mapping.js";
import { AffinityScorer } from "../src/ranking/scorers.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";
import type { UserPreferences } from "../src/models/user-preferences.js";

/**
 * F-CL-1 + F-AF-1, end to end offline: import a recipe with an okra ingredient, confirm the
 * nutrition step's match is persisted onto `ingredients.fdc_id`, then confirm an okra `dislike`
 * penalizes the recipe's ingredient affinity (via the base_ingredient_id roll-up). No network.
 */
let db: Database;
let cleanup: () => void;

const OKRA_BASE_ID = "ti-okra";

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
  await seedOkraFood(db);
  // The curated base ingredient okra rolls up to, and its stamp on the okra food.
  await db.insert(tasteIngredients).values({ id: OKRA_BASE_ID, label: "Okra", section: "Vegetables", foodGroup: 7 });
  await db.update(fdcFoods).set({ baseIngredientId: OKRA_BASE_ID }).where(eq(fdcFoods.fdcId, OKRA_FDC_ID));
});
afterEach(() => cleanup());

const BASE: ExtractedRecipeData = {
  title: "Okra & Spinach Skillet",
  servings: "2",
  confidence: 1,
  ingredients: [
    { name: "okra", amount: "160", unit: "gram", quantityText: "160g okra" },
    { name: "spinach", amount: "50", unit: "gram", quantityText: "50g spinach" },
  ],
  steps: ["Cook."],
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  jobId: "",
  userId: "",
  sourceType: "website",
  sourceRef: "https://x.test/okra",
  ...over,
});

function prefs(foodPrefs: UserPreferences["foodPrefs"]): UserPreferences {
  return {
    userId: "u1",
    skillLevel: "intermediate",
    budgetCentsPerServing: null,
    weeklyBudgetCents: null,
    timeBudgetMinutes: null,
    timeByMeal: null,
    weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 },
    weights: { cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 0 },
    allergens: [],
    diets: [],
    foodPrefs,
    ownedEquipment: [],
    equipmentReviewed: false,
    groceryStores: [],
    household: { adults: 2, kids: 0 },
    eatsLeftovers: true,
  };
}

/** Persists BASE as an owned recipe, reusing the nutrition step's ingredient matches. */
async function persistOkraRecipe(): Promise<{ userId: string; recipeId: string }> {
  const user = await UserRepository.create(db).insert({ phone: "+15555550001", jwtPrivateKey: "k", jwtPublicKey: "p" });
  const estimate = await NutritionEstimator.create(db).run(BASE.ingredients, 2);
  const data = { ...BASE, estimate };
  const recipeId = await RecipeRepository.create(db).persist(toRecipeInput(data, input()), user.id);
  return { userId: user.id, recipeId };
}

describe("classify → persist match → ingredient affinity (offline)", () => {
  it("persists the ingredient→FDC match onto ingredients.fdc_id at import", async () => {
    const { recipeId } = await persistOkraRecipe();
    const rows = await db
      .select({ name: ingredientsTable.name, fdcId: ingredientsTable.fdcId, quality: ingredientsTable.matchQuality })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.recipeId, recipeId));
    const okra = rows.find((r) => r.name === "okra");
    expect(okra?.fdcId).toBe(OKRA_FDC_ID);
    expect(okra?.quality).not.toBeNull();
  });

  it("rolls fdc_id up to base_ingredient_id on the RankableRecipe", async () => {
    const { userId, recipeId } = await persistOkraRecipe();
    const rankable = await RecipeRepository.create(db).getRankable(userId, recipeId);
    expect(rankable?.baseIngredientIds).toContain(OKRA_BASE_ID);
  });

  it("penalizes the recipe when okra is disliked, rewards it when liked", async () => {
    const { userId, recipeId } = await persistOkraRecipe();
    const rankable = (await RecipeRepository.create(db).getRankable(userId, recipeId))!;
    const aff = new AffinityScorer();
    // Only the ingredient facet is present (no cuisine/dish tags), so it drives the whole score.
    expect(aff.score(rankable, prefs([{ facet: "ingredient", value: OKRA_BASE_ID, sentiment: "dislike", target: null, reason: null }]))).toBe(0);
    expect(aff.score(rankable, prefs([{ facet: "ingredient", value: OKRA_BASE_ID, sentiment: "like", target: null, reason: null }]))).toBe(1);
    // A stale/unknown base id matches nothing → fails safe (neutral).
    expect(aff.score(rankable, prefs([{ facet: "ingredient", value: "gone-uuid", sentiment: "dislike", target: null, reason: null }]))).toBe(0.5);
  });
});
