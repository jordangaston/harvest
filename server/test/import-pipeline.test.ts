import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { importJobs } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { ImportJobRepository } from "../src/repositories/import-job-repository.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { persistAndReady } from "../src/import-persist.js";
import { classifySource } from "../src/classify.js";
import { toExtractedData, hasRecipe, isSectionLabel, stripSectionLabels } from "../src/parse/mapping.js";
import { StubExtractor } from "../src/parse/extractor.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";
import { NutritionEstimator } from "../src/nutrition/nutrition-estimator.js";
import { toPublicRecipe } from "../src/models/recipe.js";
import { seedFdcFixture } from "./fixtures/fdc-foods.fixture.js";
import { seedExtraAllergenFoods, seedAllergens, FIXTURE_ALLERGEN_ROWS } from "./fixtures/allergen-foods.fixture.js";
import { AllergenDetector } from "../src/allergen/allergen-detector.js";
import type { LabelCoreText } from "../src/models/label-core.js";

/**
 * Fast offline S2 tests — the import pipeline's pure logic and DB-backed persist
 * against a `file:` libSQL database (real interactive transactions, no network).
 * We test the pipeline, not WDK's recovery. Mirrors the S1 test harness.
 */
let db: Database;
let cleanup: () => void;

const CARBONARA: ExtractedRecipeData = {
  title: "Carbonara",
  servings: "4",
  totalMinutes: 20,
  confidence: 1,
  ingredients: [
    { name: "guanciale", amount: "175", unit: "gram", quantityText: "175g guanciale" },
    { name: "eggs", amount: "2", unit: null, quantityText: "2 eggs" },
  ],
  steps: ["Cook the pasta.", "Toss with the egg and cheese."],
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  jobId: "",
  userId: "",
  sourceType: "website",
  sourceRef: "https://x.test/carbonara",
  ...over,
});

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => cleanup());

const seedJob = async () => {
  const user = await UserRepository.create(db).insert({ phone: "+15555550001", jwtPrivateKey: "k", jwtPublicKey: "p" });
  const job = await ImportJobRepository.create(db).create({
    id: crypto.randomUUID(),
    userId: user.id,
    sourceType: "website",
    sourceRef: "https://x.test/carbonara",
  });
  return { userId: user.id, jobId: job.id };
};

describe("classifySource", () => {
  it("maps a plain URL to website and a TikTok post to tiktok, and rejects junk", () => {
    expect(classifySource({ url: "https://example.com/recipes/x" })?.sourceType).toBe("website");
    expect(classifySource({ url: "https://www.tiktok.com/@u/video/123" })?.sourceType).toBe("tiktok");
    expect(classifySource({ url: "not a url" })).toBeNull();
  });
});

describe("mapping", () => {
  it("promotes JSON-LD to structured ingredients and flags a usable recipe", () => {
    const data = toExtractedData(
      { title: "Soup", ingredients: ["2 cups stock", "1 onion"], steps: ["Simmer."] },
      1,
    );
    expect(data.ingredients[0]).toMatchObject({ amount: "2", unit: "cup" });
    expect(hasRecipe(data)).toBe(true);
    expect(hasRecipe({ title: "", ingredients: [] })).toBe(false);
  });

  it("strips bare section headers but never empties a list", () => {
    expect(isSectionLabel("For the sauce")).toBe(true);
    expect(isSectionLabel("Simmer for 10 minutes.")).toBe(false);
    expect(stripSectionLabels(["For the sauce", "Simmer."])).toEqual(["Simmer."]);
    expect(stripSectionLabels(["For the sauce"])).toEqual(["For the sauce"]);
  });
});

describe("persistAndReady", () => {
  it("persists the recipe, links it, and marks the job ready in one flow", async () => {
    const { userId, jobId } = await seedJob();
    const [recipeId] = await persistAndReady(db, [CARBONARA], input({ jobId, userId }));

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.recipe.title).toBe("Carbonara");
    expect(detail?.ingredients).toHaveLength(2);
    expect(detail?.steps).toHaveLength(2);

    const job = await ImportJobRepository.create(db).findByIdForUser(jobId, userId);
    expect(job?.status).toBe("ready");
    expect(job?.recipeId).toBe(recipeId);
    expect(await ImportJobRepository.create(db).findRecipeIds(jobId)).toEqual([recipeId]);
  });

  it("persists every recipe of a carousel and links them all in slide order", async () => {
    const { userId, jobId } = await seedJob();
    const second: ExtractedRecipeData = { ...CARBONARA, title: "Amatriciana" };
    const recipeIds = await persistAndReady(db, [CARBONARA, second], input({ jobId, userId }));

    expect(recipeIds).toHaveLength(2);
    expect(await ImportJobRepository.create(db).findRecipeIds(jobId)).toEqual(recipeIds);
    const job = await ImportJobRepository.create(db).findByIdForUser(jobId, userId);
    expect(job?.recipeId).toBe(recipeIds[0]); // headline is the first slide
  });

  it("is replay-safe: re-linking the same recipe is idempotent (one link row)", async () => {
    const { userId, jobId } = await seedJob();
    const [recipeId] = await persistAndReady(db, [CARBONARA], input({ jobId, userId }));
    // A replayed persist re-links the same id; onConflictDoNothing keeps one row.
    await ImportJobRepository.create(db).linkRecipes(jobId, [recipeId]);
    expect(await ImportJobRepository.create(db).findRecipeIds(jobId)).toEqual([recipeId]);
  });
});

