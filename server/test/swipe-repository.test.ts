import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { SwipeRepository } from "../src/repositories/swipe-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { recipes, recipeSwipes } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/** WI-RANK-4: the swipe capture repository. Offline, migrated `file:` libSQL db. */
let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => cleanup());

async function makeUser(): Promise<string> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const user = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  return user.id;
}

async function makeRecipe(userId: string): Promise<string> {
  const [row] = await db.insert(recipes).values({ userId, title: "R", sourceType: "instagram" }).returning({ id: recipes.id });
  return row.id;
}

const WEIGHTS = { cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 1 };

describe("SwipeRepository (WI-RANK-4)", () => {
  it("upsert overwrites the row on a re-swipe", async () => {
    const userId = await makeUser();
    const recipeId = await makeRecipe(userId);
    const repo = SwipeRepository.create(db);

    await repo.upsert(userId, { recipeId, direction: "dislike", reason: "too_slow", score: 40, weights: WEIGHTS });
    const second = await repo.upsert(userId, { recipeId, direction: "like", score: 80, weights: WEIGHTS });

    expect(second.direction).toBe("like");
    expect(second.reason).toBeNull();
    expect(second.score).toBe(80);
    const rows = await db.select().from(recipeSwipes).where(eq(recipeSwipes.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("like");
  });

  it("excludes likes-ever and within-cooldown swipes, resurfaces older dislikes", async () => {
    const userId = await makeUser();
    const [liked, recentDislike, oldDislike] = await Promise.all([makeRecipe(userId), makeRecipe(userId), makeRecipe(userId)]);
    const repo = SwipeRepository.create(db);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    await repo.upsert(userId, { recipeId: liked, direction: "like", score: 90, weights: WEIGHTS });
    await repo.upsert(userId, { recipeId: recentDislike, direction: "dislike", reason: "too_hard", score: 20, weights: WEIGHTS });
    await repo.upsert(userId, { recipeId: oldDislike, direction: "dislike", reason: "too_hard", score: 20, weights: WEIGHTS });
    // Backdate the old dislike before the cooldown cutoff.
    await db
      .update(recipeSwipes)
      .set({ createdAt: new Date(cutoff.getTime() - 60_000) })
      .where(eq(recipeSwipes.recipeId, oldDislike));

    const excluded = await repo.excludedRecipeIds(userId, cutoff);
    expect(excluded.has(liked)).toBe(true); // permanent
    expect(excluded.has(recentDislike)).toBe(true); // within cooldown
    expect(excluded.has(oldDislike)).toBe(false); // resurfaced
  });
});
