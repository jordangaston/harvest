import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { PreferenceRepository } from "../src/repositories/preference-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { userPreferences, userFoodPrefs } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import type { NewUser } from "../src/schema.js";

/** WI-RANK-4: the first write-path into user_preferences (cold-start materialization). */
let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => cleanup());

async function makeUser(extra: Partial<NewUser> = {}): Promise<string> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const user = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, ...extra });
  return user.id;
}

async function weightRow(userId: string) {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return row;
}

describe("PreferenceRepository write-path (WI-RANK-4)", () => {
  it("bumpWeight materializes cold-start defaults then +1 on a cold-start user", async () => {
    const userId = await makeUser({ goals: ["eat_healthier"] }); // nutrition cold-starts at 3
    const repo = PreferenceRepository.create(db);

    await repo.bumpWeight(userId, "cost");

    const row = await weightRow(userId);
    expect(row.weightCost).toBe(2); // cold-start 1 → 2
    expect(row.weightNutrition).toBe(3); // goal-derived default preserved
    expect(row.weightDifficulty).toBe(1);
  });

  it("bumpWeight caps at 3", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);

    await repo.bumpWeight(userId, "cost"); // 1→2
    await repo.bumpWeight(userId, "cost"); // 2→3
    await repo.bumpWeight(userId, "cost"); // capped

    expect((await weightRow(userId)).weightCost).toBe(3);
  });

  it("addDislike inserts a dislike and flips an existing like", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);
    await db.insert(userFoodPrefs).values({ userId, facet: "primary_ingredient", value: "liver", sentiment: "like" });

    await repo.addDislike(userId, "primary_ingredient", "liver"); // flip
    await repo.addDislike(userId, "cuisine", "thai"); // insert

    const rows = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId));
    expect(rows).toContainEqual({ userId, facet: "primary_ingredient", value: "liver", sentiment: "dislike", target: null, reason: null });
    expect(rows).toContainEqual({ userId, facet: "cuisine", value: "thai", sentiment: "dislike", target: null, reason: null });
  });

  it("savePreferences removes an un-selected like but keeps a dislike-loop primary_ingredient dislike", async () => {
    const repo = PreferenceRepository.create(db);
    const base = {
      skillLevel: "beginner" as const, weeklyBudgetCents: null, timeBudgetMinutes: null, timeByMeal: null,
      weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 },
      allergens: [], diets: [], ownedEquipment: [], groceryStores: [],
      household: { adults: 2, kids: 0 }, eatsLeftovers: true,
    };
    const userId = await makeUser();

    // Two liked cuisines via settings, plus a dislike written by the swipe loop (primary_ingredient).
    await repo.savePreferences(userId, {
      ...base,
      foodPrefs: [
        { facet: "cuisine", value: "thai", sentiment: "like" },
        { facet: "cuisine", value: "italian", sentiment: "like" },
      ],
    });
    await repo.addDislike(userId, "primary_ingredient", "liver");

    // Re-save with `italian` un-selected — the picker resends only what remains.
    const saved = await repo.savePreferences(userId, {
      ...base,
      foodPrefs: [{ facet: "cuisine", value: "thai", sentiment: "like" }],
    });

    const cuisines = saved.foodPrefs.filter((f) => f.facet === "cuisine").map((f) => f.value);
    expect(cuisines).toContain("thai");
    expect(cuisines).not.toContain("italian"); // un-selecting a like removes it (no lingering row)
    // the loop-authored dislike survives the settings write
    expect(saved.foodPrefs).toContainEqual({ facet: "primary_ingredient", value: "liver", sentiment: "dislike", target: null, reason: null });
  });

  it("Test Case 4: round-trips both axes + reason, a pure-intent row, and rejects a neither-axis element", async () => {
    const repo = PreferenceRepository.create(db);
    const base = {
      skillLevel: "advanced" as const, weeklyBudgetCents: null, timeBudgetMinutes: null, timeByMeal: null,
      weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 },
      allergens: [], diets: [], ownedEquipment: [], groceryStores: [],
      household: { adults: 2, kids: 0 }, eatsLeftovers: true,
    };

    // Both axes + reason (the steak case).
    const u1 = await makeUser();
    const saved1 = await repo.savePreferences(u1, {
      ...base,
      foodPrefs: [{ facet: "food_category", value: "red_meat", sentiment: "like", target: -0.6, reason: "heart health" }],
    });
    expect(saved1.foodPrefs).toContainEqual({ facet: "food_category", value: "red_meat", sentiment: "like", target: -0.6, reason: "heart health" });

    // Pure intent — no sentiment.
    const u2 = await makeUser();
    const saved2 = await repo.savePreferences(u2, {
      ...base,
      foodPrefs: [{ facet: "food_category", value: "red_meat", target: -0.9 }],
    });
    expect(saved2.foodPrefs).toContainEqual({ facet: "food_category", value: "red_meat", sentiment: null, target: -0.9, reason: null });

    // Neither axis → rejected at the repo boundary.
    const u3 = await makeUser();
    await expect(
      repo.savePreferences(u3, { ...base, foodPrefs: [{ facet: "food_category", value: "red_meat" }] }),
    ).rejects.toThrow();
  });
});
