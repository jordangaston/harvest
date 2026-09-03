import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { PreferenceRepository } from "../src/repositories/preference-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { userFoodPrefs } from "../src/schema.js";
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

describe("PreferenceRepository write-path (WI-RANK-4)", () => {
  it("addDislike inserts a dislike and flips an existing like", async () => {
    const userId = await makeUser();
    const repo = PreferenceRepository.create(db);
    await db.insert(userFoodPrefs).values({ userId, dimension: "primary_ingredient", value: "liver", direction: "more" });

    await repo.addDislike(userId, "primary_ingredient", "liver"); // flip
    await repo.addDislike(userId, "cuisine", "thai"); // insert

    const rows = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId));
    expect(rows).toContainEqual({ userId, dimension: "primary_ingredient", value: "liver", scope: "recipe", direction: "less", strength: "soft", target: null, unit: null, reason: null });
    expect(rows).toContainEqual({ userId, dimension: "cuisine", value: "thai", scope: "recipe", direction: "less", strength: "soft", target: null, unit: null, reason: null });
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
        { dimension: "cuisine", value: "thai", scope: "recipe", direction: "more", strength: "soft" },
        { dimension: "cuisine", value: "italian", scope: "recipe", direction: "more", strength: "soft" },
      ],
    });
    await repo.addDislike(userId, "primary_ingredient", "liver");

    // Re-save with `italian` un-selected — the picker resends only what remains.
    const saved = await repo.savePreferences(userId, {
      ...base,
      foodPrefs: [{ dimension: "cuisine", value: "thai", scope: "recipe", direction: "more", strength: "soft" }],
    });

    const cuisines = saved.foodPrefs.filter((f) => f.dimension === "cuisine").map((f) => f.value);
    expect(cuisines).toContain("thai");
    expect(cuisines).not.toContain("italian"); // un-selecting a like removes it (no lingering row)
    // the loop-authored dislike survives the settings write
    expect(saved.foodPrefs).toContainEqual({ dimension: "primary_ingredient", value: "liver", scope: "recipe", direction: "less", strength: "soft", target: null, unit: null, reason: null });
  });

  it("Test Case 4: round-trips a directive with target + reason and a bare directive", async () => {
    const repo = PreferenceRepository.create(db);
    const base = {
      skillLevel: "advanced" as const, weeklyBudgetCents: null, timeBudgetMinutes: null, timeByMeal: null,
      weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 },
      allergens: [], diets: [], ownedEquipment: [], groceryStores: [],
      household: { adults: 2, kids: 0 }, eatsLeftovers: true,
    };

    // A moderation directive carrying a target + reason.
    const u1 = await makeUser();
    const saved1 = await repo.savePreferences(u1, {
      ...base,
      foodPrefs: [{ dimension: "food_category", value: "red_meat", scope: "recipe", direction: "less", strength: "firm", target: -0.6, reason: "heart health" }],
    });
    expect(saved1.foodPrefs).toContainEqual({ dimension: "food_category", value: "red_meat", scope: "recipe", direction: "less", strength: "firm", target: -0.6, unit: null, reason: "heart health" });

    // A bare directive — just a direction, defaulting scope/strength.
    const u2 = await makeUser();
    const saved2 = await repo.savePreferences(u2, {
      ...base,
      foodPrefs: [{ dimension: "food_category", value: "red_meat", scope: "recipe", direction: "less", strength: "soft" }],
    });
    expect(saved2.foodPrefs).toContainEqual({ dimension: "food_category", value: "red_meat", scope: "recipe", direction: "less", strength: "soft", target: null, unit: null, reason: null });
  });
});
