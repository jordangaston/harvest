import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, asc } from "drizzle-orm";
import { MealPlanRepository } from "../src/repositories/meal-plan-repository.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { MealPlanEntrySchema } from "../src/models/meal-plan.js";
import { mealPlanEntries } from "../src/schema.js";
import { makeHarness, type Harness } from "./helpers/wave2-harness.js";

/** WI-MP-1 — meal_plan_entries.source/batch_id + MealPlanRepository.replaceGenerated. */

const RECIPE: RecipeInput = {
  title: "Batch Stew",
  sourceType: "instagram",
  servings: 4,
  servingsEstimated: false,
  imageUrl: undefined,
  ingredients: [{ name: "beef", amount: "2", unit: "pound", quantityText: "2 lb beef" }],
  steps: ["Simmer"],
  nutrition: null,
  allergens: null,
};

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

/** All of a user's entries in a range, raw (with source/batch_id), ordered date, meal, position. */
function rawEntries(userId: string) {
  return h.db
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.userId, userId))
    .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.meal), asc(mealPlanEntries.position));
}

describe("meal_plan_entries source + batch_id", () => {
  it("defaults source to 'manual' and batch_id to null on a normal add (TC1, TC2)", async () => {
    const me = await h.mintBearer();
    const recipeId = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    await MealPlanRepository.create(h.db).add(me.userId, "2026-08-06", "dinner", recipeId);

    const [row] = await rawEntries(me.userId);
    expect(row.source).toBe("manual");
    expect(row.batchId).toBeNull();
  });

  it("rejects an out-of-enum source at the model boundary (TC1)", () => {
    const base = { id: crypto.randomUUID(), userId: crypto.randomUUID(), date: "2026-08-06", meal: "dinner", recipeId: crypto.randomUUID(), position: 0, batchId: null, createdAt: new Date() };
    expect(() => MealPlanEntrySchema.parse({ ...base, source: "generated" })).not.toThrow();
    expect(() => MealPlanEntrySchema.parse({ ...base, source: "other" })).toThrow();
  });

  it("0019 migration is adds-only: source + batch_id in one file, no DROP (TC2)", () => {
    const dir = fileURLToPath(new URL("../drizzle/", import.meta.url));
    const file = readdirSync(dir).find((f) => f.startsWith("0019_"));
    expect(file).toBeDefined();
    const sql = readFileSync(dir + file, "utf8");
    expect(sql).toContain("ADD `source`");
    expect(sql).toContain("ADD `batch_id`");
    expect(sql).not.toMatch(/DROP/i);
  });
});

describe("MealPlanRepository.replaceGenerated", () => {
  it("swaps generated, preserves manual, is owner-scoped (TC4)", async () => {
    const me = await h.mintBearer();
    const other = await h.mintBearer();
    const repo = MealPlanRepository.create(h.db);
    const rr = RecipeRepository.create(h.db);
    // Persist sequentially: libSQL serializes write transactions on one file (concurrent → SQLITE_BUSY).
    const a = await rr.persist(RECIPE, me.userId);
    const b = await rr.persist(RECIPE, me.userId);
    const c = await rr.persist(RECIPE, me.userId);
    const d = await rr.persist(RECIPE, me.userId);
    const e = await rr.persist(RECIPE, me.userId);
    const vRecipe = await rr.persist(RECIPE, other.userId);

    // A manual dinner + two generated dinners in the week; V has a generated entry too.
    await repo.add(me.userId, "2026-08-06", "dinner", a);
    await repo.replaceGenerated(me.userId, "2026-08-03", "2026-08-09", [
      { date: "2026-08-07", meal: "dinner", recipeId: b },
      { date: "2026-08-08", meal: "dinner", recipeId: c },
    ]);
    await repo.replaceGenerated(other.userId, "2026-08-03", "2026-08-09", [{ date: "2026-08-06", meal: "dinner", recipeId: vRecipe }]);

    // Re-generate U's week with a different set.
    await repo.replaceGenerated(me.userId, "2026-08-03", "2026-08-09", [
      { date: "2026-08-07", meal: "dinner", recipeId: d, batchId: "batch-1" },
      { date: "2026-08-08", meal: "dinner", recipeId: e, batchId: "batch-1" },
    ]);

    const mine = await rawEntries(me.userId);
    expect(mine.map((r) => [r.recipeId, r.source])).toEqual([
      [a, "manual"],   // preserved
      [d, "generated"], // 08-07
      [e, "generated"], // 08-08
    ]);
    expect(mine.every((r) => (r.source === "generated" ? r.batchId === "batch-1" : r.batchId === null))).toBe(true);
    // The manual entry keeps position 0; the regenerated dinner on 08-07 appends after nothing manual there.
    expect(mine.find((r) => r.recipeId === a)!.position).toBe(0);

    const theirs = await rawEntries(other.userId);
    expect(theirs.map((r) => r.recipeId)).toEqual([vRecipe]); // untouched by U's regenerate
  });

  it("rolls back atomically on a bad insert, leaving prior state intact (TC4)", async () => {
    const me = await h.mintBearer();
    const repo = MealPlanRepository.create(h.db);
    const good = await RecipeRepository.create(h.db).persist(RECIPE, me.userId);
    await repo.replaceGenerated(me.userId, "2026-08-03", "2026-08-09", [{ date: "2026-08-07", meal: "dinner", recipeId: good }]);

    // A second call whose second entry references a non-existent recipe (FK violation) must
    // roll back entirely: the delete of the prior generated row is undone, nothing is inserted.
    await expect(
      repo.replaceGenerated(me.userId, "2026-08-03", "2026-08-09", [
        { date: "2026-08-07", meal: "dinner", recipeId: good },
        { date: "2026-08-08", meal: "dinner", recipeId: "00000000-0000-0000-0000-000000000000" },
      ]),
    ).rejects.toThrow();

    const rows = await rawEntries(me.userId);
    expect(rows.map((r) => r.recipeId)).toEqual([good]); // original generated row survives
  });
});
