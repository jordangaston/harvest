import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { recipeSteps } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { ImportJobRepository } from "../src/repositories/import-job-repository.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { persistAndReady } from "../src/import-persist.js";
import { toRecipeInput } from "../src/parse/mapping.js";
import * as scorerModule from "../src/difficulty/difficulty-scorer.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";

/**
 * WI-DIFF-3 — score at persist & read it back. Full persist → findById path against a
 * `file:` libSQL db (real transactions, no network). Difficulty is computed in
 * `toRecipeInput` over the finalized steps, so these assert alignment through the strip.
 */
let db: Database;
let cleanup: () => void;

// A recipe with a hard technique (temper → 5) at step 3 of 5, the rest trivial (1).
const TEMPER_RECIPE: ExtractedRecipeData = {
  title: "Chocolate Bark",
  servings: "8",
  totalMinutes: 40,
  confidence: 1,
  ingredients: [
    { name: "chocolate", amount: "200", unit: "gram", quantityText: "200g chocolate" },
    { name: "nuts", amount: "100", unit: "gram", quantityText: "100g nuts" },
  ],
  steps: ["Chop the nuts.", "Line a tray.", "Temper the chocolate.", "Spread it out.", "Serve."],
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  jobId: "",
  userId: "",
  sourceType: "website",
  sourceRef: "https://x.test/bark",
  ...over,
});

const seedJob = async () => {
  const user = await UserRepository.create(db).insert({ phone: "+15555550001", jwtPrivateKey: "k", jwtPublicKey: "p" });
  const job = await ImportJobRepository.create(db).create({
    id: crypto.randomUUID(),
    userId: user.id,
    sourceType: "website",
    sourceRef: "https://x.test/bark",
  });
  return { userId: user.id, jobId: job.id };
};

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("difficulty at persist", () => {
  it("TC1: persists per-step difficulty aligned, the band, and T=max/5 read back", async () => {
    const { userId, jobId } = await seedJob();
    const [recipeId] = await persistAndReady(db, [TEMPER_RECIPE], input({ jobId, userId }));

    // recipe_steps.difficulty ordered by position: the temper step (index 2) is 5.
    const rows = await db
      .select({ position: recipeSteps.position, difficulty: recipeSteps.difficulty })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(recipeSteps.position);
    expect(rows.map((r) => r.difficulty)).toEqual([2, 1, 5, 1, 1]);

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.stepDifficulties[2]).toBe(5);
    expect(detail?.difficulty?.stepDifficulties).toEqual([2, 1, 5, 1, 1]);
    // T = max(step)/5 = 1.0; the band is a valid enum; the recipe columns round-trip.
    expect(Math.max(...detail!.difficulty!.stepDifficulties) / 5).toBe(1.0);
    expect(["beginner", "intermediate", "advanced"]).toContain(detail?.difficulty?.band);
    expect(detail?.recipe.difficultyScore).toBe(String(detail?.difficulty?.score));
  });

  it("a large hard recipe lands advanced and logs one calibration line", async () => {
    const { userId, jobId } = await seedJob();
    // Saturate S and N (many steps/ingredients) with a temper step → advanced.
    const hard: ExtractedRecipeData = {
      ...TEMPER_RECIPE,
      totalMinutes: 120,
      ingredients: Array.from({ length: 20 }, (_, i) => ({ name: `ing${i}`, amount: "1", unit: null, quantityText: "1" })),
      steps: [...Array.from({ length: 15 }, () => "Chop the nuts."), "Temper the chocolate."],
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const [recipeId] = await persistAndReady(db, [hard], input({ jobId, userId }));

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.difficulty?.band).toBe("advanced");
    const lines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[persist] difficulty"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("band=advanced");
  });

  it("TC2: a bare section-label step is dropped; remaining steps stay aligned", async () => {
    const { userId, jobId } = await seedJob();
    const withLabel: ExtractedRecipeData = {
      ...TEMPER_RECIPE,
      steps: ["Chop the nuts.", "For the sauce:", "Temper the chocolate.", "Serve."],
    };
    const [recipeId] = await persistAndReady(db, [withLabel], input({ jobId, userId }));

    const detail = await RecipeRepository.create(db).findById(recipeId);
    // The label has no row; the four source steps become three stored steps, aligned.
    expect(detail?.steps).toEqual(["Chop the nuts.", "Temper the chocolate.", "Serve."]);
    expect(detail?.stepDifficulties).toEqual([2, 5, 1]);
  });

  it("TC3: best-effort — a scorer throw persists null difficulty and still reaches ready", async () => {
    const { userId, jobId } = await seedJob();
    vi.spyOn(scorerModule.DifficultyScorer.prototype, "score").mockImplementation(() => {
      throw new Error("scorer boom");
    });

    const [recipeId] = await persistAndReady(db, [TEMPER_RECIPE], input({ jobId, userId }));

    const detail = await RecipeRepository.create(db).findById(recipeId);
    expect(detail?.difficulty).toBeNull();
    expect(detail?.recipe.difficultyScore).toBeNull();
    expect(detail?.recipe.difficultyBand).toBeNull();
    const rows = await db.select({ difficulty: recipeSteps.difficulty }).from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
    expect(rows.every((r) => r.difficulty === null)).toBe(true);

    const job = await ImportJobRepository.create(db).findByIdForUser(jobId, userId);
    expect(job?.status).toBe("ready");
  });

  it("TC4: replay persists identical difficulty with no duplicate rows", async () => {
    const { userId, jobId } = await seedJob();
    const recipeRepo = RecipeRepository.create(db);
    const first = await recipeRepo.persist(toRecipeInput(TEMPER_RECIPE, input({ jobId, userId })), userId);
    const second = await recipeRepo.persist(toRecipeInput(TEMPER_RECIPE, input({ jobId, userId })), userId);

    const a = await recipeRepo.findById(first);
    const b = await recipeRepo.findById(second);
    expect(a?.difficulty).toEqual(b?.difficulty);
    // Each recipe has exactly its own five step rows (no cross-contamination).
    expect(a?.stepDifficulties).toHaveLength(5);
    expect(b?.stepDifficulties).toHaveLength(5);
  });

  it("TC5: toRecipeInput attaches difficulty aligned to the stripped steps", () => {
    const withLabel: ExtractedRecipeData = {
      ...TEMPER_RECIPE,
      steps: ["Chop the nuts.", "For the sauce:", "Temper the chocolate.", "Serve."],
    };
    const recipe = toRecipeInput(withLabel, input());
    expect(recipe.difficulty?.stepDifficulties.length).toBe(recipe.steps.length);
    expect(recipe.difficulty?.stepDifficulties).toEqual([2, 5, 1]);
  });
});

