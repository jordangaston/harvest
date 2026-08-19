import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { recipeEquipment, recipeSteps, recipes } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { ImportJobRepository } from "../src/repositories/import-job-repository.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { persistAndReady } from "../src/import-persist.js";
import { EquipmentDetector } from "../src/equipment/equipment-detector.js";
import { EquipmentMatcher } from "../src/equipment/equipment-matcher.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";

/**
 * WI-EQ-2: the equipmentStep detection persisted through the import pipeline. Offline (no
 * OPENAI_API_KEY → the detector's deterministic matcher runs, equipment_complete=false), against
 * a `file:` libSQL db. `attach` mirrors the workflow's best-effort `detectOneEquipment`.
 */
let db: Database;
let cleanup: () => void;

const BASE: ExtractedRecipeData = {
  title: "Air Fryer Wings",
  servings: "2",
  confidence: 1,
  ingredients: [{ name: "chicken wings", amount: "1", unit: "pound", quantityText: "1 lb chicken wings" }],
  steps: ["Season the wings", "Cook in the air fryer at 400F for 12 minutes"],
};

const PLAIN: ExtractedRecipeData = {
  title: "Sheet-pan salmon",
  servings: "2",
  confidence: 1,
  ingredients: [{ name: "salmon", amount: "2", unit: "fillet", quantityText: "2 salmon fillets" }],
  steps: ["Roast the salmon on a sheet pan"],
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  jobId: "",
  userId: "",
  sourceType: "website",
  sourceRef: "https://x.test/wings",
  ...over,
});

/** Mirrors the workflow's `detectOneEquipment` best-effort attach. Forces the offline
 * deterministic path (null analyzer) so the test never depends on env / the network. */
async function attach(recipe: ExtractedRecipeData): Promise<ExtractedRecipeData> {
  const detector = new EquipmentDetector(EquipmentMatcher.create(), null);
  const equipment = await detector.detect(recipe.title, recipe.ingredients.map((i) => i.name), recipe.steps);
  return { ...recipe, equipment };
}

async function seedJob() {
  const user = await UserRepository.create(db).insert({
    phone: `+1555${String(Math.floor(Date.now() % 1e7)).padStart(7, "0")}`,
    jwtPrivateKey: "k",
    jwtPublicKey: "p",
  });
  const job = await ImportJobRepository.create(db).create({
    id: crypto.randomUUID(),
    userId: user.id,
    sourceType: "website",
    sourceRef: "https://x.test/wings",
  });
  return { userId: user.id, jobId: job.id };
}

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => cleanup());

describe("equipment persisted through the pipeline (WI-EQ-2)", () => {
  it("persists recipe_equipment + the owning step's equipment for an explicit mention", async () => {
    const { userId, jobId } = await seedJob();
    const detected = await attach(BASE);
    const [recipeId] = await persistAndReady(db, [detected], input({ jobId, userId }));

    const rows = await db.select().from(recipeEquipment).where(eq(recipeEquipment.recipeId, recipeId));
    expect(rows).toEqual([{ recipeId, equipment: "air_fryer", essentiality: "recommended" }]);

    const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId)).orderBy(recipeSteps.position);
    expect(steps[0].equipment).toBeNull();
    expect(steps[1].equipment).toEqual(["air_fryer"]);

    // Offline path → deterministic floor → equipment_complete=false (design's degraded coverage).
    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(row.equipmentComplete).toBe(false);
  });

  it("persists zero equipment rows for a recipe that needs nothing special", async () => {
    const { userId, jobId } = await seedJob();
    const detected = await attach(PLAIN);
    const [recipeId] = await persistAndReady(db, [detected], input({ jobId, userId }));

    expect(await db.select().from(recipeEquipment).where(eq(recipeEquipment.recipeId, recipeId))).toHaveLength(0);
    const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
    expect(steps.every((s) => s.equipment === null)).toBe(true);
  });

  it("surfaces the equipment set + completeness on the RankableRecipe (WI-EQ-3)", async () => {
    const { userId, jobId } = await seedJob();
    const [withEquip] = await persistAndReady(db, [await attach(BASE)], input({ jobId, userId }));
    const [plain] = await persistAndReady(db, [await attach(PLAIN)], input({ jobId, userId }));

    const rankable = await RecipeRepository.create(db).listRankable(userId);
    const byId = new Map(rankable.map((r) => [r.recipe.id, r.recipe]));
    expect(byId.get(withEquip)!.equipment).toEqual([{ equipment: "air_fryer", essentiality: "recommended" }]);
    expect(byId.get(withEquip)!.equipmentComplete).toBe(false);
    expect(byId.get(plain)!.equipment).toEqual([]);
  });
});
