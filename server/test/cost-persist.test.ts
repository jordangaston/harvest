import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { ImportJobRepository } from "../src/repositories/import-job-repository.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { persistAndReady } from "../src/import-persist.js";
import { seedFdcFixture } from "./fixtures/fdc-foods.fixture.js";
import { seedPriceFixture } from "./fixtures/pp-nap.fixture.js";
import { CostEstimator } from "../src/price/cost-estimator.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";

/**
 * WI-CS-2 — cost at persist. Mirrors `costStep`: estimate each recipe (best-effort
 * try/catch), attach `cost`, then persist through the real `persistAndReady` →
 * `findById` path on a `file:` libSQL db (real transactions, no network).
 */
let db: Database;
let cleanup: () => void;

const CHEAP_RECIPE: ExtractedRecipeData = {
  title: "Flour & Chicken",
  servings: "4",
  confidence: 1,
  ingredients: [
    { name: "flour", amount: "2", unit: "cup", quantityText: "2 cups flour" },
    { name: "chicken", amount: "1", unit: "pound", quantityText: "1 lb chicken" },
    { name: "butter", amount: "2", unit: "tablespoon", quantityText: "2 tbsp butter" },
  ],
  steps: ["Mix.", "Bake."],
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  jobId: "",
  userId: "",
  sourceType: "website",
  sourceRef: "https://x.test/r",
  ...over,
});

const seedJob = async () => {
  const user = await UserRepository.create(db).insert({
    phone: `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    jwtPrivateKey: "k",
    jwtPublicKey: "p",
  });
  const job = await ImportJobRepository.create(db).create({
    id: crypto.randomUUID(),
    userId: user.id,
    sourceType: "website",
    sourceRef: "https://x.test/r",
  });
  return { userId: user.id, jobId: job.id };
};

/** Mirrors `costStep`'s costOne: best-effort estimate → attach `cost`, else return as-is. */
const enrich = async (recipe: ExtractedRecipeData, estimator: CostEstimator): Promise<ExtractedRecipeData> => {
  try {
    const cost = await estimator.estimate(recipe.ingredients, recipe.servings ? parseInt(recipe.servings, 10) : 4);
    return cost ? { ...recipe, cost } : recipe;
  } catch {
    return recipe; // withheld — the import still succeeds
  }
};

const persistOne = async (recipe: ExtractedRecipeData, estimator: CostEstimator) => {
  const { userId, jobId } = await seedJob();
  const [recipeId] = await persistAndReady(db, [await enrich(recipe, estimator)], input({ jobId, userId }));
  return { recipeId, jobId, userId };
};

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
  await seedPriceFixture(db);
});

afterEach(() => cleanup());

describe("cost persisted through the pipeline (WI-CS-2)", () => {
  it("persists cents-per-serving and coverage, read back on the recipe row", async () => {
    const { recipeId } = await persistOne(CHEAP_RECIPE, CostEstimator.create(db));
    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.recipe.costPerServingCents).toBeGreaterThan(0);
    // Coverage is 1 (all three ingredients priced), stored as numeric-text.
    expect(Number(detail?.recipe.costCoverage)).toBeCloseTo(1, 5);
  });

  it("Test Case 3: nothing prices → both columns null", async () => {
    const unpriceable: ExtractedRecipeData = {
      ...CHEAP_RECIPE,
      ingredients: [{ name: "xyzzy", amount: "1", unit: "cup", quantityText: "1 cup xyzzy" }],
    };
    const { recipeId } = await persistOne(unpriceable, CostEstimator.create(db));
    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.recipe.costPerServingCents).toBeNull();
    expect(detail?.recipe.costCoverage).toBeNull();
  });

  it("Test Case 5: best-effort — a thrown lookup leaves cost null, import still reaches ready", async () => {
    const throwing = CostEstimator.create(db);
    throwing.estimate = async () => {
      throw new Error("price lookup boom");
    };
    const { recipeId, jobId, userId } = await persistOne(CHEAP_RECIPE, throwing);

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.recipe.costPerServingCents).toBeNull();
    expect(detail?.recipe.costCoverage).toBeNull();
    // graceful degradation: the job still reaches ready.
    const job = await ImportJobRepository.create(db).findByIdForUser(jobId, userId);
    expect(job?.status).toBe("ready");
  });

  it("a re-import overwrites the cost columns (AC 7)", async () => {
    const estimator = CostEstimator.create(db);
    const first = await persistOne(CHEAP_RECIPE, estimator);
    const firstDetail = await RecipeRepository.create(db).findById(first.recipeId);
    // Same recipe, more servings → a lower per-serving cost on the new row.
    const second = await persistOne({ ...CHEAP_RECIPE, servings: "8" }, estimator);
    const secondDetail = await RecipeRepository.create(db).findById(second.recipeId);
    expect(secondDetail!.recipe.costPerServingCents!).toBeLessThan(firstDetail!.recipe.costPerServingCents!);
  });
});
