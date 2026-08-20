import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { PreferenceRepository } from "../src/repositories/preference-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { users, userPreferences, userAllergens, userDiets, userFoodPrefs } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import type { NewUser } from "../src/schema.js";

/**
 * WI-RANK-1: the preference schema, model, and read repository. Offline, against a
 * migrated `file:` libSQL db (no network), mirroring test/recipe-categories.test.ts.
 */
let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => cleanup());

/** Seed a user with a real ES256 keypair and optional onboarding columns. */
async function makeUser(extra: Partial<NewUser> = {}): Promise<string> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const user = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, ...extra });
  return user.id;
}

describe("PreferenceRepository (WI-RANK-1)", () => {
  it("accepts valid rows, enforces the pk, and cascades on user delete", async () => {
    const userId = await makeUser();
    await db.insert(userPreferences).values({ userId, budgetCentsPerServing: 400, timeBudgetMinutes: 30 });
    await db.insert(userAllergens).values([
      { userId, allergen: "peanut", severity: "severe" },
      { userId, allergen: "milk", severity: "moderate" },
    ]);
    await db.insert(userDiets).values({ userId, dietId: "vegan", strictness: "strict" });
    await db.insert(userFoodPrefs).values([
      { userId, facet: "cuisine", value: "italian", sentiment: "like" },
      { userId, facet: "primary_ingredient", value: "liver", sentiment: "dislike" },
    ]);

    // Duplicate (user_id, allergen) violates the composite pk.
    await expect(db.insert(userAllergens).values({ userId, allergen: "peanut", severity: "mild" })).rejects.toThrow();

    // Deleting the user cascades to every child table.
    await db.delete(users).where(eq(users.id, userId));
    expect((await db.select().from(userPreferences).where(eq(userPreferences.userId, userId))).length).toBe(0);
    expect((await db.select().from(userAllergens).where(eq(userAllergens.userId, userId))).length).toBe(0);
    expect((await db.select().from(userDiets).where(eq(userDiets.userId, userId))).length).toBe(0);
    expect((await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId))).length).toBe(0);
  });

  it("folds stored rows into the resolved model", async () => {
    const userId = await makeUser();
    await db.insert(userPreferences).values({
      userId,
      skillLevel: "intermediate",
      budgetCentsPerServing: 400,
      timeBudgetMinutes: 30,
      weightCost: 3,
      weightNutrition: 3,
    });
    await db.insert(userAllergens).values({ userId, allergen: "peanut", severity: "severe" });
    await db.insert(userFoodPrefs).values({ userId, facet: "cuisine", value: "italian", sentiment: "like" });

    const prefs = await PreferenceRepository.create(db).getPreferences(userId);

    expect(prefs.weights.cost).toBe(3);
    expect(prefs.weights.nutrition).toBe(3);
    expect(prefs.weights.popularity).toBe(0);
    expect(prefs.budgetCentsPerServing).toBe(400);
    expect(prefs.skillLevel).toBe("intermediate");
    expect(prefs.allergens).toContainEqual({ allergen: "peanut", severity: "severe" });
    expect(prefs.foodPrefs).toContainEqual({ facet: "cuisine", value: "italian", sentiment: "like" });
  });

  it("cold-starts from goals when no preferences row exists", async () => {
    const userId = await makeUser({ goals: ["save_money"] });

    const prefs = await PreferenceRepository.create(db).getPreferences(userId);

    expect(prefs.weights).toEqual({ cost: 3, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 1 });
    expect(prefs.skillLevel).toBe("beginner");
    expect(prefs.budgetCentsPerServing).toBeNull();
    expect(prefs.allergens).toEqual([]);
    expect(prefs.diets).toEqual([]);
    expect(prefs.foodPrefs).toEqual([]);
  });

  it("cold-starts to a uniform baseline with no goals", async () => {
    const userId = await makeUser({ goals: null });

    const prefs = await PreferenceRepository.create(db).getPreferences(userId);

    expect(prefs.weights).toEqual({ cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 1 });
    expect(prefs.allergens).toEqual([]);
    expect(prefs.diets).toEqual([]);
    expect(prefs.foodPrefs).toEqual([]);
  });

  it("cold-starts weight_meal_prep to 3 from the meal_prepping goal", async () => {
    const userId = await makeUser({ goals: ["meal_prepping"] });

    const prefs = await PreferenceRepository.create(db).getPreferences(userId);

    expect(prefs.weights.mealPrep).toBe(3);
    // Only the meal-prep weight is bumped; every other weight stays at its baseline.
    expect(prefs.weights).toEqual({ cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 3 });
  });

  it("rejects an out-of-range stored weight at the boundary", async () => {
    const userId = await makeUser();
    await db.insert(userPreferences).values({ userId, weightCost: 5 });

    await expect(PreferenceRepository.create(db).getPreferences(userId)).rejects.toThrow();
  });

  it("savePreferences upserts the editable subset, preserves weights, and replaces only its food-pref slices", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);
    // Pre-existing server-owned state the settings save must NOT clobber: a dislike-tuned weight,
    // a cuisine *dislike*, and a dish-type pref on other facets.
    await repo.bumpWeight(userId, "cost");
    await db.insert(userFoodPrefs).values([
      { userId, facet: "cuisine", value: "thai", sentiment: "dislike" },
      { userId, facet: "dish_type", value: "soup", sentiment: "like" },
    ]);

    const saved = await repo.savePreferences(userId, {
      skillLevel: "advanced",
      weeklyBudgetCents: 12000,
      timeBudgetMinutes: 45,
      weeklyMeals: { breakfast: 3, lunch: 0, dinner: 5, snack: 2, kids: 0 },
      likedCuisines: ["italian", "mexican"],
      dislikedIngredients: ["liver"],
      allergens: [{ allergen: "peanut", severity: "severe" }],
      diets: [{ dietId: "pescatarian", strictness: "flexible" }],
      ownedEquipment: ["blender", "slow_cooker"],
    });

    // Editable subset round-trips.
    expect(saved.skillLevel).toBe("advanced");
    expect(saved.weeklyBudgetCents).toBe(12000);
    expect(saved.weeklyMeals).toEqual({ breakfast: 3, lunch: 0, dinner: 5, snack: 2, kids: 0 });
    expect(saved.allergens).toContainEqual({ allergen: "peanut", severity: "severe" });
    expect(saved.diets).toContainEqual({ dietId: "pescatarian", strictness: "flexible" });
    expect(saved.ownedEquipment.sort()).toEqual(["blender", "slow_cooker"]);
    expect(saved.equipmentReviewed).toBe(true); // implicit — they managed their kitchen

    // Weights (dislike-tuned) survive the save.
    expect(saved.weights.cost).toBe(2);

    // The cuisine/like + primary_ingredient/dislike slices are replaced…
    expect(saved.foodPrefs).toContainEqual({ facet: "cuisine", value: "italian", sentiment: "like" });
    expect(saved.foodPrefs).toContainEqual({ facet: "primary_ingredient", value: "liver", sentiment: "dislike" });
    // …but other facets/sentiments are preserved.
    expect(saved.foodPrefs).toContainEqual({ facet: "cuisine", value: "thai", sentiment: "dislike" });
    expect(saved.foodPrefs).toContainEqual({ facet: "dish_type", value: "soup", sentiment: "like" });
  });
});
