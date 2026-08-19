import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { recipeCategories } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { ImportJobRepository } from "../src/repositories/import-job-repository.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { persistAndReady } from "../src/import-persist.js";
import { toRecipeInput } from "../src/parse/mapping.js";
import { toPublicRecipe } from "../src/models/recipe.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";
import { RecipeCategorizer } from "../src/categorize/recipe-categorizer.js";
import { RuleTagger } from "../src/categorize/rule-tagger.js";
import { StubRecipeAnalyzer, type RecipeAnalyzer } from "../src/categorize/taste-classifier.js";
import { FoodMatcher } from "../src/nutrition/food-matcher.js";
import { FdcFoodRepository } from "../src/nutrition/fdc-food-repository.js";
import { seedFdcFixture } from "./fixtures/fdc-foods.fixture.js";

/**
 * WI-TS-3: the categorize step wired into the import pipeline. Following the S2
 * convention (test/import-pipeline.test.ts), we test the pipeline's pure logic and
 * DB-backed persist against a `file:` libSQL db — not WDK recovery. `attach` mirrors
 * the workflow's best-effort `categorizeOne`, offline (stub cuisine classifier).
 */
let db: Database;
let cleanup: () => void;

const BASE: ExtractedRecipeData = {
  title: "Weeknight Salmon Bowl",
  servings: "2",
  confidence: 1,
  ingredients: [
    { name: "salmon", amount: "100", unit: "gram", quantityText: "100g salmon" },
    { name: "spinach", amount: "50", unit: "gram", quantityText: "50g spinach" },
  ],
  steps: ["Cook."],
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  jobId: "",
  userId: "",
  sourceType: "website",
  sourceRef: "https://x.test/salmon",
  ...over,
});

/** An offline categorizer: real FDC matcher + rules, injectable recipe analyzer
 * (default stub — cuisine/dish_type are LLM-sourced, so offline they come back empty). */
function offlineCategorizer(analyzer: RecipeAnalyzer = new StubRecipeAnalyzer()): RecipeCategorizer {
  return new RecipeCategorizer(FoodMatcher.create(FdcFoodRepository.create(db)), new RuleTagger(), analyzer);
}

/** Mirrors the workflow's `categorizeOne` best-effort attach. */
async function attach(categorizer: RecipeCategorizer, recipe: ExtractedRecipeData): Promise<ExtractedRecipeData> {
  try {
    const { categories, stepTechniques } = await categorizer.analyze(recipe.title, recipe.ingredients, recipe.steps);
    return { ...recipe, categories, stepTechniques: stepTechniques.length ? stepTechniques : undefined };
  } catch {
    return recipe;
  }
}

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
});

afterEach(() => cleanup());

async function seedJob() {
  const user = await UserRepository.create(db).insert({
    phone: `+1555${String(Math.floor((Date.now() % 1e7))).padStart(7, "0")}`,
    jwtPrivateKey: "k",
    jwtPublicKey: "p",
  });
  const job = await ImportJobRepository.create(db).create({
    id: crypto.randomUUID(),
    userId: user.id,
    sourceType: "website",
    sourceRef: "https://x.test/salmon",
  });
  return { userId: user.id, jobId: job.id };
}

describe("toRecipeInput categories passthrough", () => {
  it("carries attached categories into RecipeInput", () => {
    const cats = { cuisine: ["italian"], mealType: ["dinner"], dishType: ["pasta"], primaryIngredient: ["seafood"] };
    const ri = toRecipeInput({ ...BASE, categories: cats }, input());
    expect(ri.categories).toEqual(cats);
  });

  it("leaves categories undefined when the recipe has none", () => {
    expect(toRecipeInput(BASE, input()).categories).toBeUndefined();
  });
});

describe("categorization persisted through the pipeline (WI-TS-3)", () => {
  it("persists FDC primary + LLM taste facets that surface on read", async () => {
    const { userId, jobId } = await seedJob();
    // salmon → seafood (FDC "Fish"); cuisine/meal_type/dish_type come from the LLM (stubbed here).
    const taste: RecipeAnalyzer = {
      analyze: async () => ({ cuisine: ["japanese"], mealType: ["dinner"], dishType: ["bowl"], stepTechniques: [], mealPrepFit: null }),
    };
    const categorized = await attach(offlineCategorizer(taste), BASE);
    const [recipeId] = await persistAndReady(db, [categorized], input({ jobId, userId }));

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail!.categories.primaryIngredient).toContain("seafood");
    expect(detail!.categories.dishType).toContain("bowl");
    expect(detail!.categories.mealType).toContain("dinner");
    expect(detail!.categories.cuisine).toContain("japanese");

    const publicRecipe = toPublicRecipe(detail!);
    expect(publicRecipe.categories.primary_ingredient).toContain("seafood");
    expect(publicRecipe.categories.dish_type).toContain("bowl");
  });

  it("is best-effort: a throwing categorizer still persists the recipe with zero facet rows", async () => {
    const { userId, jobId } = await seedJob();
    const throwing = {
      analyze: async () => {
        throw new Error("categorizer down");
      },
    } as unknown as RecipeCategorizer;

    const categorized = await attach(throwing, BASE); // returns the recipe unchanged
    const [recipeId] = await persistAndReady(db, [categorized], input({ jobId, userId }));

    expect((await db.select().from(recipeCategories).where(eq(recipeCategories.recipeId, recipeId))).length).toBe(0);
    const job = await ImportJobRepository.create(db).findByIdForUser(jobId, userId);
    expect(job?.status).toBe("ready"); // the import still succeeds
  });
});
