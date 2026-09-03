import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Client } from "@libsql/client";
import { type Database } from "../src/db.js";
import {
  users,
  threads,
  households,
  householdMembers,
  householdPreferences,
  objectives,
  tasks,
} from "../src/schema.js";
import { HouseholdSchema } from "../src/models/household.js";
import { HouseholdMemberSchema } from "../src/models/household-member.js";
import { HouseholdPreferencesSchema } from "../src/models/household-preferences.js";
import { ObjectiveSchema } from "../src/models/objective.js";
import { TaskSchema } from "../src/models/task.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

let client: Client;
let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ client, db, cleanup } = await migratedFileDb());
});

afterEach(() => {
  client.close();
  cleanup();
});

async function seedUser(name = "A"): Promise<string> {
  const [u] = await db.insert(users).values({ name, jwtPrivateKey: "k", jwtPublicKey: "p" }).returning();
  return u.id;
}

async function seedThread(ownerUserId: string): Promise<string> {
  const [t] = await db.insert(threads).values({ chatGuid: crypto.randomUUID(), ownerUserId }).returning();
  return t.id;
}

async function seedObjective(threadId: string): Promise<string> {
  const [o] = await db
    .insert(objectives)
    .values({ threadId, definition: "onboarding", status: "active", stackPosition: 1 })
    .returning();
  return o.id;
}

describe("increment-2 schema", () => {
  it("Test Case 1: migration creates the five tables and leaves increment-1 intact", async () => {
    const names = ["households", "household_members", "household_preferences", "objectives", "tasks", "threads", "thread_messages"];
    const res = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${names.map(() => "?").join(",")}) ORDER BY name`,
      names,
    );
    expect(res.rows.map((r) => r.name).sort()).toEqual([...names].sort());
  });

  it("Test Case 2: rejects a second active objective per thread, allows suspended", async () => {
    const userId = await seedUser();
    const threadId = await seedThread(userId);
    await seedObjective(threadId);

    await expect(
      db.insert(objectives).values({ threadId, definition: "reorder", status: "active", stackPosition: 2 }),
    ).rejects.toThrow();

    await expect(
      db.insert(objectives).values({ threadId, definition: "reorder", status: "suspended", stackPosition: 2 }),
    ).resolves.toBeDefined();
  });

  it("Test Case 3: task uniqueness on (objective, fact, member); NULL members coexist", async () => {
    const memberA = await seedUser("A");
    const memberB = await seedUser("B");
    const threadId = await seedThread(memberA);
    const objectiveId = await seedObjective(threadId);

    await db.insert(tasks).values({ objectiveId, kind: "elicit", fact: "member.allergens", scope: "member", memberUserId: memberA, required: true });
    await expect(
      db.insert(tasks).values({ objectiveId, kind: "elicit", fact: "member.allergens", scope: "member", memberUserId: memberA, required: true }),
    ).rejects.toThrow();

    // Same key, distinct member → coexists.
    await expect(
      db.insert(tasks).values({ objectiveId, kind: "elicit", fact: "member.allergens", scope: "member", memberUserId: memberB, required: true }),
    ).resolves.toBeDefined();

    // Two household-scoped tasks (member NULL) with the same fact coexist — SQLite treats NULL as distinct.
    await db.insert(tasks).values({ objectiveId, kind: "elicit", fact: "household.cook_days_count", scope: "household", required: true });
    await expect(
      db.insert(tasks).values({ objectiveId, kind: "elicit", fact: "household.cook_days_count", scope: "household", required: true }),
    ).resolves.toBeDefined();
  });

  it("Test Case 4: each table round-trips through its Zod model", async () => {
    const ownerId = await seedUser();
    const [h] = await db.insert(households).values({ name: "Casa", ownerUserId: ownerId }).returning();
    expect(HouseholdSchema.parse(h)).toEqual(h);

    const [m] = await db.insert(householdMembers).values({ householdId: h.id, userId: ownerId }).returning();
    expect(HouseholdMemberSchema.parse(m)).toEqual(m);

    const [p] = await db
      .insert(householdPreferences)
      .values({
        householdId: h.id,
        groceryStores: ["kroger", "aldi"],
        groceryShoppingDay: "sunday",
        weeklyBudgetCents: 12000,
        weeklyMeals: { breakfast: 7, lunch: 5, dinner: 7, snack: 0, kids: 0 },
        timeBreakfastMinutes: 15,
        timeLunchMinutes: 20,
        timeDinnerMinutes: 45,
        ownedEquipment: ["oven", "air_fryer"],
      })
      .returning();
    const { timeBreakfastMinutes, timeLunchMinutes, timeDinnerMinutes, ...rest } = p;
    const model = { ...rest, timeByMeal: { breakfast: 15, lunch: 20, dinner: 45 } };
    expect(HouseholdPreferencesSchema.parse(model)).toEqual(model);

    const threadId = await seedThread(ownerId);
    const [o] = await db
      .insert(objectives)
      .values({ threadId, definition: "onboarding", status: "active", stackPosition: 1, context: { step: 2 } })
      .returning();
    expect(ObjectiveSchema.parse(o)).toEqual(o);

    const [s] = await db
      .insert(tasks)
      .values({ objectiveId: o.id, kind: "elicit", fact: "household.stores", scope: "household", required: false })
      .returning();
    expect(TaskSchema.parse(s)).toEqual(s);
  });

  it("Test Case 5: stack_position orders the stack; completed_at is nullable", async () => {
    const userId = await seedUser();
    const threadId = await seedThread(userId);
    await db.insert(objectives).values([
      { threadId, definition: "a", status: "complete", stackPosition: 1, completedAt: new Date() },
      { threadId, definition: "b", status: "suspended", stackPosition: 2 },
      { threadId, definition: "c", status: "active", stackPosition: 3 },
    ]);

    const res = await client.execute(
      "SELECT MAX(stack_position) AS mx, MIN(stack_position) AS mn FROM objectives WHERE thread_id = ?",
      [threadId],
    );
    expect(Number(res.rows[0].mx)).toBe(3);
    expect(Number(res.rows[0].mn)).toBe(1);
  });
});
