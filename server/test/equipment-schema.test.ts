import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { PreferenceRepository } from "../src/repositories/preference-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { users, recipes, recipeSteps, recipeEquipment, userEquipment, userPreferences, EQUIPMENT_TYPES, type NewUser } from "../src/schema.js";
import { EQUIPMENT, defaultEssentiality } from "../src/equipment/equipment.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * WI-EQ-1: the equipment schema (recipe_equipment + user_equipment tables, the
 * recipe_steps.equipment / recipes.equipment_complete / user_preferences.equipment_reviewed
 * columns), the EQUIPMENT config module, and the PreferenceRepository fold-in. Offline,
 * against a migrated `file:` libSQL db, mirroring test/preference-repository.test.ts.
 */
let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => cleanup());

async function makeUser(extra: Partial<NewUser> = {}): Promise<string> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const user = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, ...extra });
  return user.id;
}

async function makeRecipe(): Promise<string> {
  const [row] = await db.insert(recipes).values({ title: "Test dish", sourceType: "website" }).returning();
  return row.id;
}

describe("equipment schema (WI-EQ-1)", () => {
  it("round-trips recipe/user equipment, enforces PKs, and cascades on delete", async () => {
    const userId = await makeUser();
    const recipeId = await makeRecipe();

    await db.insert(recipeSteps).values({ recipeId, position: 0, text: "Cook in the air fryer", equipment: ["air_fryer"] });
    await db.insert(recipeEquipment).values([
      { recipeId, equipment: "air_fryer", essentiality: "recommended" },
      { recipeId, equipment: "sous_vide", essentiality: "required" },
    ]);
    await db.update(recipes).set({ equipmentComplete: true }).where(eq(recipes.id, recipeId));
    await db.insert(userEquipment).values({ userId, equipment: "slow_cooker" });

    const [step] = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
    expect(step.equipment).toEqual(["air_fryer"]);

    // Composite PK (recipe_id, equipment) rejects a duplicate.
    await expect(
      db.insert(recipeEquipment).values({ recipeId, equipment: "air_fryer", essentiality: "required" }),
    ).rejects.toThrow();

    // Deleting the recipe cascades recipe_equipment; deleting the user cascades user_equipment.
    await db.delete(recipes).where(eq(recipes.id, recipeId));
    expect(await db.select().from(recipeEquipment).where(eq(recipeEquipment.recipeId, recipeId))).toHaveLength(0);
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(userEquipment).where(eq(userEquipment.userId, userId))).toHaveLength(0);
  });
});

describe("EQUIPMENT config (WI-EQ-1)", () => {
  it("covers the vocab exactly, with the design's essentiality priors", () => {
    const canonicals = EQUIPMENT.map((e) => e.canonical).sort();
    expect(canonicals).toEqual([...EQUIPMENT_TYPES].sort());
    expect(EQUIPMENT).toHaveLength(EQUIPMENT_TYPES.length);
    expect(defaultEssentiality("sous_vide")).toBe("required");
    expect(defaultEssentiality("smoker")).toBe("required");
    expect(defaultEssentiality("air_fryer")).toBe("recommended");
    for (const e of EQUIPMENT) {
      expect(e.aliases.length).toBeGreaterThan(0);
      expect(e.aliases.every((a) => a === a.toLowerCase())).toBe(true);
    }
  });
});

describe("PreferenceRepository equipment fold-in (WI-EQ-1)", () => {
  it("returns the owned set and the review gate for a stored user", async () => {
    const userId = await makeUser();
    await db.insert(userPreferences).values({ userId, equipmentReviewed: true });
    await db.insert(userEquipment).values([
      { userId, equipment: "slow_cooker" },
      { userId, equipment: "blender" },
    ]);

    const prefs = await PreferenceRepository.create(db).getPreferences(userId);
    expect([...prefs.ownedEquipment].sort()).toEqual(["blender", "slow_cooker"]);
    expect(prefs.equipmentReviewed).toBe(true);
  });

  it("cold-starts a user with no equipment and an unset review gate", async () => {
    const userId = await makeUser();
    const prefs = await PreferenceRepository.create(db).getPreferences(userId);
    expect(prefs.ownedEquipment).toEqual([]);
    expect(prefs.equipmentReviewed).toBe(false);
  });
});
