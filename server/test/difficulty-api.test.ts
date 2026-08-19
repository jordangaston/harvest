import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { RecipeRepository } from "../src/repositories/recipe-repository.js";
import { toRecipeInput } from "../src/parse/mapping.js";
import { toPublicRecipe, toPublicRecipeCard, type RecipeDetail, type RecipeCard } from "../src/models/recipe.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import type { ExtractedRecipeData } from "../src/parse/extractor.js";
import type { ImportInput } from "../src/import-domain.js";

/** WI-DIFF-4 — the public projections + the detail/list endpoints expose difficulty. */

const baseRecipe = (): RecipeDetail["recipe"] => ({
  id: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  title: "R",
  sourceType: "website",
  sourceUrl: null,
  servings: 4,
  servingsEstimated: false,
  totalMinutes: null,
  imageUrl: null,
  confidence: null,
  calories: null,
  gramsOfFat: null,
  gramsOfSaturatedFat: null,
  gramsOfCarbohydrate: null,
  gramsOfFiber: null,
  gramsOfSugar: null,
  gramsOfProtein: null,
  milligramsOfSodium: null,
  nutritionSource: null,
  nrfScore: null,
  difficultyScore: null,
  difficultyBand: null,
  costPerServingCents: null,
  costCoverage: null,
  allergens: null,
  allergensComplete: false,
  equipmentComplete: false,
  createdAt: new Date(),
});

const detail = (over: Partial<RecipeDetail> = {}): RecipeDetail => ({
  recipe: baseRecipe(),
  ingredients: [],
  steps: [],
  categories: { cuisine: [], mealType: [], dishType: [], primaryIngredient: [] },
  diets: [],
  difficulty: null,
  stepDifficulties: [],
  stepTechniques: [],
  ...over,
});

describe("toPublicRecipe difficulty projection (WI-DIFF-4)", () => {
  it("maps a scored recipe to { score, band } (no per-step)", () => {
    const out = toPublicRecipe(detail({ difficulty: { score: 55.6, band: "intermediate", stepDifficulties: [5, 2], stepTechniques: [[], []] } }));
    expect(out.difficulty).toEqual({ score: 55.6, band: "intermediate" });
    expect(typeof out.difficulty!.score).toBe("number");
    expect(out.steps).toEqual([]); // steps stay string[]
  });

  it("omits difficulty when null", () => {
    expect(toPublicRecipe(detail()).difficulty).toBeUndefined();
  });
});

describe("toPublicRecipeCard difficulty_band projection (WI-DIFF-4)", () => {
  const card = (over: Partial<RecipeCard> = {}): RecipeCard => ({
    id: "1",
    title: "R",
    imageUrl: null,
    totalMinutes: null,
    difficultyBand: null,
    costPerServingCents: null,
    costCoverage: null,
    ...over,
  });

  it("includes the band when present and never a raw score", () => {
    const out = toPublicRecipeCard(card({ difficultyBand: "advanced" }));
    expect(out.difficulty_band).toBe("advanced");
    expect(out).not.toHaveProperty("difficulty_score");
    expect(out).not.toHaveProperty("difficulty");
  });

  it("omits difficulty_band when null", () => {
    expect(toPublicRecipeCard(card())).not.toHaveProperty("difficulty_band");
  });
});

// ── Endpoint integration ──────────────────────────────────────────────────────
let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

const HARD_RECIPE: ExtractedRecipeData = {
  title: "Chocolate Bark",
  servings: "8",
  totalMinutes: 120,
  confidence: 1,
  ingredients: Array.from({ length: 20 }, (_, i) => ({ name: `ing${i}`, amount: "1", unit: null, quantityText: "1" })),
  steps: [...Array.from({ length: 15 }, () => "Chop the nuts."), "Temper the chocolate."],
};

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
});
afterEach(() => cleanup());

async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

const jobInput = (userId: string): ImportInput => ({ jobId: "", userId, sourceType: "website", sourceRef: "https://x.test/bark" });

describe("GET /v1/recipes/:id difficulty (WI-DIFF-4 TC3)", () => {
  it("returns the difficulty object with a numeric score and steps stays a string[]", async () => {
    const { token, userId } = await mintBearer();
    const recipeId = await RecipeRepository.create(db).persist(toRecipeInput(HARD_RECIPE, jobInput(userId)), userId);

    const res = await app.request(`/v1/recipes/${recipeId}`, { headers: { authorization: `Bearer ${token}` } });
    const recipe = (await res.json()).recipe;
    expect(typeof recipe.difficulty.score).toBe("number");
    expect(["beginner", "intermediate", "advanced"]).toContain(recipe.difficulty.band);
    expect(Array.isArray(recipe.steps) && recipe.steps.every((s: unknown) => typeof s === "string")).toBe(true);
    expect(recipe.difficulty).not.toHaveProperty("stepDifficulties");
  });
});

describe("GET /v1/recipes difficulty_band on cards (WI-DIFF-4 TC4)", () => {
  it("a scored card carries difficulty_band; an un-scored card omits it and no card has a raw score", async () => {
    const { token, userId } = await mintBearer();
    const repo = RecipeRepository.create(db);
    // Scored (via toRecipeInput) and un-scored (difficulty omitted) recipes.
    await repo.persist(toRecipeInput(HARD_RECIPE, jobInput(userId)), userId);
    await repo.persist(
      { title: "Plain", sourceType: "website", servings: 2, servingsEstimated: false, ingredients: [], steps: [], nutrition: null, allergens: null },
      userId,
    );

    const res = await app.request("/v1/recipes", { headers: { authorization: `Bearer ${token}` } });
    const cards = (await res.json()).recipes as Array<Record<string, unknown>>;
    const scored = cards.find((c) => c.title === "Chocolate Bark")!;
    const plain = cards.find((c) => c.title === "Plain")!;
    expect(scored.difficulty_band).toBe("advanced");
    expect(plain).not.toHaveProperty("difficulty_band");
    for (const c of cards) expect(c).not.toHaveProperty("difficulty_score");
  });
});
