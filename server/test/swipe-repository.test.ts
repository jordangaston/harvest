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

describe("SwipeRepository (WI-RANK-4)", () => {
  it("upsert overwrites the row on a re-swipe", async () => {
    const userId = await makeUser();
    const recipeId = await makeRecipe(userId);
    const repo = SwipeRepository.create(db);

    await repo.upsert(userId, { recipeId, direction: "dislike", reason: "too_slow", score: 40 });
    const second = await repo.upsert(userId, { recipeId, direction: "like", score: 80 });

    expect(second.direction).toBe("like");
    expect(second.reason).toBeNull();
    expect(second.score).toBe(80);
    const rows = await db.select().from(recipeSwipes).where(eq(recipeSwipes.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("like");
  });

  it("excludes likes/saves-ever and within-cooldown swipes, resurfaces older dislikes", async () => {
    const userId = await makeUser();
    const [liked, saved, recentDislike, oldDislike] = await Promise.all([makeRecipe(userId), makeRecipe(userId), makeRecipe(userId), makeRecipe(userId)]);
    const repo = SwipeRepository.create(db);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    await repo.upsert(userId, { recipeId: liked, direction: "like", score: 90 });
    await repo.upsert(userId, { recipeId: saved, direction: "save", score: 85 });
    await repo.upsert(userId, { recipeId: recentDislike, direction: "dislike", reason: "too_hard", score: 20 });
    await repo.upsert(userId, { recipeId: oldDislike, direction: "dislike", reason: "too_hard", score: 20 });
    // Backdate the old dislike AND the save past the cooldown cutoff — likes/saves are permanent.
    const stale = new Date(cutoff.getTime() - 60_000);
    await db.update(recipeSwipes).set({ createdAt: stale }).where(eq(recipeSwipes.recipeId, oldDislike));
    await db.update(recipeSwipes).set({ createdAt: stale }).where(eq(recipeSwipes.recipeId, saved));

    const excluded = await repo.excludedRecipeIds(userId, cutoff);
    expect(excluded.has(liked)).toBe(true); // permanent
    expect(excluded.has(saved)).toBe(true); // permanent (save, even past cooldown)
    expect(excluded.has(recentDislike)).toBe(true); // within cooldown
    expect(excluded.has(oldDislike)).toBe(false); // resurfaced
  });

  it("delete removes the row and returns it; null when there was none", async () => {
    const userId = await makeUser();
    const recipeId = await makeRecipe(userId);
    const repo = SwipeRepository.create(db);

    await repo.upsert(userId, { recipeId, direction: "like", score: 90 });
    const removed = await repo.delete(userId, recipeId);
    expect(removed?.direction).toBe("like");
    expect(await db.select().from(recipeSwipes).where(eq(recipeSwipes.userId, userId))).toHaveLength(0);

    // Idempotent: deleting again returns null, no throw.
    expect(await repo.delete(userId, recipeId)).toBeNull();
  });
});