describe("consumer idempotency (status guard)", () => {
  it("starts only a queued job; a job that has advanced is a no-op", async () => {
    const { jobId } = await seedJob();
    // The guard startImport uses: read status, start only when queued.
    const shouldStart = async (id: string) => {
      const [row] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, id));
      return row?.status === "queued";
    };
    expect(await shouldStart(jobId)).toBe(true);
    await ImportJobRepository.create(db).setRunning(jobId, 10);
    expect(await shouldStart(jobId)).toBe(false); // redelivery no-op
  });
});

describe("nutrition estimate persisted through the pipeline (WI-3)", () => {
  // Mirrors nutritionStep: estimate each recipe, attach it, then persist.
  const enrich = async (recipe: ExtractedRecipeData): Promise<ExtractedRecipeData> => {
    const servings = recipe.servings ? parseInt(recipe.servings, 10) : 4;
    const estimate = await NutritionEstimator.create(db).run(recipe.ingredients, servings, recipe.nutrition);
    return { ...recipe, estimate };
  };

  // A fresh user+job per persist (unique phone), so a test can persist twice.
  const seedFreshJob = async () => {
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

  let seededDb: Database | undefined;
  const persistOne = async (recipe: ExtractedRecipeData) => {
    const { userId, jobId } = await seedFreshJob();
    if (seededDb !== db) {
      await seedFdcFixture(db); // once per fresh (beforeEach) db, even when a test persists twice
      seededDb = db;
    }
    const [recipeId] = await persistAndReady(db, [await enrich(recipe)], input({ jobId, userId }));
    return RecipeRepository.create(db).findById(recipeId);
  };

  const SPINACH_SALMON: ExtractedRecipeData = {
    title: "Salmon & Spinach",
    servings: "2",
    confidence: 1,
    ingredients: [
      { name: "spinach", amount: "200", unit: "gram", quantityText: "200g spinach" },
      { name: "salmon", amount: "100", unit: "gram", quantityText: "100g salmon" },
    ],
    steps: ["Cook."],
  };

  it("persists a computed estimate: source=computed, macros populated, nrf_score non-null", async () => {
    const detail = await persistOne(SPINACH_SALMON);
    expect(detail?.recipe.nutritionSource).toBe("computed");
    expect(detail?.recipe.calories).not.toBeNull();
    expect(detail?.recipe.gramsOfProtein).not.toBeNull();
    expect(detail?.recipe.nrfScore).not.toBeNull();
  });

  it("keeps parsed macros untouched but still scores", async () => {
    const parsed: LabelCoreText = {
      calories: "500", grams_of_fat: "20", grams_of_saturated_fat: "5",
      grams_of_carbohydrate: "40", grams_of_fiber: "6", grams_of_sugar: "8",
      grams_of_protein: "30", milligrams_of_sodium: "600",
    };
    const detail = await persistOne({ ...SPINACH_SALMON, nutrition: parsed });
    expect(detail?.recipe.nutritionSource).toBe("parsed");
    expect(detail?.recipe.calories).toBe("500");
    expect(detail?.recipe.gramsOfProtein).toBe("30");
    expect(detail?.recipe.nrfScore).not.toBeNull();
  });

  it("withholds when nothing matches: source and nrf_score both null", async () => {
    const detail = await persistOne({
      ...SPINACH_SALMON,
      ingredients: [{ name: "xyzzy", amount: "1", unit: "gram", quantityText: "1g xyzzy" }],
    });
    expect(detail?.recipe.nutritionSource).toBeNull();
    expect(detail?.recipe.nrfScore).toBeNull();
  });

  it("API emits estimated + nrf_score, never source or confidence", async () => {
    const computed = await persistOne(SPINACH_SALMON);
    const publicRecipe = toPublicRecipe(computed!);
    expect(publicRecipe.nutrition?.estimated).toBe(true);
    expect(publicRecipe.nutrition?.calories).toBeDefined();
    expect(typeof publicRecipe.nrf_score).toBe("number");
    expect(publicRecipe.nutrition).not.toHaveProperty("source");
    expect(publicRecipe.nutrition).not.toHaveProperty("confidence");

    const withheld = await persistOne({
      ...SPINACH_SALMON,
      ingredients: [{ name: "xyzzy", amount: "1", unit: "gram", quantityText: "1g xyzzy" }],
    });
    const withheldPublic = toPublicRecipe(withheld!);
    expect(withheldPublic.nutrition).toBeUndefined();
    expect(withheldPublic.nrf_score).toBeUndefined();
  });
});

describe("allergen profile persisted through the pipeline (WI-4)", () => {
  // Mirrors allergenStep: detect each recipe (best-effort try/catch), attach, then persist.
  const enrich = async (
    recipe: ExtractedRecipeData,
    detector: AllergenDetector,
  ): Promise<ExtractedRecipeData> => {
    try {
      const allergens = await detector.detect(recipe.ingredients);
      return allergens ? { ...recipe, allergens } : recipe;
    } catch {
      return recipe; // withheld — the import still succeeds
    }
  };

  const seedFreshJob = async () => {
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

  let seeded = false;
  const persistOne = async (recipe: ExtractedRecipeData, detector: AllergenDetector) => {
    const { userId, jobId } = await seedFreshJob();
    if (!seeded) {
      await seedFdcFixture(db);
      await seedExtraAllergenFoods(db);
      await seedAllergens(db, FIXTURE_ALLERGEN_ROWS);
      seeded = true;
    }
    const [recipeId] = await persistAndReady(db, [await enrich(recipe, detector)], input({ jobId, userId }));
    return { recipeId, jobId, userId };
  };

  beforeEach(() => {
    seeded = false; // db is recreated per test (outer beforeEach)
  });

  // buttermilk/peanut-butter match `high` → clean `contains` (bare "milk"/"peanut" only reach medium).
  const MILK_PEANUT: ExtractedRecipeData = {
    title: "PB & buttermilk",
    servings: "2",
    confidence: 1,
    ingredients: [
      { name: "cultured buttermilk", amount: "2", unit: "cup", quantityText: "2 cups cultured buttermilk" },
      { name: "peanut butter", amount: "2", unit: "tablespoon", quantityText: "2 tbsp peanut butter" },
    ],
    steps: ["Mix."],
  };

  it("persists a detected profile: allergens JSON + allergens_complete=1", async () => {
    const { recipeId } = await persistOne(MILK_PEANUT, AllergenDetector.create(db));
    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.recipe.allergens?.contains.sort()).toEqual(["milk", "peanut"]);
    expect(detail?.recipe.allergens?.mayContain).toEqual([]);
    expect(detail?.recipe.allergensComplete).toBe(true);
  });

  it("surfaces allergens snake_case on the public recipe", async () => {
    const { recipeId } = await persistOne(MILK_PEANUT, AllergenDetector.create(db));
    const publicRecipe = toPublicRecipe((await RecipeRepository.create(db).findById(recipeId))!);
    expect(publicRecipe.allergens?.contains.sort()).toEqual(["milk", "peanut"]);
    expect(publicRecipe.allergens?.may_contain).toEqual([]);
    expect(publicRecipe.allergens?.complete).toBe(true);
  });

  it("a detection error withholds the profile but the import still reaches ready", async () => {
    const throwing = AllergenDetector.create(db);
    throwing.detect = async () => {
      throw new Error("boom");
    };
    const { recipeId, jobId, userId } = await persistOne(MILK_PEANUT, throwing);

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.recipe.allergens).toBeNull();
    expect(detail?.recipe.allergensComplete).toBe(false);
    // graceful degradation: nutrition and the job status are unaffected.
    expect(toPublicRecipe(detail!).allergens).toBeUndefined();
    const job = await ImportJobRepository.create(db).findByIdForUser(jobId, userId);
    expect(job?.status).toBe("ready");
  });
});

describe("StubExtractor", () => {
  it("derives a titled recipe from a caption offline", async () => {
    const data = await new StubExtractor().extract({ caption: "Garlic Butter Rice — recipe below" });
    expect(data.title).toBe("Garlic Butter Rice");
    expect(hasRecipe(data)).toBe(true);
  });
});
