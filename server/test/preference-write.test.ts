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
    expect(rows).toContainEqual({ userId, facet: "primary_ingredient", value: "liver", sentiment: "dislike" });
    expect(rows).toContainEqual({ userId, facet: "cuisine", value: "thai", sentiment: "dislike" });
  });
});