describe("WI-DIFF-5 — LLM stepTechniques through map + persist", () => {
  it("TC4: stepTechniques strip in lockstep with the section-label drop", () => {
    const withLabel: ExtractedRecipeData = {
      ...TEMPER_RECIPE,
      steps: ["For the sauce:", "Sauté the onion.", "Simmer."],
      stepTechniques: [[], ["saute"], ["simmer"]],
    };
    const recipe = toRecipeInput(withLabel, input());
    // The bare label drops with its (empty) technique row; the rest stay aligned.
    expect(recipe.steps).toEqual(["Sauté the onion.", "Simmer."]);
    expect(recipe.difficulty?.stepTechniques).toEqual([["saute"], ["simmer"]]);
    expect(recipe.difficulty?.stepDifficulties).toEqual([2, 1]);
  });

  it("TC5: persist the LLM techniques, read them back, and re-map == difficulty_score", async () => {
    const { userId, jobId } = await seedJob();
    // Butter-chicken shape: LLM detects techniques the keyword scan misses.
    const butterChicken: ExtractedRecipeData = {
      title: "20-minute Butter Chicken",
      servings: "4",
      totalMinutes: 20,
      confidence: 1,
      ingredients: Array.from({ length: 15 }, (_, i) => ({ name: `ing${i}`, amount: "1", unit: null, quantityText: "1" })),
      steps: ["Cook onions down until lightly golden.", "Add spices.", "Simmer until the sauce reduces."],
      stepTechniques: [["saute"], [], ["simmer", "reduce"]],
    };
    const [recipeId] = await persistAndReady(db, [butterChicken], input({ jobId, userId }));

    // recipe_steps.techniques + difficulty round-trip: difficulty = max(table) over techniques.
    const rows = await db
      .select({ position: recipeSteps.position, difficulty: recipeSteps.difficulty, techniques: recipeSteps.techniques })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(recipeSteps.position);
    expect(rows.map((r) => r.techniques)).toEqual([["saute"], null, ["simmer", "reduce"]]);
    expect(rows.map((r) => r.difficulty)).toEqual([2, 1, 3]);

    const detail = await RecipeRepository.create(db).findById(recipeId);
    // Re-score from the STORED techniques (no LLM) reproduces the persisted score.
    const stored = detail!.stepTechniques.map((t) => t ?? []);
    const rescored = scorerModule.DifficultyScorer.create().score(detail!.steps, 15, 20, stored);
    expect(rescored.score).toBe(Number(detail!.recipe.difficultyScore));
    expect(rescored.stepDifficulties).toEqual([2, 1, 3]);
  });
});
