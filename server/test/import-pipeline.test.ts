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

describe("StubExtractor", () => {
  it("derives a titled recipe from a caption offline", async () => {
    const data = await new StubExtractor().extract({ caption: "Garlic Butter Rice — recipe below" });
    expect(data.title).toBe("Garlic Butter Rice");
    expect(hasRecipe(data)).toBe(true);
  });
});
