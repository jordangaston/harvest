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
    expect(prefs.foodPrefs).toContainEqual({ facet: "cuisine", value: "italian", sentiment: "like", target: null, reason: null });
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

  /** The non-food-pref fields of a save (defaults for the fields a case doesn't exercise). */
  const baseSave = {
    skillLevel: "advanced" as const,
    weeklyBudgetCents: 12000,
    timeBudgetMinutes: 45,
    timeByMeal: null,
    weeklyMeals: { breakfast: 3, lunch: 0, dinner: 5, snack: 2, kids: 0 },
    foodPrefs: [],
    allergens: [{ allergen: "peanut" as const, severity: "severe" as const }],
    diets: [{ dietId: "pescatarian", strictness: "flexible" as const }],
    ownedEquipment: ["blender" as const, "slow_cooker" as const],
    groceryStores: [],
    household: { adults: 2, kids: 0 },
    eatsLeftovers: true,
  };

  it("savePreferences upserts the editable subset, preserves weights, and upserts the unified food-prefs", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);
    // Pre-existing server-owned state the settings save must NOT clobber: a dislike-tuned weight,
    // and a dislike-loop dislike on a value the picker doesn't resend.
    await repo.bumpWeight(userId, "cost");
    await db.insert(userFoodPrefs).values({ userId, facet: "primary_ingredient", value: "cilantro", sentiment: "dislike" });

    const saved = await repo.savePreferences(userId, {
      ...baseSave,
      foodPrefs: [
        { facet: "cuisine", value: "italian", sentiment: "like" },
        { facet: "dish_type", value: "bowls", sentiment: "like" },
        { facet: "primary_ingredient", value: "liver", sentiment: "dislike" },
      ],
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

    // The unified food-prefs are persisted across all facets (each axis carried)…
    expect(saved.foodPrefs).toContainEqual({ facet: "cuisine", value: "italian", sentiment: "like", target: null, reason: null });
    expect(saved.foodPrefs).toContainEqual({ facet: "dish_type", value: "bowls", sentiment: "like", target: null, reason: null });
    expect(saved.foodPrefs).toContainEqual({ facet: "primary_ingredient", value: "liver", sentiment: "dislike", target: null, reason: null });
    // …and a dislike-loop dislike on an un-resent value survives (upsert, not wholesale replace).
    expect(saved.foodPrefs).toContainEqual({ facet: "primary_ingredient", value: "cilantro", sentiment: "dislike", target: null, reason: null });
  });

  it("upsertFoodPref adds/overwrites one row, leaving siblings and primary_ingredient untouched", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);
    // A sibling authorable row and a server-owned dislike-loop row that must both survive.
    await db.insert(userFoodPrefs).values([
      { userId, facet: "dish_type", value: "bowls", sentiment: "like" },
      { userId, facet: "primary_ingredient", value: "cilantro", sentiment: "dislike" },
    ]);

    // Add a new row.
    await repo.upsertFoodPref(userId, { facet: "food_category", value: "red_meat", target: -0.5, reason: "limiting" });
    // Overwrite that exact (facet,value) row — flips its axes, does not duplicate.
    await repo.upsertFoodPref(userId, { facet: "food_category", value: "red_meat", target: 0.5 });

    const rows = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId));
    const redMeat = rows.filter((r) => r.facet === "food_category" && r.value === "red_meat");
    expect(redMeat).toHaveLength(1);
    expect(redMeat[0]).toMatchObject({ target: 0.5, sentiment: null, reason: null });
    expect(rows).toContainEqual(expect.objectContaining({ facet: "dish_type", value: "bowls", sentiment: "like" }));
    expect(rows).toContainEqual(expect.objectContaining({ facet: "primary_ingredient", value: "cilantro", sentiment: "dislike" }));

    // The server-owned facet is rejected.
    await expect(repo.upsertFoodPref(userId, { facet: "primary_ingredient", value: "liver", sentiment: "dislike" })).rejects.toThrow();
  });

  it("persists time_by_meal and derives time_budget_minutes = max(...)", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);

    const saved = await repo.savePreferences(userId, {
      ...baseSave,
      timeBudgetMinutes: 999, // ignored: the derived max wins when time_by_meal is present
      timeByMeal: { breakfast: 15, lunch: 30, dinner: 60 },
    });
    expect(saved.timeByMeal).toEqual({ breakfast: 15, lunch: 30, dinner: 60 });
    expect(saved.timeBudgetMinutes).toBe(60);

    const reread = await repo.getPreferences(userId);
    expect(reread.timeByMeal).toEqual({ breakfast: 15, lunch: 30, dinner: 60 });
    expect(reread.timeBudgetMinutes).toBe(60);
  });

  it("persists and round-trips grocery stores, household, and eats-leftovers (Test Case 1)", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);

    const saved = await repo.savePreferences(userId, {
      ...baseSave,
      groceryStores: ["walmart", "kroger"],
      household: { adults: 2, kids: 3 },
      eatsLeftovers: true,
    });

    expect(saved.groceryStores).toEqual(["walmart", "kroger"]);
    expect(saved.household).toEqual({ adults: 2, kids: 3 });
    expect(saved.eatsLeftovers).toBe(true);

    const reread = await repo.getPreferences(userId);
    expect(reread.groceryStores).toEqual(["walmart", "kroger"]);
    expect(reread.household).toEqual({ adults: 2, kids: 3 });
  });

  it("cold-start getPreferences returns the documented household/leftovers defaults", async () => {
    const userId = await makeUser();
    const prefs = await PreferenceRepository.create(db).getPreferences(userId);
    expect(prefs.groceryStores).toEqual([]);
    expect(prefs.household).toEqual({ adults: 2, kids: 0 });
    expect(prefs.eatsLeftovers).toBe(true);
  });

  it("seeds mealPrep weight once on the eatsLeftovers false→true transition (Test Case 3)", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);
    // Establish leftovers=false at a mealPrep baseline below the cap.
    await repo.savePreferences(userId, { ...baseSave, eatsLeftovers: false });
    expect((await repo.getPreferences(userId)).weights.mealPrep).toBe(1);

    // false→true bumps once.
    await repo.savePreferences(userId, { ...baseSave, eatsLeftovers: true });
    expect((await repo.getPreferences(userId)).weights.mealPrep).toBe(2);

    // A second true save does not bump again.
    await repo.savePreferences(userId, { ...baseSave, eatsLeftovers: true });
    expect((await repo.getPreferences(userId)).weights.mealPrep).toBe(2);

    // A save back to false never lowers it.
    await repo.savePreferences(userId, { ...baseSave, eatsLeftovers: false });
    expect((await repo.getPreferences(userId)).weights.mealPrep).toBe(2);
  });
});
