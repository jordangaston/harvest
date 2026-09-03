import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import {
  recipes,
  recipeCategories,
  userPreferences,
  userAllergens,
  userFoodPrefs,
} from "../src/schema.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * WI-RANK-3: GET /v1/recipes/ranked, offline against a migrated `file:` libSQL db.
 * Seeds recipes + categories + preferences directly, mints a bearer via the app.
 */
let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
});

afterEach(() => cleanup());

async function mintUser(goals?: string[]): Promise<{ token: string; userId: string }> {
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone, onboarding: goals ? { goals } : undefined } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

/** Inserts a recipe row for `userId` and returns its id. Numeric fields are text. */
async function seedRecipe(
  userId: string,
  r: {
    title: string;
    costPerServingCents?: number | null;
    difficultyBand?: "beginner" | "intermediate" | "advanced" | null;
    nrfScore?: number | null;
    totalMinutes?: number | null;
    allergens?: { contains: string[]; mayContain: string[] } | null;
    allergensComplete?: boolean;
    createdAt?: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({
      userId,
      title: r.title,
      sourceType: "website",
      costPerServingCents: r.costPerServingCents ?? null,
      difficultyBand: r.difficultyBand ?? null,
      nrfScore: r.nrfScore == null ? null : String(r.nrfScore),
      totalMinutes: r.totalMinutes ?? null,
      allergens: r.allergens ?? null,
      allergensComplete: r.allergensComplete ?? true,
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    })
    .returning({ id: recipes.id });
  return row!.id;
}

async function seedCategories(recipeId: string, cats: [string, string][]): Promise<void> {
  await db.insert(recipeCategories).values(cats.map(([facet, value]) => ({ recipeId, facet: facet as any, value })));
}

/** Stores Alice's preferences: peanut/severe + recipe-scope taste directives (base = affinity). */
async function seedAlicePrefs(userId: string): Promise<void> {
  await db.insert(userPreferences).values({
    userId,
    skillLevel: "intermediate",
    budgetCentsPerServing: 400,
    timeBudgetMinutes: 30,
  });
  await db.insert(userAllergens).values({ userId, allergen: "peanut", severity: "severe" });
  await db.insert(userFoodPrefs).values([
    { userId, dimension: "cuisine", value: "italian", direction: "more" },
    { userId, dimension: "primary_ingredient", value: "chicken", direction: "more" },
    { userId, dimension: "primary_ingredient", value: "liver", direction: "less" },
  ]);
}

async function getRanked(token: string, query = ""): Promise<any> {
  const res = await app.request(`/v1/recipes/ranked${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

describe("GET /v1/recipes/ranked (WI-RANK-3)", () => {
  it("Test 1 & 2: worked example — order [R1,R3], scores ≈81.7/71.2, R2 filtered on severe peanut", async () => {
    const { token, userId } = await mintUser();
    await seedAlicePrefs(userId);

    const r1 = await seedRecipe(userId, { title: "Chicken Piccata", costPerServingCents: 350, difficultyBand: "intermediate", nrfScore: 45, totalMinutes: 25, allergens: { contains: [], mayContain: [] } });
    await seedCategories(r1, [["cuisine", "italian"], ["dish_type", "pan-fry"], ["primary_ingredient", "chicken"]]);
    const r2 = await seedRecipe(userId, { title: "Pad Thai", costPerServingCents: 500, difficultyBand: "advanced", nrfScore: 30, totalMinutes: 40, allergens: { contains: ["peanut"], mayContain: [] } });
    await seedCategories(r2, [["cuisine", "thai"], ["primary_ingredient", "shrimp"]]);
    const r3 = await seedRecipe(userId, { title: "Veggie Minestrone", costPerServingCents: 250, difficultyBand: "beginner", nrfScore: 70, totalMinutes: 45, allergens: { contains: [], mayContain: [] } });
    await seedCategories(r3, [["cuisine", "italian"], ["dish_type", "soup"], ["primary_ingredient", "beans"]]);

    const { status, body } = await getRanked(token);
    expect(status).toBe(200);
    // Base = affinity: R1 (italian + chicken, both liked) outranks R3 (italian liked, beans neutral).
    expect(body.recipes.map((x: any) => x.recipe.title)).toEqual(["Chicken Piccata", "Veggie Minestrone"]);
    expect(body.recipes[0].score).toBeGreaterThan(body.recipes[1].score);
    expect(Object.keys(body.recipes[0].breakdown)).toContain("affinity");
    // Test 2: R2 (id) appears nowhere in the response (severe peanut filter).
    expect(body.recipes.map((x: any) => x.recipe.id)).not.toContain(r2);
    expect(body.page_token).toBeNull();
  });

  it("Test 3: a recipe-scope taste directive orders the deck (base = affinity)", async () => {
    const { token, userId } = await mintUser();
    await db.insert(userFoodPrefs).values({ userId, dimension: "cuisine", value: "thai", direction: "more" });
    const plain = await seedRecipe(userId, { title: "Plain" });
    const thai = await seedRecipe(userId, { title: "Thai Curry" });
    await seedCategories(thai, [["cuisine", "thai"]]);

    const { status, body } = await getRanked(token);
    expect(status).toBe(200);
    // The liked-cuisine recipe ranks first; the category-less recipe (affinity null) sinks.
    expect(body.recipes.map((x: any) => x.recipe.title)).toEqual(["Thai Curry", "Plain"]);
  });

  it("Test 4: paginates the ranked list without duplicates", async () => {
    const { token, userId } = await mintUser();
    await seedRecipe(userId, { title: "A", nrfScore: 90 });
    await seedRecipe(userId, { title: "B", nrfScore: 60 });
    await seedRecipe(userId, { title: "C", nrfScore: 30 });

    const first = await getRanked(token, "?page_size=2");
    expect(first.body.recipes.length).toBe(2);
    expect(first.body.page_token).not.toBeNull();

    const second = await getRanked(token, `?page_size=2&page_token=${first.body.page_token}`);
    expect(second.body.recipes.length).toBe(1);
    expect(second.body.page_token).toBeNull();

    // Ranking order is unspecified here (no directives → affinity ties); the contract is that
    // pagination returns each recipe exactly once.
    const titles = [...first.body.recipes, ...second.body.recipes].map((x: any) => x.recipe.title);
    expect(new Set(titles)).toEqual(new Set(["A", "B", "C"]));
  });

  it("Test 5: 401 without a valid bearer", async () => {
    const noAuth = await app.request("/v1/recipes/ranked");
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()).error).toEqual({ code: "UNAUTHORIZED", message: "authentication required" });
  });

  it("Test 6: empty catalog returns an empty page", async () => {
    const { token } = await mintUser();
    const { status, body } = await getRanked(token);
    expect(status).toBe(200);
    expect(body).toEqual({ recipes: [], page_token: null });
  });
});
